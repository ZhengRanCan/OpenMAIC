import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { ensureFusionOutboxSchema, PgFusionOutboxStore } from '@/lib/fusion/outbox/postgres-store';
import {
  completePersistentLesson,
  ensureFusionLessonFactsSchema,
  recordPersistentClassroomFact,
} from '@/lib/fusion/persistent-lesson';
import type { ProductionFusionServices } from '@/lib/fusion/reliability/production-services';
import type { Queryable } from '@/lib/fusion/reliability/postgres';
import type { FusionSessionRecord } from '@/lib/fusion/session-store/types';

describe('F20 persistent lesson closeout', () => {
  let db: PGlite;
  let services: ProductionFusionServices;
  const session: FusionSessionRecord = {
    schemaVersion: 'v1',
    lessonSessionId: 'lesson-f20',
    learnerId: 'allowlisted-synthetic-learner',
    credentialRef: 'fusion/delegations/reference-only',
    profileSnapshot: { schemaVersion: 'v1', learnerId: 'allowlisted-synthetic-learner' },
    lessonKnowledgeMap: {
      schemaVersion: 'v1',
      mappingId: 'map-f20',
      mappingRevision: '1',
      knowledgePoints: [
        {
          lessonKnowledgePointId: 'point-1',
          authoritativeRef: { namespace: 'test', scopeId: 'lesson', id: 'point-1' },
        },
      ],
    },
    sceneCatalog: {},
    runtimeState: {},
    degradationState: 'none',
    snapshotCapturedAt: '2026-01-01T00:00:00.000Z',
    revision: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2030-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    const queryable = db as unknown as Queryable;
    await ensureFusionOutboxSchema(queryable);
    await ensureFusionLessonFactsSchema(queryable);
    services = {
      outbox: new PgFusionOutboxStore(queryable, (body) =>
        db.transaction((tx) => body(tx as unknown as Queryable)),
      ),
    } as ProductionFusionServices;
  });

  afterEach(async () => {
    await db.close();
  });

  it('commits the completion fact and reference-only Candidate Outbox row together', async () => {
    const event = {
      schemaVersion: 'v1' as const,
      eventId: 'event-f20',
      eventType: 'checkpoint_submitted' as const,
      lessonSessionId: session.lessonSessionId,
      courseId: 'course',
      sceneId: 'checkpoint',
      correlationId: 'correlation',
      checkpointId: 'checkpoint',
      mappingId: 'map-f20',
      mappingRevision: '1',
      lessonKnowledgePointIds: ['point-1'],
      originalQuestion: 'synthetic question',
      studentAnswer: 'synthetic answer',
      localAssessment: { gradingMode: 'synthetic', correctness: 'incorrect' as const },
      occurredAt: '2026-01-01T00:00:00.000Z',
    };
    const diagnosis = {
      schemaVersion: 'v1' as const,
      eventId: event.eventId,
      correctness: 'incorrect' as const,
      diagnoses: [{ lessonKnowledgePointId: 'point-1', misconception: 'synthetic', confidence: 0.7 }],
      teachingIntent: {
        schemaVersion: 'v1' as const,
        kind: 'insert_remediation' as const,
        targetLessonKnowledgePointIds: ['point-1'],
        recommendedStrategy: 'synthetic',
      },
      warnings: [],
      createdAt: event.occurredAt,
    };
    const directive = {
      schemaVersion: 'v1' as const,
      directiveId: 'directive-f20',
      sourceEventId: event.eventId,
      kind: 'insert_remediation' as const,
      targetSceneId: 'remediation',
      expectedRuntimeRevision: 0,
    };
    await recordPersistentClassroomFact(services, session, event, diagnosis, directive);
    const first = await completePersistentLesson(services, session, new Date(event.occurredAt));
    const second = await completePersistentLesson(services, session, new Date(event.occurredAt));
    expect(first).toMatchObject({
      profileUpdate: 'queued',
      longTermProfileStatus: 'not_confirmed',
      candidateId: 'candidate_lesson-f20',
      idempotencyKey: 'candidate_lesson-f20',
    });
    expect(second).toMatchObject({
      profileUpdate: 'duplicate',
      candidateId: first.candidateId,
      idempotencyKey: first.idempotencyKey,
      longTermProfileStatus: 'not_confirmed',
    });
    const message = await services.outbox.acquire('worker-f20', 30_000, new Date(event.occurredAt));
    expect(message).toMatchObject({
      candidateId: first.candidateId,
      idempotencyKey: first.idempotencyKey,
      learnerKey: session.learnerId,
    });
    expect(JSON.stringify(message)).not.toContain('synthetic answer');
    expect(JSON.stringify(message!.payload)).not.toMatch(/token|secret|password/i);
    await services.outbox.complete(message!, { status: 'accepted' });
    await expect(services.outbox.getDelivery(first.idempotencyKey!)).resolves.toMatchObject({
      status: 'delivered',
      receipt: { status: 'accepted' },
    });
  });
});
