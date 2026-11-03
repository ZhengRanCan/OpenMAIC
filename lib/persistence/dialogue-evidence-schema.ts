import type { Queryable } from '@openmaic/storage/document/pg';
import { applySchemaMigrations, type SchemaMigrationSet } from '@openmaic/storage/pg-migrations';

export const DIALOGUE_EVIDENCE_MIGRATIONS: SchemaMigrationSet = {
  store: 'dialogue-evidence',
  migrations: [
    {
      version: 1,
      name: 'immutable_dialogue_evidence',
      transaction: true,
      up: `
CREATE TABLE dialogue_evidence_runs (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
 stage_id TEXT NOT NULL REFERENCES stage_meta(stage_id) ON DELETE CASCADE,
 chat_session_id TEXT NOT NULL, reuse_key TEXT NOT NULL, retry_of TEXT,
 state TEXT NOT NULL CHECK(state IN ('prepared','calling','captured','completed','empty','invalid','truncated','unknown','blocked','revoked')),
 data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX dialogue_evidence_owner_stage ON dialogue_evidence_runs(owner_id,stage_id,chat_session_id);
CREATE UNIQUE INDEX dialogue_evidence_original ON dialogue_evidence_runs(owner_id,reuse_key) WHERE retry_of IS NULL;
CREATE UNIQUE INDEX dialogue_evidence_retry ON dialogue_evidence_runs(retry_of) WHERE retry_of IS NOT NULL;
CREATE TABLE dialogue_evidence_requests (
 owner_id TEXT NOT NULL, operation_id TEXT NOT NULL, intent_digest TEXT NOT NULL,
 stage_id TEXT NOT NULL REFERENCES stage_meta(stage_id) ON DELETE CASCADE,
 run_id TEXT REFERENCES dialogue_evidence_runs(id) ON DELETE SET NULL, deleted_at TIMESTAMPTZ,
 PRIMARY KEY(owner_id,operation_id)
);
CREATE TABLE dialogue_evidence_revocations (
 owner_id TEXT NOT NULL, stage_id TEXT NOT NULL REFERENCES stage_meta(stage_id) ON DELETE CASCADE,
 reuse_key TEXT NOT NULL, PRIMARY KEY(owner_id,reuse_key)
);`,
    },
  ],
};
export async function ensureDialogueEvidenceSchema(db: Queryable) {
  await applySchemaMigrations(db, DIALOGUE_EVIDENCE_MIGRATIONS);
}
