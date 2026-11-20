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
