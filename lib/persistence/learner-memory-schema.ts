import type { Queryable } from '@openmaic/storage/document/pg';
import type { SchemaMigrationSet } from '@openmaic/storage/pg-migrations';

export const MEMORY_MIGRATIONS: SchemaMigrationSet = {
  store: 'learner-memory-experiment',
  migrations: [
    {
      version: 1,
      name: 'bounded_memory_experiment',
      transaction: true,
      up: `
CREATE TABLE learner_memory_states (
 namespace TEXT NOT NULL CHECK(namespace LIKE 'f67-test:%'), learner_key TEXT NOT NULL,
 snapshot JSONB NOT NULL, maintenance BOOLEAN NOT NULL DEFAULT false,
 PRIMARY KEY(namespace,learner_key)
);
CREATE TABLE learner_memory_sources (
 namespace TEXT NOT NULL, learner_key TEXT NOT NULL, source_id TEXT NOT NULL, version TEXT NOT NULL,
 data JSONB NOT NULL, valid BOOLEAN NOT NULL DEFAULT true, current BOOLEAN NOT NULL DEFAULT true,
 processed BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(namespace,learner_key,source_id,version),
 FOREIGN KEY(namespace,learner_key) REFERENCES learner_memory_states ON DELETE CASCADE
);
CREATE UNIQUE INDEX learner_memory_source_current ON learner_memory_sources(namespace,learner_key,source_id) WHERE current;
CREATE TABLE learner_memory_runs (
 namespace TEXT NOT NULL, learner_key TEXT NOT NULL, id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('prepared','calling','captured','completed','failed','conflict','noop')),
 data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(namespace,learner_key,id),
 FOREIGN KEY(namespace,learner_key) REFERENCES learner_memory_states ON DELETE CASCADE
);
CREATE UNIQUE INDEX learner_memory_active ON learner_memory_runs(namespace,learner_key) WHERE state IN ('prepared','calling','captured');
`,
    },
  ],
};
export async function ensureMemorySchema(db: Queryable) {
  const { applySchemaMigrations } = await import('@openmaic/storage/pg-migrations');
  await applySchemaMigrations(db, MEMORY_MIGRATIONS);
}
