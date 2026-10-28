import type { Queryable } from '@openmaic/storage/document/pg';

/** Persistent coordination only. Model calls happen after the claim transaction commits. */
export async function ensureLearningLoopSchema(db: Queryable): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS quiz_learning_loop_jobs (
    owner_id TEXT NOT NULL,
    submission_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL,
    generation_run_id TEXT NOT NULL,
    attribution JSONB,
    state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'unknown', 'failed', 'completed')),
    claim_id TEXT,
    claimed_at TIMESTAMPTZ,
    evidence_run_id TEXT,
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, submission_id)
  )`);
  await db.query('ALTER TABLE quiz_learning_loop_jobs ADD COLUMN IF NOT EXISTS attribution JSONB');
  await db.query(
    'ALTER TABLE quiz_learning_loop_jobs ADD COLUMN IF NOT EXISTS evidence_retry_of TEXT',
  );
  await db.query(
    'ALTER TABLE quiz_learning_loop_jobs ADD COLUMN IF NOT EXISTS memory_recovery_id TEXT',
  );
  await db.query(`CREATE TABLE IF NOT EXISTS quiz_learning_loop_activation (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
    since TIMESTAMPTZ NOT NULL DEFAULT now(),
    config JSONB NOT NULL
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS quiz_learning_loop_preexisting_reviews (
    review_id TEXT PRIMARY KEY
  )`);
}

export type LearningLoopAttribution = {
  student: 'A' | 'B' | 'C';
  sourceNature: 'proxy' | 'synthetic';
  conditions: string[];
  memoryEnvironmentId: string;
};

export type LearningLoopJob = {
  owner_id: string;
  submission_id: string;
  attempt_id: string;
  generation_run_id: string;
  attribution: LearningLoopAttribution | null;
  state: 'queued' | 'running' | 'unknown' | 'failed' | 'completed';
  claim_id: string | null;
  evidence_run_id: string | null;
  evidence_retry_of: string | null;
  memory_recovery_id: string | null;
  error_code: string | null;
} & Record<string, unknown>;

/** Duplicate delivery must identify exactly the same saved submission. */
export async function enqueueLearningLoop(
  db: Queryable,
  input: {
    owner: string;
    submission: string;
    attempt: string;
    generationRun: string;
    attribution?: LearningLoopAttribution;
  },
): Promise<void> {
  const result = await db.query(
    `INSERT INTO quiz_learning_loop_jobs(owner_id,submission_id,attempt_id,generation_run_id,state,attribution)
     VALUES($1,$2,$3,$4,'queued',$5::jsonb) ON CONFLICT(owner_id,submission_id) DO UPDATE
     SET updated_at=quiz_learning_loop_jobs.updated_at
     WHERE quiz_learning_loop_jobs.attempt_id=EXCLUDED.attempt_id
       AND quiz_learning_loop_jobs.generation_run_id=EXCLUDED.generation_run_id
       AND quiz_learning_loop_jobs.attribution IS NOT DISTINCT FROM EXCLUDED.attribution
     RETURNING submission_id`,
    [
      input.owner,
      input.submission,
      input.attempt,
      input.generationRun,
      input.attribution ? JSON.stringify(input.attribution) : null,
    ],
  );
  if (result.rows.length !== 1) throw new Error('LEARNING_LOOP_BINDING_CONFLICT');
}

/** Claim at most one job. Caller supplies a fresh claim ID and owns the transaction. */
export async function claimLearningLoop(
  db: Queryable,
  claimId: string,
): Promise<LearningLoopJob | null> {
  const result = await db.query<LearningLoopJob>(
    `UPDATE quiz_learning_loop_jobs SET state='running',claim_id=$1,claimed_at=now(),updated_at=now()
     WHERE (owner_id,submission_id)=(
       SELECT owner_id,submission_id FROM quiz_learning_loop_jobs WHERE state='queued'
       ORDER BY created_at,owner_id,submission_id FOR UPDATE SKIP LOCKED LIMIT 1
     ) RETURNING *`,
    [claimId],
  );
  return result.rows[0] ?? null;
}

/** Stale claims become unknown, never automatically rerun an external call. */
export async function markStaleLearningLoopsUnknown(
  db: Queryable,
  staleBefore: Date,
): Promise<void> {
  await db.query(
    `UPDATE quiz_learning_loop_jobs SET state='unknown',updated_at=now(),error_code='STALE_CLAIM'
     WHERE state='running' AND claimed_at < $1`,
    [staleBefore],
  );
}

/** Save the Evidence identity before starting the separate Memory call. */
export async function checkpointLearningLoopEvidence(
  db: Queryable,
  job: Pick<LearningLoopJob, 'owner_id' | 'submission_id'>,
  claimId: string,
  evidenceRunId: string,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE quiz_learning_loop_jobs SET evidence_run_id=$4,updated_at=now()
     WHERE owner_id=$1 AND submission_id=$2 AND claim_id=$3 AND state='running'
       AND (evidence_run_id IS NULL OR evidence_run_id=$4) RETURNING submission_id`,
    [job.owner_id, job.submission_id, claimId, evidenceRunId],
  );
  return result.rows.length === 1;
}

export async function finishLearningLoop(
  db: Queryable,
  job: Pick<LearningLoopJob, 'owner_id' | 'submission_id'>,
  claimId: string,
  state: 'unknown' | 'failed' | 'completed',
  evidenceRunId: string | null,
  errorCode: string | null,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE quiz_learning_loop_jobs SET state=$4,evidence_run_id=COALESCE($5,evidence_run_id),error_code=$6,updated_at=now()
     WHERE owner_id=$1 AND submission_id=$2 AND claim_id=$3 AND state='running'
       AND ($5::text IS NULL OR evidence_run_id IS NULL OR evidence_run_id=$5)
     RETURNING submission_id`,
    [job.owner_id, job.submission_id, claimId, state, evidenceRunId, errorCode],
  );
  return result.rows.length === 1;
}
