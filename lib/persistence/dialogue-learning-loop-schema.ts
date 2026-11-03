import type { Queryable } from '@openmaic/storage/document/pg';
import { applySchemaMigrations, type SchemaMigrationSet } from '@openmaic/storage/pg-migrations';
export const DIALOGUE_LOOP_MIGRATIONS: SchemaMigrationSet = {
  store: 'dialogue-learning-loop',
  migrations: [
    {
      version: 1,
      name: 'controlled_session_closures_and_jobs',
      transaction: true,
      up: `
CREATE TABLE dialogue_loop_activation(singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK(singleton),config_digest TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE dialogue_loop_sessions(
 owner_id TEXT NOT NULL,stage_id TEXT NOT NULL,chat_session_id TEXT NOT NULL,
 is_new BOOLEAN NOT NULL,run_id TEXT,binding JSONB,reason TEXT,revoked BOOLEAN NOT NULL DEFAULT false,last_checked_at TIMESTAMPTZ NOT NULL DEFAULT '-infinity',
 PRIMARY KEY(owner_id,stage_id,chat_session_id)
);
CREATE TABLE dialogue_loop_bindings(
 owner_id TEXT NOT NULL,stage_id TEXT NOT NULL,chat_session_id TEXT NOT NULL,
 source_digest TEXT NOT NULL,environment_id TEXT NOT NULL,binding JSONB NOT NULL,
 revoked BOOLEAN NOT NULL DEFAULT false,PRIMARY KEY(owner_id,stage_id,chat_session_id,source_digest,environment_id)
);
CREATE TABLE dialogue_loop_jobs(
 id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,stage_id TEXT NOT NULL,chat_session_id TEXT NOT NULL,
 reuse_key TEXT NOT NULL UNIQUE,environment_id TEXT NOT NULL,student TEXT,
 state TEXT NOT NULL,data JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX dialogue_loop_ready ON dialogue_loop_jobs(state,created_at);
CREATE UNIQUE INDEX dialogue_loop_one_active_student ON dialogue_loop_jobs(environment_id,student) WHERE state='running';
CREATE TABLE dialogue_loop_operations(owner_id TEXT NOT NULL,operation_id TEXT NOT NULL,intent TEXT NOT NULL,job_id TEXT NOT NULL REFERENCES dialogue_loop_jobs(id),targets JSONB NOT NULL,result JSONB,PRIMARY KEY(owner_id,operation_id));
`,
    },
  ],
};
export const ensureDialogueLoopSchema = (db: Queryable) =>
  applySchemaMigrations(db, DIALOGUE_LOOP_MIGRATIONS);
