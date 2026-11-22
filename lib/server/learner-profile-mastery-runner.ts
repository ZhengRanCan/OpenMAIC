import { randomUUID } from 'node:crypto';
import type { Queryable } from '@openmaic/storage/document/pg';
import { callLLM } from '@/lib/ai/llm';
import {
  MASTERY_QUIZ_RULES,
  MASTERY_SYSTEM,
  synthesizeMastery,
  type MasteryEvidence,
  type MasteryState,
} from '@/lib/learner-mastery/synthesis';
import { digest } from '@/lib/learner-memory/contracts';
import {
  readProfileMemorySource,
  readProfileSourceAccess,
} from '@/lib/persistence/learner-profile-memory-source';
import { fenceOwnerWrite } from '@/lib/persistence/owner-merges';
import type { ServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { generationRunPersistence } from './generation/run/store';
import type { CourseTarget } from './generation/run/types';
import {
  readVerifiedProfileMasterySource,
  storedProfileMasterySchema,
  type ProfileMasteryReference,
} from './learner-profile-mastery';
import { readProfileSceneScopeIn } from './learner-profile-mastery-context';
import { resolveModel } from './resolve-model';

type Provider = Pick<ServerPersistenceProvider, 'pool' | 'withTransaction'>;
type Job = Record<string, unknown> & {
  id: string;
  stage_id: string;
  profile_id: string;
  target_id: string;
  target_revision: number;
  kind: ProfileMasteryReference['kind'];
  activity_id: string;
  record_id: string;
  source_version: string;
  claim_id: string;
  attempts: number;
};
type Invoke = (owner: string, system: string, user: string) => Promise<string>;
type Evidence = {
  input: MasteryEvidence;
  source: ProfileMasteryReference;
  result?: 'correct' | 'incorrect';
};

const BOUND_RUN = `FROM classroom_learner_profiles b
  JOIN stage_meta s ON s.stage_id=b.stage_id AND s.deleted_at IS NULL
  JOIN document_stages d ON d.id=s.stage_id AND d.task_engine_mode IS NOT TRUE
  JOIN generation_runs r ON r.id=b.run_id AND r.stage_id=b.stage_id AND r.owner_id=s.owner_id
    AND r.state='completed' AND COALESCE(r.outline->>'taskEngineMode','false')='false'`;
const TARGETS = `CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.outline->'targets')='array'
  THEN r.outline->'targets' ELSE '[]'::jsonb END) target`;

export async function discoverProfileMastery(app: Provider) {
  await app.pool.query(`INSERT INTO learner_profile_mastery_jobs
    (stage_id,profile_id,target_id,target_revision,kind,activity_id,record_id,source_version)
    SELECT b.stage_id,b.profile_id,target->>'id',(target->>'revision')::int,
      'quiz',a.id,a.submission->>'id',review.id
    ${BOUND_RUN}
    JOIN quiz_trace_attempts a ON a.stage_id=b.stage_id AND a.owner_id=s.owner_id
    JOIN document_scenes scene ON scene.stage_id=b.stage_id AND scene.id=a.scene_id
    JOIN quiz_trace_reviews review ON review.id=a.current_review_id AND review.attempt_id=a.id
      AND review.submission_id=a.submission->>'id'
    ${TARGETS}
    WHERE review.result#>>'{summary,status}' IN ('complete','partial')
      AND NOT EXISTS (SELECT 1 FROM quiz_optional_practice practice WHERE practice.attempt_id=a.id)
      AND NOT EXISTS (SELECT 1 FROM learner_profile_mastery_jobs j WHERE j.stage_id=b.stage_id
        AND j.target_id=target->>'id' AND j.target_revision::text=target->>'revision'
        AND j.kind='quiz' AND j.activity_id=a.id AND j.record_id=a.submission->>'id'
        AND j.source_version=review.id)
      AND target->>'id' IS NOT NULL AND target->>'revision' ~ '^[1-9][0-9]{0,8}$'
    ORDER BY a.created_at,a.id,target->>'id' LIMIT 50
    ON CONFLICT DO NOTHING`);
}

function locator(job: Job, ref?: ProfileMasteryReference) {
  return {
    stage_id: job.stage_id,
    profile_id: job.profile_id,
    kind: ref?.kind ?? job.kind,
    activity_id: ref?.activityId ?? job.activity_id,
    record_id: ref?.recordId ?? job.record_id,
    review_id: ref ? ref.reviewId : job.kind === 'quiz' ? job.source_version : null,
  };
}

async function quizEvidence(
  tx: Queryable,
  owner: string,
  runId: string,
  job: Job,
  ref?: ProfileMasteryReference,
): Promise<Evidence[]> {
  const location = locator(job, ref);
  if (location.kind !== 'quiz') return [];
  const access = await readProfileSourceAccess(tx, location);
  if (access?.owner_id !== owner) return [];
  const source = await readProfileMemorySource(tx, location, access);
  if (
    !source?.quizQuestions ||
    !source.reviewId ||
    !source.sceneId ||
    source.basis.historicalReview ||
    (ref && ref.digest !== source.digest)
  )
    return [];
  const scope = await readProfileSceneScopeIn(tx, owner, job.stage_id, source.sceneId);
  if (scope?.runId !== runId || scope.profileId !== job.profile_id) return [];

  return source.basis.parts.flatMap((part, index): Evidence[] => {
    const result = part.review;
    if ((result !== 'correct' && result !== 'incorrect') || (ref && !ref.parts.includes(index)))
      return [];
    const question = source.quizQuestions![index];
    const conditions = [
      part.help === 'practice-requested'
        ? '记录显示学生在提交前求助，是否获得帮助未确认。'
        : '帮助情况未确认。',
      '仅按当前保存的正常评阅和实际提交判断。',
    ];
    const evidenceRef = digest([
      job.stage_id,
      location.kind,
      location.activity_id,
      location.record_id,
      index,
    ]);
    return [
      {
        result,
        input: {
          evidenceRef,
          type: 'quiz_performance',
          text: result === 'correct' ? '本题有效评阅为正确。' : '本题有效评阅为错误。',
          conditions,
          questions: [{ ...question, answerKey: source.quizAnswerKeys?.[index] }],
        },
        source: {
          evidenceRef,
          kind: 'quiz',
          activityId: location.activity_id,
          recordId: location.record_id,
          reviewId: source.reviewId,
          digest: source.digest,
          parts: [index],
          conditions,
        },
      },
    ];
  });
}

async function capture(tx: Queryable, job: Job, lock: boolean) {
  const {
    rows: [bound],
  } = await tx.query<{ owner: string; run: string; target: CourseTarget }>(
    `SELECT s.owner_id AS owner,r.id AS run,target AS target ${BOUND_RUN} ${TARGETS}
      WHERE b.stage_id=$1 AND b.profile_id=$2 AND target->>'id'=$3 AND target->>'revision'=$4
        AND length(trim(target->>'statement')) BETWEEN 1 AND 1000${lock ? ' FOR UPDATE OF s' : ''}`,
    [job.stage_id, job.profile_id, job.target_id, String(job.target_revision)],
  );
  if (!bound) return;
  const fresh = await quizEvidence(tx, bound.owner, bound.run, job);
  if (!fresh.length) return;
  const {
    rows: [previous],
  } = await tx.query<{ sources: unknown; state: unknown }>(
    `SELECT sources,state FROM learner_profile_mastery WHERE stage_id=$1 AND target_id=$2 AND target_revision=$3`,
    [job.stage_id, job.target_id, job.target_revision],
  );
  const retained: Evidence[] = [];
  const dialogue = new Map<string, ProfileMasteryReference>();
  let invalidated = false;
  const freshKeys = new Set(fresh.map(({ input }) => input.evidenceRef));
  const parsed = storedProfileMasterySchema.safeParse(previous);
  const existing =
    parsed.success && parsed.data.state.targetStatement === bound.target.statement
      ? parsed.data
      : undefined;
  for (const ref of existing?.sources ?? []) {
    const replacement = fresh.find(
      ({ source }) =>
        source.kind === ref.kind &&
        source.activityId === ref.activityId &&
        source.recordId === ref.recordId,
    );
    if (replacement) {
      invalidated ||= replacement.source.digest !== ref.digest;
      continue;
    }
    if (ref.kind !== 'quiz') {
      const valid = await readVerifiedProfileMasterySource(
        tx,
        bound.owner,
        job.profile_id,
        job.stage_id,
        ref,
      );
      if (valid) dialogue.set(ref.evidenceRef, ref);
      else invalidated = true;
      continue;
    }
    const valid = await quizEvidence(tx, bound.owner, bound.run, job, ref);
    invalidated ||= !valid.length;
    retained.push(...valid);
  }
  const dialogueObservations = (existing?.state.observations ?? [])
    .filter(({ evidenceRef }) => dialogue.has(evidenceRef))
    .slice(-23);
  const preserved: MasteryState | null = dialogueObservations.length
    ? {
        schemaVersion: 'mastery-state.v0.1',
        learnerId: job.profile_id,
        target: bound.target,
        state: {
          summary: dialogueObservations
            .map(({ text }) => text)
            .join('\n')
            .slice(0, 1000),
          unverified: existing!.state.unverified.length
            ? existing!.state.unverified
            : ['继续核对当前目标的独立表现。'],
          observations: dialogueObservations,
        },
      }
    : null;
  // The most recent valid observations are enough to formulate the next check.
  const evidence = [
    ...new Map(
      [...retained.slice(-8), ...fresh.slice(0, 16)].map((item) => [item.source.evidenceRef, item]),
    ).values(),
  ].slice(-(24 - dialogueObservations.length));
  while (Buffer.byteLength(JSON.stringify(evidence.map(({ input }) => input))) > 30_000) {
    if (evidence.length <= 1) return;
    evidence.shift();
  }
  if (!evidence.some(({ input }) => freshKeys.has(input.evidenceRef))) return;
  return {
    ...bound,
    evidence,
    dialogue,
    preserved,
    invalidated,
    snapshot: digest([
      bound,
      previous ?? null,
      evidence.map(({ source }) => source),
      [...dialogue.keys()],
    ]),
  };
}

export async function processProfileMastery(app: Provider, invoke: Invoke, active = () => true) {
  if (!active()) return false;
  const {
    rows: [job],
  } = await app.pool.query<Job>(
    `UPDATE learner_profile_mastery_jobs j
    SET state='running',claim_id=$1,claimed_at=now(),attempts=attempts+1
    WHERE j.id=(SELECT id FROM learner_profile_mastery_jobs
      WHERE (state='queued' AND ready_at<=now()) OR (state='running' AND claimed_at<now()-interval '5 minutes')
      ORDER BY ready_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
    [randomUUID()],
  );
  if (!job) return false;
  const finish = (tx: Queryable, state: 'finished' | 'queued' | 'failed') =>
    tx.query(
      `
    UPDATE learner_profile_mastery_jobs SET state=$3,claim_id=NULL,claimed_at=NULL,
      ready_at=now()+interval '30 seconds' * attempts WHERE id=$1 AND claim_id=$2`,
      [job.id, job.claim_id, state],
    );
  try {
    if (job.attempts > 3) {
      await finish(app.pool, 'failed');
      return true;
    }
    const frozen = await app.withTransaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      return capture(tx, job, false);
    });
    if (!frozen) {
      await finish(app.pool, 'finished');
      return true;
    }
    const inputs = frozen.evidence.map(({ input }) => input);
    const raw = await invoke(
      frozen.owner,
      `${MASTERY_SYSTEM}\n${MASTERY_QUIZ_RULES}\n本次输入中的每条 Quiz 证据都没有确定的帮助记录，assistance 必须是 unknown。仅采用直接或部分覆盖当前目标的有效作答。以最新提供的有效评阅为准。`,
      JSON.stringify({
        target: frozen.target.statement,
        previous: frozen.preserved?.state.observations.map(({ evidenceRef, ...item }) => ({
          ...item,
          conditions: frozen.dialogue.get(evidenceRef)!.conditions,
        })),
        evidence: inputs,
      }),
    );
    const next = synthesizeMastery(raw, frozen.target, job.profile_id, frozen.preserved, inputs);
    const byRef = new Map(frozen.evidence.map((item) => [item.source.evidenceRef, item]));
    const observations = next?.state.observations ?? [];
    for (const observation of observations) {
      if (frozen.dialogue.has(observation.evidenceRef)) continue;
      const evidence = byRef.get(observation.evidenceRef)!;
      const isChoice =
        evidence.input.type === 'quiz_performance' &&
        evidence.input.questions[0].type !== 'short_answer';
      if (
        observation.assistance !== 'unknown' ||
        !['direct', 'partial'].includes(observation.coverage) ||
        (isChoice && observation.result !== evidence.result)
      )
        throw new Error('PROFILE_MASTERY_INVALID_OBSERVATION');
    }
    await app.withTransaction(async (tx) => {
      await fenceOwnerWrite(tx, frozen.owner);
      const {
        rows: [claim],
      } = await tx.query(
        "SELECT 1 FROM learner_profile_mastery_jobs WHERE id=$1 AND claim_id=$2 AND state='running' FOR UPDATE",
        [job.id, job.claim_id],
      );
      if (!claim) return;
      const current = await capture(tx, job, true);
      if (!active() || (current && current.snapshot !== frozen.snapshot)) {
        await finish(tx, 'queued');
        return;
      }
      if (current && next && (next !== frozen.preserved || current.invalidated)) {
        await tx.query(
          `INSERT INTO learner_profile_mastery(stage_id,target_id,target_revision,state,sources)
          VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(stage_id,target_id,target_revision)
          DO UPDATE SET state=excluded.state,sources=excluded.sources,updated_at=now()`,
          [
            job.stage_id,
            job.target_id,
            job.target_revision,
            { ...next.state, targetStatement: frozen.target.statement },
            JSON.stringify(
              observations.map(
                ({ evidenceRef }) =>
                  frozen.dialogue.get(evidenceRef) ?? byRef.get(evidenceRef)!.source,
              ),
            ),
          ],
        );
      } else if (current?.invalidated) {
        await tx.query(
          'DELETE FROM learner_profile_mastery WHERE stage_id=$1 AND target_id=$2 AND target_revision=$3',
          [job.stage_id, job.target_id, job.target_revision],
        );
      }
      await finish(tx, 'finished');
    });
  } catch {
    await finish(app.pool, job.attempts >= 3 ? 'failed' : 'queued');
  }
  return true;
}

async function generate(owner: string, system: string, prompt: string) {
  const model = await resolveModel({ stage: 'quiz-evidence', workspaceId: owner });
  if (!model.serverManaged) throw new Error('PROFILE_MASTERY_MODEL_UNAVAILABLE');
  const reply = await callLLM(
    {
      model: model.model,
      system,
      prompt,
      maxOutputTokens: 3500,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(90_000),
    },
    'profile-mastery-maintenance',
    { retries: 0 },
    model.thinkingConfig,
    { enabled: false, serverManaged: true },
  );
  return reply.finishReason === 'stop' ? reply.text : '';
}

export function startFormalMasteryLearningLoop() {
  let stopped = false;
  let running: Promise<void> | undefined;
  const active = () => !stopped && process.env.OPENMAIC_AUTOMATIC_MASTERY === 'true';
  const tick = async () => {
    const app = await generationRunPersistence();
    await discoverProfileMastery(app);
    await processProfileMastery(app, generate, active);
  };
  const wake = () => {
    if (!active() || running) return;
    running = tick()
      .catch(() => console.error('[profile-mastery] processing failed'))
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
