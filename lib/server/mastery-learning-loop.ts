import { randomUUID } from 'node:crypto';
import type { Queryable } from '@openmaic/storage/document/pg';
import type { ConnectableQueryable } from '@openmaic/storage/server/reference';
import { callLLM } from '@/lib/ai/llm';
import type { DialogueEvidenceSettings } from '@/lib/dialogue/evidence-contracts';
import { ensureGenerationRunSchema } from '@/lib/persistence/generation-runs';
import { withSchemaBootstrapLock } from '@/lib/persistence/schema-bootstrap-lock';
import {
  getServerPersistenceProvider,
  type ServerPersistenceProvider,
} from '@/lib/persistence/server-provider';
import { loadDialogueEvidenceSettings } from './dialogue-evidence-provenance';
import { LearnerMastery } from './learner-mastery';
import { readSimulatedLearningLoopConfig } from './quiz-learning-loop/config';
import { resolveModel } from './resolve-model';

type Provider = Pick<ServerPersistenceProvider, 'withTransaction' | 'pool'>;
type State = 'queued' | 'running' | 'completed' | 'skipped' | 'failed' | 'unknown';
type Job = {
  id: string;
  owner_id: string;
  run_id: string;
  target_id: string;
  target_revision: number;
  source_kind: 'quiz' | 'dialogue';
  source_id: string;
  state: State;
  reason: string | null;
  claim_id: string | null;
};
type Generate = (owner: string, system: string, user: string) => Promise<string>;
type Recovery = 'retry' | 'reconcile' | 'discard_unknown';
type JobStatus = Pick<
  Job,
  'id' | 'target_id' | 'target_revision' | 'source_kind' | 'source_id' | 'state' | 'reason'
>;

export function readAutomaticMasteryConfig() {
  if (process.env.OPENMAIC_AUTOMATIC_MASTERY !== 'true') return null;
  const config = readSimulatedLearningLoopConfig();
  return config?.sourceNature === 'synthetic' ? config : null;
}

export function loadAutomaticMasterySettings(
  environmentId: string,
): Promise<DialogueEvidenceSettings> {
  return process.env.OPENMAIC_DIALOGUE_EVIDENCE_ENABLED === 'true'
    ? loadDialogueEvidenceSettings()
    : Promise.resolve({ bindings: [], memoryEnvironmentId: environmentId });
}

const QUIZ_SOURCES = `
  SELECT j.owner_id,j.generation_run_id AS run_id,e.id AS source_id,j.created_at,
    j.attribution->>'student' AS student
  FROM quiz_learning_loop_jobs j JOIN f68_short_facts_runs e
    ON e.id=j.evidence_run_id AND e.owner_id=j.owner_id AND e.submission_id=j.submission_id
  WHERE j.attribution->>'memoryEnvironmentId'=$1 AND j.attribution->>'sourceNature'='synthetic'
    AND e.data->>'state'='completed' AND e.data->'validation'->'accepted' <> '[]'::jsonb
    AND e.data->'request'->>'memoryEnvironmentId'=$1
    AND e.data->'request'->>'generationRunId'=j.generation_run_id
`;
const DIALOGUE_SOURCES = `
  SELECT j.owner_id,j.data->'binding'->>'generationRunId' AS run_id,e.id AS source_id,j.created_at,
    j.student
  FROM dialogue_loop_jobs j JOIN dialogue_evidence_runs e
    ON e.id=j.data->>'evidenceRunId' AND e.owner_id=j.owner_id
    AND e.stage_id=j.stage_id AND e.chat_session_id=j.chat_session_id
  WHERE j.environment_id=$1 AND j.state <> 'revoked'
    AND e.state='completed' AND e.data->'binding'->>'sourceNature'='synthetic'
    AND e.data->'binding'->>'memoryEnvironmentId'=$1
    AND e.data->'binding'->>'generationRunId'=j.data->'binding'->>'generationRunId'
    AND e.data->'facts' <> '[]'::jsonb
`;
const invalidSource = new Set([
  'MASTERY_COURSE_UNAVAILABLE',
  'MASTERY_TARGET_UNAVAILABLE',
  'MASTERY_SOURCE_UNAVAILABLE',
  'MASTERY_SOURCE_CHANGED',
  'SHORT_FACTS_NOT_FOUND',
  'SOURCE_OR_REQUEST_CHANGED',
  'NOT_FOUND',
  'ATTEMPT_NOT_FOUND',
  'VERSION_NOT_FOUND',
  'RUN_SCENE_PROOF_UNAVAILABLE',
]);

function locator(job: Job) {
  return {
    ownerId: job.owner_id,
    runId: job.run_id,
    targetId: job.target_id,
    targetRevision: job.target_revision,
  };
}

export class MasteryLearningLoop {
  private readonly mastery: LearnerMastery;
  private readonly environmentId: string;

  constructor(
    private readonly app: Provider,
    settings: DialogueEvidenceSettings,
  ) {
    this.mastery = new LearnerMastery(app, settings);
    this.environmentId = settings.memoryEnvironmentId;
  }

  async activate() {
    await this.app.pool.query(
      'INSERT INTO mastery_loop_activation(environment_id) VALUES($1) ON CONFLICT DO NOTHING',
      [this.environmentId],
    );
  }

  async discover() {
    const tables = await this.app.pool.query(
      `SELECT to_regclass('quiz_learning_loop_jobs') IS NOT NULL
        AND to_regclass('f68_short_facts_runs') IS NOT NULL AS quiz,
        to_regclass('dialogue_loop_jobs') IS NOT NULL
        AND to_regclass('dialogue_evidence_runs') IS NOT NULL AS dialogue`,
    );
    for (const [kind, sources] of [
      ['quiz', QUIZ_SOURCES],
      ['dialogue', DIALOGUE_SOURCES],
    ] as const) {
      if (!tables.rows[0]?.[kind]) continue;
      await this.app.pool.query(
        `INSERT INTO mastery_loop_jobs(id,owner_id,run_id,environment_id,target_id,target_revision,source_kind,source_id)
         SELECT gen_random_uuid()::text, src.owner_id,src.run_id,$1,t.id,t.revision,$2,src.source_id
         FROM (${sources}) src
         JOIN mastery_loop_activation a ON a.environment_id=$1 AND src.created_at >= a.since
         JOIN generation_runs r ON r.id=src.run_id AND r.owner_id=src.owner_id AND r.state='completed'
           AND r.input->>'simulatedLearner'=src.student
         JOIN stage_meta s ON s.stage_id=r.stage_id AND s.owner_id=r.owner_id AND s.deleted_at IS NULL
         CROSS JOIN LATERAL (
           SELECT item->>'id' AS id,
             CASE WHEN item->>'revision' ~ '^[1-9][0-9]{0,8}$' THEN (item->>'revision')::integer END AS revision
           FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.outline->'targets')='array'
             THEN r.outline->'targets' ELSE '[]'::jsonb END) item
           WHERE jsonb_typeof(item->'statement')='string' AND btrim(item->>'statement') <> ''
           LIMIT 3
         ) t
         WHERE t.id IS NOT NULL AND t.revision IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM mastery_loop_jobs m WHERE m.run_id=src.run_id
             AND m.environment_id=$1 AND m.target_id=t.id AND m.target_revision=t.revision
             AND m.source_kind=$2 AND m.source_id=src.source_id)
         ORDER BY src.created_at,src.source_id,t.id LIMIT 60
         ON CONFLICT DO NOTHING`,
        [this.environmentId, kind],
      );
    }
  }

  async processOne(
    generate: Generate,
    active: () => boolean = () => true,
    prepare?: (owner: string) => Promise<void>,
  ) {
    const { rows } = await this.app.pool.query<Job>(
      `UPDATE mastery_loop_jobs SET state='running',claim_id=$2,claimed_at=now()
       WHERE id=(SELECT id FROM mastery_loop_jobs WHERE environment_id=$1
         AND ((state='queued' AND ready_at <= now()) OR
           (state='running' AND claimed_at < now() - interval '10 minutes'))
         ORDER BY ready_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
      [this.environmentId, randomUUID()],
    );
    const job = rows[0];
    if (!job) return false;
    const target = locator(job);
    const finish = (state: State, reason: string | null = null) =>
      this.finish(this.app.pool, job, state, reason);
    const checkClaim = async (db: Queryable, lock = false) => {
      const result = await db.query(
        "SELECT id FROM mastery_loop_jobs WHERE id=$1 AND claim_id=$2 AND state='running'" +
          (lock ? ' FOR UPDATE' : ''),
        [job.id, job.claim_id],
      );
      if (!result.rows.length) throw new Error('MASTERY_CLAIM_CHANGED');
    };
    try {
      if ((await this.mastery.automaticInvocation(target, job.id)) === null)
        await prepare?.(job.owner_id);
      const source =
        job.source_kind === 'quiz'
          ? { kind: 'quiz' as const, runId: job.source_id }
          : job.source_id;
      await this.mastery.maintain(
        target,
        [source],
        (system, user) => generate(job.owner_id, system, user),
        {
          id: job.id,
          active,
          beforeInvoke: () => checkClaim(this.app.pool),
          knownOutcome: async (tx, outcome) => {
            // The pending token and stage lock prove this receipt belongs to this job,
            // even when the original worker's outer claim has expired.
            await tx.query(
              `UPDATE mastery_loop_jobs SET state=$2,reason=$3,claim_id=NULL,claimed_at=NULL,
                 ready_at=CASE WHEN $2='queued' THEN now() + interval '10 seconds' ELSE ready_at END
                 WHERE id=$1 AND state IN ('running','unknown')`,
              [
                job.id,
                outcome === 'paused' ? 'queued' : 'failed',
                outcome === 'paused' ? 'MASTERY_DISABLED' : 'MASTERY_REPLY_INVALID',
              ],
            );
          },
          guard: async (tx) => {
            await checkClaim(tx, true);
            if (!active()) throw new Error('MASTERY_DISABLED');
          },
        },
      );
      await finish('completed');
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      if (reason === 'MASTERY_CLAIM_CHANGED') return true;
      const invocation = await this.mastery.automaticInvocation(target, job.id);
      if (invalidSource.has(reason)) {
        await this.mastery.discardAutomaticInvocation(target, job.id, true, async (tx) => {
          if (!(await this.finish(tx, job, 'skipped', 'SOURCE_OR_TARGET_UNAVAILABLE')))
            throw new Error('MASTERY_CLAIM_CHANGED');
        });
      } else if (invocation === 'unknown') {
        await finish('unknown', 'MODEL_RESULT_UNKNOWN');
      } else if (invocation === 'captured') {
        await finish('queued', 'REPLY_CAPTURED');
      } else if (invocation === 'committed') {
        await finish('completed');
      } else if (
        reason === 'MASTERY_INVOCATION_PENDING_OR_UNKNOWN' ||
        reason === 'MASTERY_DISABLED'
      ) {
        await finish('queued', reason === 'MASTERY_DISABLED' ? reason : 'TARGET_PENDING');
      } else {
        await finish(
          'failed',
          reason === 'MASTERY_REPLY_INVALID' ? reason : 'MASTERY_PROCESS_FAILED',
        );
      }
    }
    return true;
  }

  private async finish(db: Queryable, job: Job, state: State, reason: string | null) {
    const result = await db.query(
      `UPDATE mastery_loop_jobs SET state=$3,reason=$4,claim_id=NULL,claimed_at=NULL,
        ready_at=CASE WHEN $3='queued' THEN now() + interval '10 seconds' ELSE ready_at END
       WHERE id=$1 AND claim_id=$2 AND state='running' RETURNING id`,
      [job.id, job.claim_id, state, reason],
    );
    return result.rows.length === 1;
  }

  async status(owner: string, runId: string) {
    const { rows } = await this.app.pool.query<JobStatus>(
      `SELECT j.id,j.target_id,j.target_revision,j.source_kind,j.source_id,j.state,j.reason
       FROM mastery_loop_jobs j JOIN generation_runs r ON r.id=j.run_id AND r.owner_id=j.owner_id
       JOIN stage_meta s ON s.stage_id=r.stage_id AND s.owner_id=r.owner_id AND s.deleted_at IS NULL
       WHERE j.owner_id=$1 AND j.run_id=$2 AND j.environment_id=$3
       ORDER BY CASE WHEN j.state='unknown' THEN 0 WHEN j.reason='REPLY_CAPTURED' THEN 1
         WHEN j.state='failed' THEN 2 ELSE 3 END, j.ready_at DESC,j.id LIMIT 100`,
      [owner, runId, this.environmentId],
    );
    return rows;
  }

  async recover(owner: string, runId: string, id: string, action: Recovery): Promise<boolean> {
    const { rows } = await this.app.pool.query<Job>(
      `SELECT j.* FROM mastery_loop_jobs j
       JOIN generation_runs r ON r.id=j.run_id AND r.owner_id=j.owner_id
       JOIN stage_meta s ON s.stage_id=r.stage_id AND s.owner_id=r.owner_id AND s.deleted_at IS NULL
       WHERE j.owner_id=$1 AND j.run_id=$2 AND j.environment_id=$3 AND j.id=$4`,
      [owner, runId, this.environmentId, id],
    );
    const job = rows[0];
    if (!job) return false;
    const target = locator(job);
    const requeue = async (from: State) =>
      (
        await this.app.pool.query(
          `UPDATE mastery_loop_jobs j SET state='queued',reason=NULL,ready_at=now()
         WHERE j.id=$1 AND j.state=$2 AND j.owner_id=$3 AND EXISTS (
           SELECT 1 FROM generation_runs r JOIN stage_meta s ON s.stage_id=r.stage_id
             AND s.owner_id=r.owner_id AND s.deleted_at IS NULL
           WHERE r.id=j.run_id AND r.owner_id=j.owner_id)
         RETURNING id`,
          [id, from, owner],
        )
      ).rows.length === 1;
    if (action === 'retry') return requeue('failed');
    if (job.state !== 'unknown') return false;
    if (action === 'reconcile') {
      const invocation = await this.mastery.automaticInvocation(target, id);
      if (invocation !== 'captured' && invocation !== 'committed') return false;
      return requeue('unknown');
    }
    await this.mastery.discardAutomaticInvocation(target, id, false, async (tx) => {
      const result = await tx.query(
        `UPDATE mastery_loop_jobs SET state='skipped',reason='UNKNOWN_DISCARDED'
         WHERE id=$1 AND state='unknown' RETURNING id`,
        [id],
      );
      if (!result.rows.length) throw new Error('MASTERY_RECOVERY_CONFLICT');
    });
    return true;
  }
}

export async function startMasteryLearningLoop() {
  const config = readAutomaticMasteryConfig();
  if (!config) return undefined;
  const app = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
  await withSchemaBootstrapLock(
    app.pool as unknown as ConnectableQueryable,
    ensureGenerationRunSchema,
  );
  const openLoop = async () =>
    new MasteryLearningLoop(app, await loadAutomaticMasterySettings(config.memoryEnvironmentId));
  await (await openLoop()).activate();
  let stopped = false;
  let running: Promise<void> | undefined;
  const active = () =>
    !stopped && readAutomaticMasteryConfig()?.memoryEnvironmentId === config.memoryEnvironmentId;
  const tick = async () => {
    if (!active()) return;
    const loop = await openLoop();
    if (!active()) return;
    await loop.discover();
    let model: Awaited<ReturnType<typeof resolveModel>> | undefined;
    await loop.processOne(
      async (_owner, system, prompt) => {
        if (!model?.serverManaged) throw new Error('MASTERY_MODEL_UNAVAILABLE');
        const reply = await callLLM(
          {
            model: model.model,
            system,
            prompt,
            maxOutputTokens: 4096,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(180_000),
          },
          'mastery-maintenance',
          { retries: 0 },
          model.thinkingConfig,
          { enabled: false },
        );
        return reply.finishReason === 'stop' ? reply.text : '';
      },
      active,
      async (owner) => {
        model = await resolveModel({ stage: 'quiz-evidence', workspaceId: owner });
        if (!model.serverManaged) throw new Error('MASTERY_MODEL_UNAVAILABLE');
      },
    );
  };
  const wake = () => {
    if (stopped || running) return;
    running = tick()
      .catch(() => console.error('[mastery-learning-loop] processing failed'))
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
