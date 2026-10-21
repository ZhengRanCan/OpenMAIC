import type { Queryable } from '@openmaic/storage/document/pg';
import { applySchemaMigrations, type SchemaMigrationSet } from '@openmaic/storage/pg-migrations';

export const QUIZ_EVIDENCE_MIGRATIONS: SchemaMigrationSet = {
  store: 'quiz-evidence',
  migrations: [
    {
      version: 1,
      name: 'bounded_evidence_runs',
      transaction: true,
      up: `
CREATE TABLE quiz_evidence_runs (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
 stage_id TEXT NOT NULL REFERENCES stage_meta(stage_id) ON DELETE CASCADE,
 anchor_attempt_id TEXT NOT NULL, reuse_key TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('reserved','calling','generated','completed','partial','failed','interrupted')),
 invocation_token TEXT, lease_expires_at TIMESTAMPTZ, previous_run_id TEXT,
 data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX quiz_evidence_owner_stage ON quiz_evidence_runs(owner_id,stage_id,created_at);
CREATE INDEX quiz_evidence_reuse ON quiz_evidence_runs(owner_id,stage_id,reuse_key,created_at);
CREATE UNIQUE INDEX quiz_evidence_single_active ON quiz_evidence_runs(owner_id,stage_id) WHERE state IN ('reserved','calling','generated');
CREATE TABLE quiz_evidence_requests (
 owner_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 stage_id TEXT NOT NULL REFERENCES stage_meta(stage_id) ON DELETE CASCADE,
 intent_digest TEXT NOT NULL, run_id TEXT REFERENCES quiz_evidence_runs(id) ON DELETE SET NULL,
 deleted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,operation_id)
);
CREATE INDEX quiz_evidence_request_run ON quiz_evidence_requests(run_id);
`,
    },
  ],
};

export async function ensureQuizEvidenceSchema(db: Queryable): Promise<void> {
  await applySchemaMigrations(db, QUIZ_EVIDENCE_MIGRATIONS);
}
