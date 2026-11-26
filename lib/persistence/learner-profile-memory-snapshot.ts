import type { Queryable } from '@openmaic/storage/document/pg';
import { sourceKey } from '@/lib/learner-memory/contracts';
import { projectMemory } from '@/lib/learner-memory/read';
import {
  classroomMemorySources,
  type ClassroomMemorySource,
  type ProfileMemorySnapshot,
} from '@/lib/learner-memory/profile-memory-snapshot';
import type { ProfileMemorySource } from '@/lib/learner-memory/profile-memory-contracts';
import {
  PROFILE_MEMORY_JOB_AUTHORIZED,
  profileMemorySourceVersion,
  readProfileMemorySource,
  type ProfileSourceLocator,
} from './learner-profile-memory-source';

export async function readProfileSnapshotIn(tx: Queryable, profileId: string, lock = false) {
  const {
    rows: [profile],
  } = await tx.query<{
    memory_revision: number;
    memory_snapshot: ProfileMemorySnapshot | null;
  }>(
    `SELECT memory_revision,memory_snapshot FROM learner_profiles WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
    [profileId],
  );
  return profile;
}

export async function readSnapshotRestrictionsIn(tx: Queryable, profileId: string, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const { rows } = await tx.query<{ source_id: string }>(
    'SELECT source_id FROM learner_profile_memory_restrictions WHERE profile_id=$1 AND source_id=ANY($2::text[])',
    [profileId, ids],
  );
  return new Set(rows.map(({ source_id }) => source_id));
}

/** Reload authorized evidence once per activity/version, even when multiple pieces cite it. */
export async function readSnapshotEvidenceIn(
  tx: Queryable,
  ownerId: string,
  profileId: string,
  supports: ClassroomMemorySource[],
  history = false,
) {
  const evidence = new Map<string, ProfileMemorySource>();
  if (!supports.length) return evidence;
  const { rows } = await tx.query<ProfileSourceLocator & { id: string; title: string }>(
    `SELECT j.id,j.stage_id,j.profile_id,j.kind,j.activity_id,j.record_id,j.manually_added,d.name AS title
     FROM learner_profile_memory_jobs j
     JOIN stage_meta s ON s.stage_id=j.stage_id AND s.owner_id=$2 AND s.deleted_at IS NULL
     JOIN document_stages d ON d.id=s.stage_id
     WHERE j.profile_id=$1 AND j.id=ANY($3::uuid[]) AND ${PROFILE_MEMORY_JOB_AUTHORIZED}`,
    [profileId, ownerId, [...new Set(supports.map(({ jobId }) => jobId))]],
  );
  const jobs = new Map(rows.map((job) => [job.id, job]));
  const cache = new Map<string, ProfileMemorySource | null>();
  for (const support of supports) {
    const job = jobs.get(support.jobId);
    if (!job || support.id !== `${job.id}:${support.partIndex}`) continue;
    const cacheKey = `${job.id}:${support.sourceDigest}`;
    if (!cache.has(cacheKey)) {
      const source = await readProfileMemorySource(
        tx,
        { ...job, review_id: history ? support.reviewId : null },
        { owner_id: ownerId, title: job.title },
        history,
      ).catch((error: unknown) => {
        if (error instanceof Error && error.message === 'PROFILE_MEMORY_DIALOGUE_UNREADABLE')
          return null;
        throw error;
      });
      cache.set(cacheKey, profileMemorySourceVersion(source, support.sourceDigest)?.basis ?? null);
    }
    const basis = cache.get(cacheKey);
    const part = basis?.parts[support.partIndex];
    if (basis && part) {
      evidence.set(sourceKey(support), {
        ...basis,
        parts: [part],
        ...(basis.reviewHistory && {
          reviewHistory: basis.reviewHistory.map((review) => ({
            ...review,
            results: [review.results[support.partIndex]],
          })),
        }),
      });
    }
  }
  return evidence;
}

export async function inspectProfileSnapshotIn(
  tx: Queryable,
  owner: string,
  profileId: string,
  snapshot: ProfileMemorySnapshot,
) {
  const supports = snapshot.pieces.flatMap((piece) => piece.supports);
  const evidence = await readSnapshotEvidenceIn(tx, owner, profileId, supports);
  const flagged = await readSnapshotRestrictionsIn(
    tx,
    profileId,
    supports.map(({ id }) => id),
  );
  const pieces = snapshot.pieces.map((piece) => {
    const restricted = piece.supports.some(
      (source) => !evidence.has(sourceKey(source)) || flagged.has(source.id),
    );
    return { ...piece, restrictions: restricted ? ['SOURCE_REVIEW_REQUIRED'] : [] };
  });
  return {
    snapshot: { ...snapshot, pieces },
    evidence,
    flagged,
    // Valid supports remain available for a partially invalid piece to be revised.
    available: [
      ...new Map(
        supports.flatMap((support) => {
          const basis = evidence.get(sourceKey(support));
          if (!basis || flagged.has(support.id)) return [];
          // The projection contains just the cited part. Retain its original locator and version.
          const [part] = classroomMemorySources(
            support.jobId,
            support.sourceDigest,
            support.reviewId,
            basis,
          );
          return part ? ([[sourceKey(support), { ...support, text: part.text }]] as const) : [];
        }),
      ).values(),
    ],
  };
}

export async function readTrustedProfileSnapshotIn(
  tx: Queryable,
  owner: string,
  profileId: string,
  snapshot: ProfileMemorySnapshot,
) {
  const inspected = await inspectProfileSnapshotIn(tx, owner, profileId, snapshot);
  return { ...inspected, usable: projectMemory(inspected.snapshot) };
}
