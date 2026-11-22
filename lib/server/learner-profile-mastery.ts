import type { Queryable } from '@openmaic/storage/document/pg';
import { z } from 'zod';
import { digest } from '@/lib/learner-memory/contracts';
import type { MasteryCard, MasteryCardObservation } from '@/lib/learner-mastery/classroom';
import {
  readProfileMemorySource,
  readProfileSourceAccess,
} from '@/lib/persistence/learner-profile-memory-source';
import { assertLearnerProfileIn } from '@/lib/persistence/learner-profiles';
import { generationRunPersistence } from './generation/run/store';
import type { CourseTarget } from './generation/run/types';
import type { PlannerMastery } from './learner-mastery';

const observation = z.strictObject({
  evidenceRef: z.string().min(1),
  coverage: z.enum(['direct', 'partial', 'context', 'unrelated']),
  result: z.enum(['correct', 'partial', 'incorrect', 'ungraded']),
  assistance: z.enum(['independent', 'assisted', 'unknown']),
  text: z.string().trim().min(1).max(1000),
});
export const profileMasteryReferenceSchema = z.strictObject({
  evidenceRef: z.string().min(1),
  kind: z.enum(['quiz', 'discussion', 'qa']),
  activityId: z.string().min(1),
  recordId: z.string().min(1),
  reviewId: z.string().min(1).nullable(),
  digest: z.string().min(1),
  parts: z.array(z.number().int().nonnegative()).min(1).max(24),
  conditions: z.array(z.string().trim().min(1).max(500)).max(8),
});
export type ProfileMasteryReference = z.infer<typeof profileMasteryReferenceSchema>;
export const storedProfileMasterySchema = z.object({
  state: z.strictObject({
    targetStatement: z.string().min(1),
    summary: z.string().trim().min(1).max(1000),
    unverified: z.array(z.string().trim().min(1).max(1000)).max(2),
    observations: z.array(observation).min(1).max(24),
  }),
  sources: z.array(profileMasteryReferenceSchema).min(1).max(24),
});
type ProfileMasteryRow = Record<string, unknown> & { state: unknown; sources: unknown };

export async function readVerifiedProfileMasterySource(
  tx: Queryable,
  ownerId: string,
  profileId: string,
  stageId: string,
  ref: ProfileMasteryReference,
) {
  if ((ref.kind === 'quiz') !== (ref.reviewId !== null)) return;
  const locator = {
    stage_id: stageId,
    profile_id: profileId,
    kind: ref.kind,
    activity_id: ref.activityId,
    record_id: ref.recordId,
    review_id: ref.reviewId,
  };
  const access = await readProfileSourceAccess(tx, locator);
  if (access?.owner_id !== ownerId) return;
  const source = await readProfileMemorySource(tx, locator, access).catch((error: unknown) => {
    if (error instanceof Error && error.message === 'PROFILE_MEMORY_DIALOGUE_UNREADABLE')
      return null;
    throw error;
  });
  if (
    source?.digest === ref.digest &&
    !source.basis.historicalReview &&
    new Set(ref.parts).size === ref.parts.length &&
    ref.parts.every((index) => source.basis.parts[index])
  )
    return source;
}

async function readCard(
  tx: Queryable,
  ownerId: string,
  profileId: string,
  stageId: string,
  target: CourseTarget,
  row: ProfileMasteryRow,
): Promise<MasteryCard> {
  const parsed = storedProfileMasterySchema.safeParse(row);
  const unavailable = { target, status: 'unavailable' } as const;
  if (!parsed.success || parsed.data.state.targetStatement !== target.statement) return unavailable;
  const { state, sources } = parsed.data;
  const byRef = new Map(sources.map((source) => [source.evidenceRef, source]));
  const refs = new Set(state.observations.map((item) => item.evidenceRef));
  if (
    byRef.size !== sources.length ||
    refs.size !== state.observations.length ||
    refs.size !== byRef.size
  ) {
    return unavailable;
  }
  const observations: MasteryCardObservation[] = [];
  for (const item of state.observations) {
    const ref = byRef.get(item.evidenceRef);
    if (!ref) return unavailable;
    const source = await readVerifiedProfileMasterySource(tx, ownerId, profileId, stageId, ref);
    if (!source) return unavailable;
    const { title, occurredAt } = source.basis;
    if (source.quizQuestions) {
      observations.push({
        ...item,
        conditions: ref.conditions,
        source: {
          kind: 'quiz',
          title,
          occurredAt,
          questions: ref.parts.map((index) => source.quizQuestions![index]),
        },
      });
    } else {
      observations.push({
        ...item,
        conditions: ref.conditions,
        source: {
          kind: 'dialogue',
          title,
          occurredAt,
          messages: ref.parts.flatMap((index) => {
            const part = source.basis.parts[index];
            return [...(part.previous ?? []), { role: 'student', text: part.answer }];
          }),
        },
      });
    }
  }
  return {
    target,
    status: 'ready',
    summary: state.summary,
    unverified: state.unverified,
    observations,
  };
}

export async function readProfileMasteryCardIn(
  tx: Queryable,
  ownerId: string,
  profileId: string,
  stageId: string,
  target: CourseTarget,
): Promise<MasteryCard> {
  await assertLearnerProfileIn(tx, ownerId, profileId);
  const {
    rows: [row],
  } = await tx.query<ProfileMasteryRow>(
    `SELECT m.state,m.sources FROM learner_profile_mastery m
       JOIN classroom_learner_profiles b ON b.stage_id=m.stage_id
       JOIN stage_meta s ON s.stage_id=b.stage_id AND s.owner_id=$5 AND s.deleted_at IS NULL
       WHERE m.stage_id=$1 AND b.profile_id=$2 AND m.target_id=$3 AND m.target_revision=$4`,
    [stageId, profileId, target.id, target.revision, ownerId],
  );
  const card: MasteryCard = row
    ? await readCard(tx, ownerId, profileId, stageId, target, row)
    : { target, status: 'empty' };
  if (process.env.OPENMAIC_AUTOMATIC_MASTERY !== 'true') return card;
  const {
    rows: [job],
  } = await tx.query<{ state: string }>(
    `SELECT state FROM learner_profile_mastery_jobs
       WHERE stage_id=$1 AND profile_id=$2 AND target_id=$3 AND target_revision=$4
       ORDER BY CASE WHEN state IN ('queued','running') THEN 0 ELSE 1 END,ready_at DESC,id LIMIT 1`,
    [stageId, profileId, target.id, target.revision],
  );
  if (job?.state === 'queued' || job?.state === 'running') return { ...card, update: 'pending' };
  if (job?.state === 'failed') return { ...card, update: 'failed' };
  return card;
}

export async function readProfilePlannerMastery(
  ownerId: string,
  profileId: string,
  locator?: { stageId: string; targetId: string; revision: number },
): Promise<Array<PlannerMastery & { sourceVersion: string; sourceStageId: string }>> {
  const provider = await generationRunPersistence();
  return provider.withTransaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await assertLearnerProfileIn(tx, ownerId, profileId);
    const { rows } = await tx.query<ProfileMasteryRow & { stage_id: string; target: CourseTarget }>(
      `SELECT m.stage_id,m.state,m.sources,item AS target
         FROM classroom_learner_profiles b JOIN learner_profile_mastery m ON m.stage_id=b.stage_id
         JOIN stage_meta s ON s.stage_id=b.stage_id AND s.owner_id=$1 AND s.deleted_at IS NULL
         JOIN generation_runs r ON r.id=b.run_id AND r.stage_id=b.stage_id
           AND r.owner_id=$1 AND r.state='completed'
           AND COALESCE(r.outline->>'taskEngineMode', 'false')='false'
         CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.outline->'targets')='array'
           THEN r.outline->'targets' ELSE '[]'::jsonb END) item
         WHERE b.profile_id=$2 AND item->>'id'=m.target_id
           AND item->>'revision'=m.target_revision::text AND item->>'statement' IS NOT NULL
           AND ($3::text IS NULL OR (m.stage_id=$3 AND m.target_id=$4 AND m.target_revision=$5))
         ORDER BY m.updated_at DESC,m.stage_id,m.target_id LIMIT 12`,
      [
        ownerId,
        profileId,
        locator?.stageId ?? null,
        locator?.targetId ?? null,
        locator?.revision ?? null,
      ],
    );
    const candidates: Array<PlannerMastery & { sourceVersion: string; sourceStageId: string }> = [];
    for (const row of rows) {
      const card = await readCard(tx, ownerId, profileId, row.stage_id, row.target, row);
      if (card.status !== 'ready' || !card.observations || !card.summary) continue;
      candidates.push({
        target: card.target,
        sourceVersion: digest([row.stage_id, row.sources]),
        sourceStageId: row.stage_id,
        summary: card.summary,
        unverified: card.unverified ?? [],
        observations: card.observations
          .slice(-4)
          .map(({ source: _source, evidenceRef: _ref, ...item }) => item),
      });
    }
    return candidates;
  });
}
