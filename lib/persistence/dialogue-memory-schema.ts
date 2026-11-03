import type { Queryable } from '@openmaic/storage/document/pg';
import { applySchemaMigrations, type SchemaMigrationSet } from '@openmaic/storage/pg-migrations';
export const DIALOGUE_MEMORY_MIGRATIONS: SchemaMigrationSet = {
  store: 'dialogue-memory',
  migrations: [
    {
      version: 1,
      name: 'source_bound_memory_deliveries',
      transaction: true,
      up: `
CREATE TABLE dialogue_memory_deliveries (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, stage_id TEXT NOT NULL,
 evidence_run_id TEXT NOT NULL, student TEXT NOT NULL, environment_id TEXT NOT NULL,
 retry_of TEXT, state TEXT NOT NULL, data JSONB NOT NULL
);
CREATE UNIQUE INDEX dialogue_memory_original ON dialogue_memory_deliveries(owner_id,evidence_run_id,student,environment_id) WHERE retry_of IS NULL;
CREATE UNIQUE INDEX dialogue_memory_retry ON dialogue_memory_deliveries(retry_of) WHERE retry_of IS NOT NULL;
CREATE INDEX dialogue_memory_owner_stage ON dialogue_memory_deliveries(owner_id,stage_id);
CREATE TABLE dialogue_memory_operations (
 owner_id TEXT NOT NULL, operation_id TEXT NOT NULL, intent TEXT NOT NULL,
 delivery_id TEXT NOT NULL REFERENCES dialogue_memory_deliveries(id), PRIMARY KEY(owner_id,operation_id)
);
CREATE TABLE dialogue_memory_sources (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, stage_id TEXT NOT NULL,
 environment_id TEXT NOT NULL, student TEXT NOT NULL, revoked BOOLEAN NOT NULL DEFAULT false, data JSONB NOT NULL
);
CREATE TABLE dialogue_memory_source_links (
 owner_id TEXT NOT NULL, evidence_run_id TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES dialogue_memory_sources(id),
 PRIMARY KEY(owner_id,evidence_run_id,source_id)
);`,
    },
  ],
};
export async function ensureDialogueMemorySchema(db: Queryable) {
  await applySchemaMigrations(db, DIALOGUE_MEMORY_MIGRATIONS);
}
