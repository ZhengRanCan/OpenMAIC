import {
  listLearnerProfilesIn,
  nameLearnerProfileIn,
  readClassroomLearnerProfileIn,
  readLastClassroomProfileIdIn,
} from '@/lib/persistence/learner-profiles';
import type { LearnerProfileOptions } from '@/lib/learner-context/learner-profile-contracts';
import { fenceOwnerWrite } from '@/lib/persistence/owner-merges';

import { generationRunPersistence } from './generation/run/store';

export async function listLearnerProfiles(ownerId: string) {
  const { withTransaction } = await generationRunPersistence();
  return withTransaction((tx) => listLearnerProfilesIn(tx, ownerId));
}

export async function readLearnerProfileOptions(ownerId: string): Promise<LearnerProfileOptions> {
  const { withTransaction } = await generationRunPersistence();
  return withTransaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const profiles = await listLearnerProfilesIn(tx, ownerId);
    const bound = profiles.length ? await readLastClassroomProfileIdIn(tx, ownerId) : null;
    const lastProfileId = profiles.find(({ id }) => id === bound)?.id ?? null;
    return { profiles, lastProfileId };
  });
}

export async function readClassroomLearnerProfile(ownerId: string, stageId: string) {
  const { withTransaction } = await generationRunPersistence();
  return withTransaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    return readClassroomLearnerProfileIn(tx, ownerId, stageId);
  });
}

export async function nameLearnerProfile(ownerId: string, profileId: string, name: string) {
  const { withTransaction } = await generationRunPersistence();
  return withTransaction(async (tx) => {
    await fenceOwnerWrite(tx, ownerId);
    return nameLearnerProfileIn(tx, ownerId, profileId, name);
  });
}
