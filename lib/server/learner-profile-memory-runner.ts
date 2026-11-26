import { randomUUID } from 'node:crypto';
import type { Queryable } from '@openmaic/storage/document/pg';
import { callLLM } from '@/lib/ai/llm';
import {
  parseProfileMemoryResult,
  PROFILE_MEMORY_SYSTEM,
  profileMemoryInput,
} from '@/lib/learner-memory/profile-memory-prompt';
import { assertLearnerProfileIn } from '@/lib/persistence/learner-profiles';
import {
  readProfileMemorySource,
  PROFILE_DIALOGUE_MESSAGES,
  profileMemorySourceVersion,
  readProfileSourceAccess,
} from '@/lib/persistence/learner-profile-memory-source';
import { forwardOwnerWrite } from '@/lib/persistence/owner-merges';
import type { ServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { generationRunPersistence } from './generation/run/store';
import { resolveModel } from './resolve-model';
import {
  processSnapshotMemory,
  ProfileMemoryKnownModelFailure,
  type ProfileMemoryJob,
} from './learner-profile-memory-snapshot-runner';

type Provider = Pick<ServerPersistenceProvider, 'pool' | 'withTransaction'>;
type Invoke = (ownerId: string, system: string, prompt: string) => Promise<string>;

const INSERT_JOBS = 'INSERT INTO learner_profile_memory_jobs AS job';
const SOURCE_FIELDS = 'stage_id,profile_id,kind,activity_id,record_id,manually_added';
const BOUND_STAGE = `FROM classroom_learner_profiles b
  JOIN stage_meta s ON s.stage_id=b.stage_id AND s.deleted_at IS NULL
  JOIN document_stages d ON d.id=s.stage_id AND d.task_engine_mode IS NOT TRUE`;

export async function discoverProfileMemory(app: Provider) {
  await enqueueProfileMemory(app.pool);
}

export async function enqueueProfileMemory(
  queryable: Queryable,
  manual?: { stageId: string; ownerId: string; profileId: string },
) {
  const params = manual ? [manual.stageId, manual.ownerId, manual.profileId] : [];
  const stages = manual
    ? 'FROM stage_meta s JOIN document_stages d ON d.id=s.stage_id AND d.task_engine_mode IS NOT TRUE'
    : BOUND_STAGE;
  const scope = manual ? 's.stage_id=$1 AND s.owner_id=$2 AND s.deleted_at IS NULL' : 'TRUE';
  const target = manual ? '$3::uuid' : 'b.profile_id';
  const limit = manual ? '' : 'LIMIT 50';
  await queryable.query(
    `${INSERT_JOBS} (${SOURCE_FIELDS},requested_review_ordinal)
     SELECT s.stage_id,${target},'quiz',a.id,a.submission->>'id',${!!manual},r.ordinal
     ${stages}
     JOIN quiz_trace_attempts a ON a.stage_id=s.stage_id AND a.owner_id=s.owner_id
     JOIN quiz_trace_reviews r ON r.id=a.current_review_id AND r.submission_id=a.submission->>'id'
       AND r.result IS NOT NULL
     WHERE ${scope} AND (d.interactive_mode IS NOT TRUE OR NOT EXISTS (
       SELECT 1 FROM quiz_optional_practice p WHERE p.attempt_id=a.id))
     AND NOT EXISTS (SELECT 1 FROM learner_profile_memory_jobs j WHERE j.stage_id=s.stage_id AND j.profile_id=${target}
       AND j.kind='quiz' AND j.activity_id=a.id AND j.record_id=a.submission->>'id'
       AND j.requested_review_ordinal >= r.ordinal)
     ORDER BY a.created_at,a.id ${limit}
     ON CONFLICT ON CONSTRAINT learner_profile_memory_jobs_source_key DO UPDATE
       SET requested_review_ordinal=EXCLUDED.requested_review_ordinal, state='queued', attempts=0,
         claim_id=NULL, claimed_at=NULL, ready_at=now(),
         snapshot_done_refs='{}',snapshot_deferred_refs='{}',snapshot_call=NULL
       WHERE COALESCE(job.requested_review_ordinal, 0) < EXCLUDED.requested_review_ordinal`,
    params,
  );
  await queryable.query(
    `${INSERT_JOBS} (${SOURCE_FIELDS})
     SELECT DISTINCT s.stage_id,${target},view.kind,view.chat_id,message.data#>>'{payload,message,id}',${!!manual}
     ${stages}
     ${PROFILE_DIALOGUE_MESSAGES}
     WHERE ${scope} AND view.kind IN ('qa','discussion') AND view.chat_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM learner_profile_memory_jobs j WHERE j.stage_id=s.stage_id
         AND j.profile_id=${target} AND j.kind=view.kind AND j.activity_id=view.chat_id
         AND j.record_id=message.data#>>'{payload,message,id}')
     ORDER BY s.stage_id,view.chat_id,message.data#>>'{payload,message,id}' ${limit}
     ON CONFLICT DO NOTHING`,
    params,
  );
}

export async function processProfileMemory(app: Provider, invoke: Invoke): Promise<boolean> {
  const {
    rows: [job],
  } = await app.pool.query<ProfileMemoryJob>(
    `UPDATE learner_profile_memory_jobs SET state='running', attempts=attempts+1, claim_id=$1,
      claimed_at=now()
     WHERE id=(SELECT id FROM learner_profile_memory_jobs
       WHERE (state='queued' AND ready_at <= now())
          OR (state='running' AND claimed_at < now() - interval '5 minutes')
       ORDER BY ready_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
    [randomUUID()],
  );
  if (!job) return false;
  // A job keeps its previous snapshot available for readback while a new review is pending.
  // The worker always reads the current review, then checks that it is still the claimed one.
  const locator = { ...job, review_id: null };
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
      const evidence = profileMemorySourceVersion(
        await readProfileMemorySource(tx, locator, access),
      );
      return evidence && evidence.reviewOrdinal === job.requested_review_ordinal
        ? { ...evidence, owner: access.owner_id }
        : null;
    });
    if (!source) {
      await finish('finished');
      return true;
    }
    if (await processSnapshotMemory(app, job, source, invoke)) return true;
    let prompt = profileMemoryInput(source.basis);
    if (job.kind !== 'quiz' && Buffer.byteLength(prompt) > 24_000) {
      prompt = profileMemoryInput({
        ...source.basis,
        parts: source.basis.parts.map(({ previous, ...part }) => ({
          ...part,
          previous: previous?.slice(-2),
        })),
      });
    }
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
      const current = profileMemorySourceVersion(
        await readProfileMemorySource(tx, locator, access),
        source.digest,
      );
      if (current?.digest !== source.digest) throw new Error('PROFILE_MEMORY_SOURCE_CHANGED');
      const {
        rows: [saved],
      } = await tx.query<{ flagged_quiz_refs: number[] }>(
        `UPDATE learner_profile_memory_jobs SET state='finished',source_digest=$3,review_id=$4,
         claim_id=NULL,claimed_at=NULL WHERE id=$1 AND claim_id=$2 RETURNING flagged_quiz_refs`,
        [job.id, job.claim_id, source.digest, source.reviewId],
      );
      if (!saved) return;
      if (job.kind === 'quiz') {
        await tx.query('DELETE FROM learner_profile_memory_items WHERE job_id=$1', [job.id]);
      }
      for (const record of records) {
        const flagged = record.refs.some((ref) => saved.flagged_quiz_refs.includes(ref));
        await tx.query(
          `INSERT INTO learner_profile_memory_items (job_id,section,summary,refs,flagged_at)
           VALUES($1,$2,$3,$4::jsonb,CASE WHEN $5::boolean THEN now() END)`,
          [job.id, record.section, record.summary, JSON.stringify(record.refs), flagged],
        );
      }
    });
  } catch {
    await finish(job.attempts >= 3 ? 'failed' : 'queued');
  }
  return true;
}

async function invokeProfileMemory(ownerId: string, system: string, prompt: string) {
  const model = await resolveModel({ stage: 'quiz-evidence', workspaceId: ownerId }).catch(() => {
    throw new ProfileMemoryKnownModelFailure('PROFILE_MEMORY_MODEL_UNAVAILABLE');
  });
  if (!model.serverManaged)
    throw new ProfileMemoryKnownModelFailure('PROFILE_MEMORY_MODEL_UNAVAILABLE');
  const reply = await callLLM(
    {
      model: model.model,
      system,
      prompt,
      maxOutputTokens: system === PROFILE_MEMORY_SYSTEM ? 2048 : 8192,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(60_000),
    },
    'learner-profile-memory',
    { retries: 0 },
    model.thinkingConfig,
    { enabled: false },
  );
  if (reply.finishReason === 'error') throw new Error('PROFILE_MEMORY_RESULT_UNKNOWN');
  if (reply.finishReason !== 'stop')
    throw new ProfileMemoryKnownModelFailure('PROFILE_MEMORY_INCOMPLETE');
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
