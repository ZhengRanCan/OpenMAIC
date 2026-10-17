import type { Queryable } from '@openmaic/storage/document/pg';
import { applySchemaMigrations, type SchemaMigrationSet } from '@openmaic/storage/pg-migrations';

export const QUIZ_TRACE_MIGRATIONS: SchemaMigrationSet = {
  store: 'quiz-trace',
  migrations: [
    {
      version: 1,
      name: 'immutable_quiz_history',
      transaction: true,
      up: `
CREATE TABLE scene_history_versions (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, stage_id TEXT NOT NULL,
 scene_id TEXT NOT NULL, digest TEXT NOT NULL, data JSONB NOT NULL,
 UNIQUE(owner_id,stage_id,scene_id,digest)
);
CREATE TABLE quiz_trace_attempts (
 id TEXT PRIMARY KEY REFERENCES runtime_sessions(id) ON DELETE RESTRICT,
 owner_id TEXT NOT NULL, stage_id TEXT NOT NULL, scene_id TEXT NOT NULL,
 version_id TEXT NOT NULL REFERENCES scene_history_versions(id) ON DELETE RESTRICT,
 previous_id TEXT UNIQUE, submission JSONB, current_review_id TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX quiz_trace_owner_stage ON quiz_trace_attempts(owner_id,stage_id,scene_id,created_at);
CREATE TABLE quiz_trace_operations (
 owner_id TEXT NOT NULL, id TEXT NOT NULL, stage_id TEXT NOT NULL,
 kind TEXT NOT NULL, digest TEXT NOT NULL, result JSONB NOT NULL,
 PRIMARY KEY(owner_id,id)
);
CREATE TABLE quiz_trace_reviews (
 id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES quiz_trace_attempts(id) ON DELETE CASCADE,
 submission_id TEXT NOT NULL, version_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL, language TEXT NOT NULL,
 result JSONB, UNIQUE(attempt_id,ordinal)
);
`,
    },
  ],
};
export async function ensureQuizTraceSchema(tx: Queryable) {
  await applySchemaMigrations(tx, QUIZ_TRACE_MIGRATIONS);
}
