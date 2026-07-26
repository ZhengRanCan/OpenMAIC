import type { ClassroomEvent, LearningDiagnosis, SceneDirective } from './contracts';
import type { ProductionFusionServices } from './reliability/production-services';
import type { Queryable } from './reliability/postgres';
import type { FusionJsonObject, FusionSessionRecord } from './session-store/types';

export const FUSION_LESSON_FACTS_PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS fusion_classroom_facts (
  event_id TEXT PRIMARY KEY,
  lesson_session_id TEXT NOT NULL,
  learner_id TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS fusion_classroom_facts_lesson_idx
  ON fusion_classroom_facts (lesson_session_id, created_at);
CREATE TABLE IF NOT EXISTS fusion_lesson_completions (
  lesson_session_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  completed_at TIMESTAMPTZ NOT NULL
);
`;

export async function ensureFusionLessonFactsSchema(queryable: Queryable): Promise<void> {
  for (const statement of FUSION_LESSON_FACTS_PG_SCHEMA.split(';')) {
    if (statement.trim()) await queryable.query(statement);
  }
}

type StoredFact = {
  event: ClassroomEvent;
  diagnosis: LearningDiagnosis;
  directive: SceneDirective;
};

function asJson(value: unknown): FusionJsonObject {
  return JSON.parse(JSON.stringify(value)) as FusionJsonObject;
}

/** Persist classroom facts before closeout so completion survives a restart. */
export async function recordPersistentClassroomFact(
  services: ProductionFusionServices,
  session: FusionSessionRecord,
  event: ClassroomEvent,
  diagnosis: LearningDiagnosis,
  directive: SceneDirective,
): Promise<void> {
  await services.outbox.transaction((queryable) =>
    recordPersistentClassroomFactInTransaction(queryable, session, event, diagnosis, directive),
  );
}

export async function recordPersistentClassroomFactInTransaction(
  queryable: Queryable,
  session: FusionSessionRecord,
  event: ClassroomEvent,
  diagnosis: LearningDiagnosis,
  directive: SceneDirective,
): Promise<void> {
  await queryable.query(
    `INSERT INTO fusion_classroom_facts (event_id, lesson_session_id, learner_id, data, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
     ON CONFLICT (event_id) DO NOTHING`,
    [
      event.eventId,
      session.lessonSessionId,
      session.learnerId,
      JSON.stringify(asJson({ event, diagnosis, directive })),
      event.occurredAt,
    ],
  );
}

function mapReferences(session: FusionSessionRecord): Map<string, { namespace: string; scopeId: string; id: string }> {
  const map = session.lessonKnowledgeMap as { knowledgePoints?: unknown };
  const result = new Map<string, { namespace: string; scopeId: string; id: string }>();
  if (!Array.isArray(map.knowledgePoints)) return result;
  for (const point of map.knowledgePoints) {
    if (!point || typeof point !== 'object') continue;
    const typed = point as Record<string, unknown>;
    const ref = typed.authoritativeRef;
    if (
      typeof typed.lessonKnowledgePointId === 'string' &&
      ref &&
      typeof ref === 'object' &&
      typeof (ref as Record<string, unknown>).namespace === 'string' &&
      typeof (ref as Record<string, unknown>).scopeId === 'string' &&
      typeof (ref as Record<string, unknown>).id === 'string'
    ) {
      result.set(typed.lessonKnowledgePointId, ref as { namespace: string; scopeId: string; id: string });
    }
  }
  return result;
}

export type PersistentCloseoutSummary = {
  immediateConclusion: 'classroom_completed';
  profileUpdate: 'queued' | 'duplicate' | 'save_failed';
  longTermProfileStatus: 'not_confirmed';
  candidateId?: string;
  idempotencyKey?: string;
  reasonCode?: string;
};

/**
 * The completion marker and its Outbox message share one PostgreSQL
 * transaction.  Delivery is intentionally not attempted here.
 */
export async function completePersistentLesson(
  services: ProductionFusionServices,
  session: FusionSessionRecord,
  now = new Date(),
): Promise<PersistentCloseoutSummary> {
  try {
    return await services.outbox.transaction(async (queryable) => {
      const existing = await queryable.query<{ candidate_id: string; idempotency_key: string }>(
        'SELECT candidate_id, idempotency_key FROM fusion_lesson_completions WHERE lesson_session_id = $1',
        [session.lessonSessionId],
      );
      if (existing.rows[0]) {
        return {
          immediateConclusion: 'classroom_completed',
          profileUpdate: 'duplicate',
          longTermProfileStatus: 'not_confirmed',
          candidateId: existing.rows[0].candidate_id,
          idempotencyKey: existing.rows[0].idempotency_key,
        };
      }
      const facts = await queryable.query<{ data: unknown }>(
        'SELECT data FROM fusion_classroom_facts WHERE lesson_session_id = $1 ORDER BY created_at ASC',
        [session.lessonSessionId],
      );
      const references = mapReferences(session);
      const storedFacts = facts.rows.map((row) =>
        (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as StoredFact,
      );
      const observations = storedFacts.flatMap((fact) => {
        const point = fact.event.lessonKnowledgePointIds.find((id) => references.has(id));
        if (!point) return [];
        return [{
          kind: fact.diagnosis.correctness === 'incorrect' ? 'misconception_signal' : 'assessment_result',
          lessonKnowledgePointId: point,
          value: fact.diagnosis.correctness,
          ...(fact.diagnosis.diagnoses[0]
            ? { confidence: fact.diagnosis.diagnoses[0].confidence }
            : {}),
          authoritativeRef: references.get(point)!,
        }];
      });
      if (!observations.length) throw new Error('no_qualifying_classroom_facts');
      const mapping = session.lessonKnowledgeMap as { mappingId?: unknown; mappingRevision?: unknown };
      if (typeof mapping.mappingId !== 'string' || typeof mapping.mappingRevision !== 'string') {
        throw new Error('invalid_frozen_knowledge_map');
      }
      const candidateId = `candidate_${session.lessonSessionId}`;
      const candidate = {
        schemaVersion: 'v1',
        candidateId,
        idempotencyKey: candidateId,
        lessonSessionId: session.lessonSessionId,
        sourceEventIds: storedFacts.map((fact) => fact.event.eventId),
        mappingId: mapping.mappingId,
        mappingRevision: mapping.mappingRevision,
        observations,
        createdAt: now.toISOString(),
      };
      await queryable.query(
        `INSERT INTO fusion_lesson_completions (lesson_session_id, candidate_id, idempotency_key, completed_at)
         VALUES ($1, $2, $3, $4::timestamptz)`,
        [session.lessonSessionId, candidateId, candidateId, now.toISOString()],
      );
      await services.outbox.enqueueInTransaction(queryable, {
        idempotencyKey: candidateId,
        kind: 'profile_update_candidate',
        lessonSessionId: session.lessonSessionId,
        learnerKey: session.learnerId,
        credentialRef: session.credentialRef,
        candidateId,
        payload: asJson(candidate),
      }, now);
      return {
        immediateConclusion: 'classroom_completed',
        profileUpdate: 'queued',
        longTermProfileStatus: 'not_confirmed',
        candidateId,
        idempotencyKey: candidateId,
      };
    });
  } catch (error) {
    return {
      immediateConclusion: 'classroom_completed',
      profileUpdate: 'save_failed',
      longTermProfileStatus: 'not_confirmed',
      reasonCode:
        error instanceof Error && error.message === 'no_qualifying_classroom_facts'
          ? 'no_qualifying_classroom_facts'
          : 'candidate_or_outbox_unavailable',
    };
  }
}
