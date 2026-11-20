import {
  listLearnerProfilesIn,
  nameLearnerProfileIn,
  readClassroomLearnerProfileIn,
} from '@/lib/persistence/learner-profiles';
import { fenceOwnerWrite } from '@/lib/persistence/owner-merges';

import { generationRunPersistence } from './generation/run/store';

export async function listLearnerProfiles(ownerId: string) {
  const { withTransaction } = await generationRunPersistence();
  return withTransaction((tx) => listLearnerProfilesIn(tx, ownerId));
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
