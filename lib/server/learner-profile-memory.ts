import type { Queryable } from '@openmaic/storage/document/pg';
import type {
  ProfileMemoryEdit,
  ProfileMemoryItem,
  ProfileMemorySource,
  ProfileMemoryView,
} from '@/lib/learner-memory/profile-memory-contracts';
import {
  readProfileMemorySource,
  readProfileSourceAccess,
  type ProfileSourceLocator,
} from '@/lib/persistence/learner-profile-memory-source';
import { assertLearnerProfileIn } from '@/lib/persistence/learner-profiles';
import { fenceOwnerWrite } from '@/lib/persistence/owner-merges';
import { generationRunPersistence } from './generation/run/store';

type FieldsRow = {
  name: string | null;
  memory_revision: number;
  background: string;
  goals: string;
  preferences: string;
};

async function readIn(
  tx: Queryable,
  ownerId: string,
  profileId: string,
): Promise<ProfileMemoryView> {
  await assertLearnerProfileIn(tx, ownerId, profileId);
  const {
    rows: [profile],
  } = await tx.query<FieldsRow>(
    'SELECT name,memory_revision,background,goals,preferences FROM learner_profiles WHERE id=$1',
    [profileId],
  );
  const { rows: items } = await tx.query<ProfileMemoryItem>(
    `SELECT i.id,i.section,i.summary,j.kind,i.flagged_at IS NOT NULL AS flagged
     FROM learner_profile_memory_items i
     JOIN learner_profile_memory_jobs j ON j.id=i.job_id AND j.profile_id=$1
     JOIN classroom_learner_profiles b ON b.stage_id=j.stage_id AND b.profile_id=j.profile_id
     JOIN stage_meta s ON s.stage_id=j.stage_id AND s.owner_id=$2 AND s.deleted_at IS NULL
     ORDER BY i.created_at DESC,i.id`,
    [profileId, ownerId],
  );
  const {
    rows: [maintenance],
  } = await tx.query<ProfileMemoryView['maintenance']>(
    `SELECT COALESCE(bool_or(j.state IN ('queued','running')),false) AS pending,
       COALESCE(bool_or(j.state='failed'),false) AS failed
     FROM learner_profile_memory_jobs j
     JOIN classroom_learner_profiles b ON b.stage_id=j.stage_id AND b.profile_id=j.profile_id
     JOIN stage_meta s ON s.stage_id=j.stage_id AND s.owner_id=$2 AND s.deleted_at IS NULL
     WHERE j.profile_id=$1 AND j.state <> 'finished'`,
    [profileId, ownerId],
  );
  return {
    profile: { id: profileId, name: profile.name },
    fields: {
      revision: profile.memory_revision,
      background: profile.background,
      goals: profile.goals,
      preferences: profile.preferences,
    },
    items,
    maintenance,
  };
}

export async function readProfileMemory(ownerId: string, profileId: string) {
  const { withTransaction } = await generationRunPersistence();
  return withTransaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    return readIn(tx, ownerId, profileId);
  });
}

export async function editProfileMemory(
  ownerId: string,
  profileId: string,
  edit: ProfileMemoryEdit,
) {
  const { withTransaction } = await generationRunPersistence();
  return withTransaction(async (tx) => {
    await fenceOwnerWrite(tx, ownerId);
    await assertLearnerProfileIn(tx, ownerId, profileId);
    const saved = await tx.query(
      `UPDATE learner_profiles SET name=$3,background=$4,goals=$5,preferences=$6,
       memory_revision=memory_revision+1 WHERE id=$1 AND memory_revision=$2 RETURNING id`,
      [profileId, edit.revision, edit.name, edit.background, edit.goals, edit.preferences],
    );
    return saved.rows.length ? readIn(tx, ownerId, profileId) : null;
  });
}

export async function readProfileMemoryBasis(
  ownerId: string,
  profileId: string,
  itemId: string,
): Promise<ProfileMemorySource | null> {
  const { withTransaction } = await generationRunPersistence();
  return withTransaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await assertLearnerProfileIn(tx, ownerId, profileId);
    const {
      rows: [item],
    } = await tx.query<ProfileSourceLocator & { source_digest: string; refs: number[] }>(
      `SELECT j.stage_id,j.profile_id,j.kind,j.activity_id,j.record_id,j.review_id,j.source_digest,i.refs
       FROM learner_profile_memory_items i
       JOIN learner_profile_memory_jobs j ON j.id=i.job_id AND j.profile_id=$1 WHERE i.id=$2`,
      [profileId, itemId],
    );
    if (!item) return null;
    const access = await readProfileSourceAccess(tx, item);
    if (access?.owner_id !== ownerId) return null;
    const current = await readProfileMemorySource(tx, item, access);
    if (!current || current.digest !== item.source_digest) return null;
    return { ...current.basis, parts: item.refs.map((index) => current.basis.parts[index]) };
  });
}

export async function flagProfileMemory(ownerId: string, profileId: string, itemId: string) {
  const { withTransaction } = await generationRunPersistence();
  return withTransaction(async (tx) => {
    await fenceOwnerWrite(tx, ownerId);
    await assertLearnerProfileIn(tx, ownerId, profileId);
    const result = await tx.query(
      `UPDATE learner_profile_memory_items i SET flagged_at=COALESCE(i.flagged_at, now())
       FROM learner_profile_memory_jobs j
       JOIN classroom_learner_profiles b ON b.profile_id=j.profile_id AND b.stage_id=j.stage_id
       JOIN stage_meta s ON s.stage_id=j.stage_id AND s.owner_id=$3 AND s.deleted_at IS NULL
       WHERE i.id=$2 AND i.job_id=j.id AND j.profile_id=$1 RETURNING i.id`,
      [profileId, itemId, ownerId],
    );
    return result.rows.length > 0;
  });
}
