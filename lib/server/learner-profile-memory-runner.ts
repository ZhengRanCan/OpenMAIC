import { randomUUID } from 'node:crypto';
import { callLLM } from '@/lib/ai/llm';
import {
  parseProfileMemoryResult,
  PROFILE_MEMORY_SYSTEM,
  profileMemoryInput,
} from '@/lib/learner-memory/profile-memory-prompt';
import { assertLearnerProfileIn } from '@/lib/persistence/learner-profiles';
import {
  readProfileMemorySource,
  readProfileSourceAccess,
  type ProfileSourceLocator,
} from '@/lib/persistence/learner-profile-memory-source';
import { forwardOwnerWrite } from '@/lib/persistence/owner-merges';
import type { ServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { generationRunPersistence } from './generation/run/store';
import { resolveModel } from './resolve-model';

type Provider = Pick<ServerPersistenceProvider, 'pool' | 'withTransaction'>;
type Job = ProfileSourceLocator & { id: string; claim_id: string; attempts: number };
type Invoke = (ownerId: string, system: string, prompt: string) => Promise<string>;

const INSERT_JOBS = `INSERT INTO learner_profile_memory_jobs (stage_id,profile_id,kind,activity_id,record_id)`;
const BOUND_STAGE = `FROM classroom_learner_profiles b
  JOIN stage_meta s ON s.stage_id=b.stage_id AND s.deleted_at IS NULL`;

export async function discoverProfileMemory(app: Provider) {
  await app.pool.query(
    `${INSERT_JOBS}
     SELECT s.stage_id,b.profile_id,'quiz',a.id,a.submission->>'id'
     ${BOUND_STAGE}
     JOIN quiz_trace_attempts a ON a.stage_id=s.stage_id AND a.owner_id=s.owner_id
     JOIN quiz_trace_reviews r ON r.id=a.current_review_id AND r.submission_id=a.submission->>'id'
       AND r.result IS NOT NULL
     WHERE NOT EXISTS (SELECT 1 FROM learner_profile_memory_jobs j WHERE j.stage_id=s.stage_id
       AND j.kind='quiz' AND j.activity_id=a.id AND j.record_id=a.submission->>'id')
     ORDER BY a.created_at,a.id LIMIT 50 ON CONFLICT DO NOTHING`,
  );
  await app.pool.query(
    `${INSERT_JOBS}
     SELECT DISTINCT s.stage_id,b.profile_id,view.kind,view.chat_id,message.data#>>'{payload,message,id}'
     ${BOUND_STAGE}
     JOIN runtime_sessions runtime ON runtime.stage_id=s.stage_id
       AND runtime.learner_key=s.owner_id AND runtime.kind='chat'
       AND runtime.status IN ('active','completed')
     CROSS JOIN LATERAL (
       SELECT state.data#>>'{payload,type}' AS kind, state.data#>>'{payload,chatSessionId}' AS chat_id,
              state.data#>'{payload,messageIds}' AS message_ids, state.seq
       FROM runtime_records state WHERE state.session_id=runtime.id
         AND state.data#>>'{payload,kind}'='chat_session_state'
       ORDER BY state.seq DESC LIMIT 1
     ) view
     JOIN runtime_records message ON message.session_id=runtime.id AND message.seq < view.seq
       AND message.data#>>'{payload,kind}'='chat_message'
       AND message.data#>>'{payload,message,role}'='user'
       AND view.message_ids ? (message.data#>>'{payload,message,id}')
     WHERE view.kind IN ('qa','discussion') AND view.chat_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM learner_profile_memory_jobs j WHERE j.stage_id=s.stage_id
         AND j.kind=view.kind AND j.activity_id=view.chat_id
         AND j.record_id=message.data#>>'{payload,message,id}')
     ORDER BY s.stage_id,view.chat_id,message.data#>>'{payload,message,id}' LIMIT 50
     ON CONFLICT DO NOTHING`,
  );
}

export async function processProfileMemory(app: Provider, invoke: Invoke): Promise<boolean> {
  const {
    rows: [job],
  } = await app.pool.query<Job>(
    `UPDATE learner_profile_memory_jobs SET state='running', attempts=attempts+1, claim_id=$1,
      claimed_at=now()
     WHERE id=(SELECT id FROM learner_profile_memory_jobs
       WHERE (state='queued' AND ready_at <= now())
          OR (state='running' AND claimed_at < now() - interval '5 minutes')
       ORDER BY ready_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
    [randomUUID()],
  );
  if (!job) return false;
  const finish = (state: 'finished' | 'failed' | 'queued') =>
    app.pool.query(
      `UPDATE learner_profile_memory_jobs SET state=$3,claim_id=NULL,claimed_at=NULL,
     ready_at=now() + interval '1 minute' * attempts
     WHERE id=$1 AND claim_id=$2`,
      [job.id, job.claim_id, state],
    );
  try {
    if (job.attempts > 3) {
      await finish('failed');
      return true;
    }
    const source = await app.withTransaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const access = await readProfileSourceAccess(tx, job);
      if (!access) return null;
      await assertLearnerProfileIn(tx, access.owner_id, job.profile_id);
      const evidence = await readProfileMemorySource(tx, job, access);
      return evidence ? { ...evidence, owner: access.owner_id } : null;
    });
    if (!source) {
      await finish('finished');
      return true;
    }
    const prompt = profileMemoryInput(source.basis);
    if (Buffer.byteLength(prompt) > 24_000) {
      await finish('failed');
      return true;
    }
    const records = parseProfileMemoryResult(
      await invoke(source.owner, PROFILE_MEMORY_SYSTEM, prompt),
      source.basis,
    );
    await app.withTransaction(async (tx) => {
      const owner = await forwardOwnerWrite(tx, source.owner);
      const access = await readProfileSourceAccess(tx, job, true);
      if (!access || access.owner_id !== owner) throw new Error('PROFILE_MEMORY_SOURCE_MOVED');
      const current = await readProfileMemorySource(tx, job, access);
      if (current?.digest !== source.digest) throw new Error('PROFILE_MEMORY_SOURCE_CHANGED');
      const saved = await tx.query(
        `UPDATE learner_profile_memory_jobs SET state='finished',source_digest=$3,review_id=$4,
         claim_id=NULL,claimed_at=NULL WHERE id=$1 AND claim_id=$2 RETURNING id`,
        [job.id, job.claim_id, source.digest, source.reviewId],
      );
      if (!saved.rows.length) return;
      for (const record of records) {
        await tx.query(
          `INSERT INTO learner_profile_memory_items (job_id,section,summary,refs)
           VALUES($1,$2,$3,$4::jsonb)`,
          [job.id, record.section, record.summary, JSON.stringify(record.refs)],
        );
      }
    });
  } catch {
    await finish(job.attempts >= 3 ? 'failed' : 'queued');
  }
  return true;
}

async function invokeProfileMemory(ownerId: string, system: string, prompt: string) {
  const model = await resolveModel({ stage: 'quiz-evidence', workspaceId: ownerId });
  if (!model.serverManaged) throw new Error('PROFILE_MEMORY_MODEL_UNAVAILABLE');
  const reply = await callLLM(
    {
      model: model.model,
      system,
      prompt,
      maxOutputTokens: 2048,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(60_000),
    },
    'learner-profile-memory',
    { retries: 0 },
    model.thinkingConfig,
    { enabled: false },
  );
  if (reply.finishReason !== 'stop') throw new Error('PROFILE_MEMORY_INCOMPLETE');
  return reply.text;
}

/** A saved source remains queued across process restarts; the timer only discovers and claims it. */
export function startProfileMemoryRunner() {
  let running: Promise<void> | undefined;
  let stopped = false;
  const tick = async () => {
    const app = await generationRunPersistence();
    await discoverProfileMemory(app);
    for (let i = 0; i < 8 && !stopped; i++) {
      if (!(await processProfileMemory(app, invokeProfileMemory))) break;
    }
  };
  const wake = () => {
    if (running || stopped) return;
    running = tick()
      .catch(() => console.error('[learner-profile-memory] maintenance unavailable'))
      .finally(() => {
        running = undefined;
      });
  };
  const timer = setInterval(wake, 10_000);
  timer.unref();
  wake();
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
