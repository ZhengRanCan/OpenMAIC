import { randomUUID } from 'node:crypto';
import type { Queryable } from '@openmaic/storage/document/pg';
import { emptySnapshot } from '@/lib/learner-memory/contracts';

import type {
  ClassroomLearnerProfile,
  LearnerProfileSelection,
  LearnerProfileSummary,
} from '@/lib/learner-context/learner-profile-contracts';

export class LearnerProfileError extends Error {
  constructor(readonly code: 'unavailable' | 'already-named' | 'request-conflict') {
    super(code);
    this.name = 'LearnerProfileError';
  }
}

// A claimed profile follows its classroom into the account. An old credential
// may no longer use the retired owner as a root.
const OWNERS = `WITH RECURSIVE owners(id) AS (
  SELECT $1::text WHERE NOT EXISTS (SELECT 1 FROM owner_merges WHERE from_owner_id=$1)
  UNION
  SELECT m.from_owner_id FROM owner_merges m JOIN owners o ON o.id=m.to_owner_id
)`;

export async function listLearnerProfilesIn(tx: Queryable, ownerId: string) {
  const { rows } = await tx.query<LearnerProfileSummary>(
    `${OWNERS} SELECT id,name FROM learner_profiles WHERE owner_id IN (SELECT id FROM owners)
      ORDER BY created_at DESC,id`,
    [ownerId],
  );
  return rows;
}

export async function readLastClassroomProfileIdIn(tx: Queryable, ownerId: string) {
  const { rows } = await tx.query<{ profile_id: string | null }>(
    `${OWNERS} SELECT b.profile_id
       FROM generation_runs r
       JOIN stage_meta s ON s.stage_id=r.stage_id AND s.owner_id=$1
       LEFT JOIN classroom_learner_profiles b ON b.stage_id=s.stage_id AND b.run_id=r.id
       LEFT JOIN LATERAL (
         SELECT e.ts FROM generation_run_events e
         WHERE e.run_id=r.id AND e.type='completed' ORDER BY e.seq DESC LIMIT 1
       ) completion ON true
       WHERE r.owner_id IN (SELECT id FROM owners) AND r.state='completed' AND s.deleted_at IS NULL
       ORDER BY COALESCE(completion.ts, EXTRACT(EPOCH FROM r.created_at) * 1000) DESC,
         r.created_at DESC, r.id DESC LIMIT 1`,
    [ownerId],
  );
  return rows[0]?.profile_id ?? null;
}

async function ownedProfileIn(tx: Queryable, ownerId: string, profileId: string) {
  const { rows } = await tx.query<LearnerProfileSummary & { creation_run_id: string }>(
    `${OWNERS} SELECT id,name,creation_run_id FROM learner_profiles
      WHERE id=$2 AND owner_id IN (SELECT id FROM owners)`,
    [ownerId, profileId],
  );
  return rows[0] ?? null;
}

export async function assertLearnerProfileIn(tx: Queryable, ownerId: string, profileId: string) {
  if (!(await ownedProfileIn(tx, ownerId, profileId))) throw new LearnerProfileError('unavailable');
}

/** Called inside the lease-fenced transaction that also completes this course. */
export async function bindLearnerProfileIn(
  tx: Queryable,
  input: {
    stageId: string;
    runId: string;
    selection: Exclude<LearnerProfileSelection, { mode: 'none' }>;
  },
) {
  const stage = await tx.query<{ owner_id: string }>(
    'SELECT owner_id FROM stage_meta WHERE stage_id=$1 AND deleted_at IS NULL',
    [input.stageId],
  );
  const owner = stage.rows[0]?.owner_id;
  if (!owner) throw new LearnerProfileError('unavailable');
  let profileId: string;
  if (input.selection.mode === 'existing') {
    profileId = input.selection.profileId;
    await assertLearnerProfileIn(tx, owner, profileId);
  } else {
    const created = await tx.query<{ id: string }>(
      `INSERT INTO learner_profiles(id,owner_id,creation_run_id,memory_snapshot)
         VALUES($1,$2,$3,$4::jsonb)
         RETURNING id`,
      [randomUUID(), owner, input.runId, JSON.stringify(emptySnapshot())],
    );
    profileId = created.rows[0]!.id;
  }
  await tx.query(
    'INSERT INTO classroom_learner_profiles(stage_id,run_id,profile_id) VALUES($1,$2,$3)',
    [input.stageId, input.runId, profileId],
  );
}

export async function readClassroomLearnerProfileIn(
  tx: Queryable,
  ownerId: string,
  stageId: string,
): Promise<ClassroomLearnerProfile | null> {
  const { rows } = await tx.query<{ profile_id: string; run_id: string }>(
    `SELECT b.profile_id,b.run_id FROM classroom_learner_profiles b
      JOIN stage_meta s ON s.stage_id=b.stage_id
      WHERE b.stage_id=$1 AND s.owner_id=$2 AND s.deleted_at IS NULL`,
    [stageId, ownerId],
  );
  const binding = rows[0];
  if (!binding) return null;
  const record = await ownedProfileIn(tx, ownerId, binding.profile_id);
  return record
    ? {
        profile: { id: record.id, name: record.name },
        promptName: record.name === null && record.creation_run_id === binding.run_id,
      }
    : null;
}

export async function nameLearnerProfileIn(
  tx: Queryable,
  ownerId: string,
  profileId: string,
  name: string,
): Promise<LearnerProfileSummary> {
  const { rows } = await tx.query<LearnerProfileSummary>(
    `${OWNERS} UPDATE learner_profiles SET name=$3,
        memory_revision=memory_revision + CASE WHEN name IS NULL THEN 1 ELSE 0 END
      WHERE id=$2 AND owner_id IN (SELECT id FROM owners) AND (name IS NULL OR name=$3)
      RETURNING id,name`,
    [ownerId, profileId, name],
  );
  if (rows[0]) return rows[0];
  await assertLearnerProfileIn(tx, ownerId, profileId);
  throw new LearnerProfileError('already-named');
}
