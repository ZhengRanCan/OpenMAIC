/** Created with the generation schema before either the classroom or profile routes can use it. */
export const LEARNER_PROFILE_SCHEMA = `
CREATE TABLE learner_profiles (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT CHECK (name IS NULL OR (length(btrim(name)) > 0 AND length(name) <= 80)),
  creation_run_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX learner_profiles_owner_idx ON learner_profiles(owner_id, created_at DESC);

CREATE TABLE classroom_learner_profiles (
  stage_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  profile_id UUID NOT NULL REFERENCES learner_profiles(id)
);
CREATE UNIQUE INDEX generation_runs_blank_profile_request_idx
  ON generation_runs (owner_id, (input->'learnerProfileSelection'->>'requestId'))
  WHERE input->'learnerProfileSelection'->>'mode' = 'blank';
`;

export const LEARNER_PROFILE_MEMORY_SCHEMA = `
ALTER TABLE learner_profiles
  ADD COLUMN memory_revision INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN background TEXT NOT NULL DEFAULT '',
  ADD COLUMN goals TEXT NOT NULL DEFAULT '',
  ADD COLUMN preferences TEXT NOT NULL DEFAULT '';

CREATE TABLE learner_profile_memory_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id TEXT NOT NULL,
  profile_id UUID NOT NULL REFERENCES learner_profiles(id),
  kind TEXT NOT NULL CHECK (kind IN ('quiz', 'qa', 'discussion')),
  activity_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','finished','failed')),
  claim_id UUID,
  claimed_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_digest TEXT,
  review_id TEXT,
  UNIQUE(stage_id,kind,activity_id,record_id)
);
CREATE INDEX learner_profile_memory_ready ON learner_profile_memory_jobs(ready_at,id)
  WHERE state IN ('queued','running');
CREATE TABLE learner_profile_memory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES learner_profile_memory_jobs(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK (section IN ('background','goals','preferences','experiences')),
  summary TEXT NOT NULL,
  refs JSONB NOT NULL,
  flagged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX learner_profile_memory_jobs_profile ON learner_profile_memory_jobs(profile_id,id);
CREATE INDEX learner_profile_memory_items_job ON learner_profile_memory_items(job_id);
`;

export const LEARNER_PROFILE_MASTERY_SCHEMA = `
CREATE TABLE learner_profile_mastery (
  stage_id TEXT NOT NULL REFERENCES classroom_learner_profiles(stage_id) ON DELETE CASCADE,
  target_id TEXT NOT NULL,
  target_revision INTEGER NOT NULL CHECK (target_revision > 0),
  state JSONB NOT NULL,
  sources JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (stage_id, target_id, target_revision)
);
CREATE INDEX classroom_learner_profiles_profile_idx ON classroom_learner_profiles(profile_id);
`;

export const LEARNER_PROFILE_MASTERY_JOBS_SCHEMA = `
CREATE TABLE learner_profile_mastery_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id TEXT NOT NULL REFERENCES classroom_learner_profiles(stage_id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES learner_profiles(id),
  target_id TEXT NOT NULL,
  target_revision INTEGER NOT NULL CHECK (target_revision > 0),
  kind TEXT NOT NULL CHECK (kind IN ('quiz','qa','discussion')),
  activity_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  source_version TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','finished','failed')),
  ready_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  claim_id UUID,
  UNIQUE(stage_id,target_id,target_revision,kind,activity_id,record_id,source_version)
);
CREATE INDEX learner_profile_mastery_jobs_ready_idx ON learner_profile_mastery_jobs(ready_at,id)
  WHERE state IN ('queued','running');
`;
