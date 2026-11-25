import type { Queryable } from '@openmaic/storage/document/pg';
import type {
  ProfileMemoryEdit,
  ProfileMemoryClassroom,
  ProfileMemoryImportStatus,
  ProfileMemoryItem,
  ProfileMemorySource,
  ProfileMemoryView,
} from '@/lib/learner-memory/profile-memory-contracts';
import { omitUnknownHelpFromExperience } from '@/lib/learner-memory/profile-memory-content';
import {
  PROFILE_MEMORY_JOB_AUTHORIZED,
  readProfileMemorySource,
  readProfileSourceAccess,
  profileMemorySourceVersion,
  type ProfileSourceLocator,
} from '@/lib/persistence/learner-profile-memory-source';
import { assertLearnerProfileIn } from '@/lib/persistence/learner-profiles';
import { fenceOwnerWrite } from '@/lib/persistence/owner-merges';
import { generationRunPersistence } from './generation/run/store';
import { enqueueProfileMemory } from './learner-profile-memory-runner';

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
     JOIN stage_meta s ON s.stage_id=j.stage_id AND s.owner_id=$2 AND s.deleted_at IS NULL
     WHERE ${PROFILE_MEMORY_JOB_AUTHORIZED}
     ORDER BY i.created_at DESC,i.id`,
    [profileId, ownerId],
  );
  const {
    rows: [maintenance],
  } = await tx.query<ProfileMemoryView['maintenance']>(
    `SELECT COALESCE(bool_or(j.state IN ('queued','running')),false) AS pending,
       COALESCE(bool_or(j.state='failed'),false) AS failed
     FROM learner_profile_memory_jobs j
     JOIN stage_meta s ON s.stage_id=j.stage_id AND s.owner_id=$2 AND s.deleted_at IS NULL
     WHERE ${PROFILE_MEMORY_JOB_AUTHORIZED} AND j.profile_id=$1 AND j.state <> 'finished'`,
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
    items: items.flatMap((item) => {
      if (item.section !== 'experiences') return [item];
      const summary = omitUnknownHelpFromExperience(item.summary);
      return summary ? [{ ...item, summary }] : [];
    }),
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
    return readAuthorizedProfileMemoryBasisIn(tx, ownerId, profileId, itemId, true);
  });
}

/** The caller already verified ownership of the profile in this transaction. */
export async function readAuthorizedProfileMemoryBasisIn(
  tx: Queryable,
  ownerId: string,
  profileId: string,
  itemId: string,
  includeReviewHistory = false,
): Promise<ProfileMemorySource | null> {
  const {
    rows: [item],
  } = await tx.query<ProfileSourceLocator & { source_digest: string; refs: number[] }>(
    `SELECT j.stage_id,j.profile_id,j.kind,j.activity_id,j.record_id,j.review_id,j.source_digest,
            j.manually_added,i.refs
       FROM learner_profile_memory_items i
       JOIN learner_profile_memory_jobs j ON j.id=i.job_id AND j.profile_id=$1 WHERE i.id=$2`,
    [profileId, itemId],
  );
  if (!item) return null;
  const access = await readProfileSourceAccess(tx, item);
  if (access?.owner_id !== ownerId) return null;
  const current = profileMemorySourceVersion(
    await readProfileMemorySource(tx, item, access, includeReviewHistory),
    item.source_digest,
  );
  if (!current) return null;
  return {
    ...current.basis,
    parts: item.refs.map((index) => current.basis.parts[index]),
    ...(current.basis.reviewHistory && {
      reviewHistory: current.basis.reviewHistory.map((entry) => ({
        ...entry,
        results: item.refs.map((index) => entry.results[index]),
      })),
    }),
  };
}

export async function flagProfileMemory(ownerId: string, profileId: string, itemId: string) {
  const { withTransaction } = await generationRunPersistence();
  return withTransaction(async (tx) => {
    await fenceOwnerWrite(tx, ownerId);
    await assertLearnerProfileIn(tx, ownerId, profileId);
    const {
      rows: [item],
    } = await tx.query<{
      job_id: string;
      kind: ProfileSourceLocator['kind'];
      refs: number[];
      flagged: boolean;
    }>(
      `SELECT i.job_id,j.kind,i.refs,i.flagged_at IS NOT NULL AS flagged
       FROM learner_profile_memory_items i JOIN learner_profile_memory_jobs j ON i.job_id=j.id
       JOIN stage_meta s ON s.stage_id=j.stage_id AND s.owner_id=$3 AND s.deleted_at IS NULL
       WHERE ${PROFILE_MEMORY_JOB_AUTHORIZED}
         AND i.id=$2 AND j.profile_id=$1 FOR UPDATE OF s`,
      [profileId, itemId, ownerId],
    );
    if (!item) return false;
    if (item.flagged) return true;
    const saved = await tx.query(
      'UPDATE learner_profile_memory_items SET flagged_at=now() WHERE id=$1 RETURNING id',
      [itemId],
    );
    if (!saved.rows.length) return false;
    if (item.kind === 'quiz') {
      await tx.query(
        `UPDATE learner_profile_memory_jobs
         SET flagged_quiz_refs=ARRAY(SELECT DISTINCT unnest(flagged_quiz_refs || $2::integer[]))
         WHERE id=$1`,
        [item.job_id, item.refs],
      );
    }
    return true;
  });
}

const IMPORTABLE_CLASSROOM = `FROM stage_meta s
  JOIN document_stages d ON d.id=s.stage_id AND d.task_engine_mode IS NOT TRUE
  WHERE s.owner_id=$1 AND s.deleted_at IS NULL AND NOT EXISTS (
    SELECT 1 FROM classroom_learner_profiles b WHERE b.stage_id=s.stage_id AND b.profile_id<>$2
  ) AND NOT EXISTS (
    SELECT 1 FROM generation_runs r WHERE r.stage_id=s.stage_id AND r.state NOT IN ('completed','ended')
  )`;

export async function listProfileMemoryClassrooms(ownerId: string, profileId: string) {
  const { withTransaction } = await generationRunPersistence();
  return withTransaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await assertLearnerProfileIn(tx, ownerId, profileId);
    const { rows } = await tx.query<ProfileMemoryClassroom>(
      `SELECT s.stage_id AS "stageId",d.name AS title ${IMPORTABLE_CLASSROOM}
       ORDER BY d.updated_at DESC,s.stage_id`,
      [ownerId, profileId],
    );
    return rows;
  });
}

export async function profileMemoryClassroomImport(
  ownerId: string,
  profileId: string,
  stageId: string,
  enqueue: boolean,
) {
  const { withTransaction } = await generationRunPersistence();
  return withTransaction(async (tx) => {
    if (enqueue) await fenceOwnerWrite(tx, ownerId);
    else await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await assertLearnerProfileIn(tx, ownerId, profileId);
    const classroom = await tx.query(
      `SELECT s.stage_id ${IMPORTABLE_CLASSROOM} AND s.stage_id=$3${enqueue ? ' FOR UPDATE OF s' : ''}`,
      [ownerId, profileId, stageId],
    );
    if (!classroom.rows.length) return null;
    if (enqueue) {
      await enqueueProfileMemory(tx, { ownerId, profileId, stageId });
      await tx.query(
        `UPDATE learner_profile_memory_jobs SET state='queued', attempts=0, ready_at=now()
         WHERE stage_id=$1 AND profile_id=$2 AND state='failed'`,
        [stageId, profileId],
      );
    }
    const {
      rows: [status],
    } = await tx.query<ProfileMemoryImportStatus>(
      `SELECT count(*)::int AS total,
         (count(*) FILTER (WHERE state IN ('queued','running')))::int AS pending,
         (count(*) FILTER (WHERE state='failed'))::int AS failed
       FROM learner_profile_memory_jobs WHERE stage_id=$1 AND profile_id=$2`,
      [stageId, profileId],
    );
    return status;
  });
}
