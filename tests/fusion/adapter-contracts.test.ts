import { describe, expect, it } from 'vitest';
import { CLASSROOM_CONTRACT_SCHEMA_VERSION, ClassroomContractError, parseClassroomEvent } from '@/lib/fusion/contracts';
import {
  ClassroomDiagnosisAdapter,
  DevelopmentOnlyConfigurationError,
  DEVELOPMENT_MOCK_KNOWLEDGE_POINT_ID,
  DEVELOPMENT_MOCK_LEARNER_ID,
} from '@/lib/fusion/adapter/classroom-diagnosis-adapter';

function event() {
  return {
    schemaVersion: CLASSROOM_CONTRACT_SCHEMA_VERSION, eventId: 'event-1', eventType: 'checkpoint_submitted',
    lessonSessionId: 'lesson-1', courseId: 'course-1', sceneId: 'scene-1', correlationId: 'correlation-1', checkpointId: 'checkpoint-1',
    mappingId: 'map-1', mappingRevision: '1', lessonKnowledgePointIds: [DEVELOPMENT_MOCK_KNOWLEDGE_POINT_ID],
    originalQuestion: '2 + 2 = ?', studentAnswer: '3', localAssessment: { gradingMode: 'exact', correctness: 'incorrect' },
    occurredAt: '2026-07-24T00:00:00.000Z',
  } as const;
}

describe('F07 classroom diagnosis adapter', () => {
  it('keeps eventId and correlationId intact across the server-side facade', async () => {
    const adapter = new ClassroomDiagnosisAdapter(
      { environment: 'test', developmentMockEnabled: true },
      { diagnose: async (submitted) => ({
        schemaVersion: CLASSROOM_CONTRACT_SCHEMA_VERSION, eventId: submitted.eventId, correctness: 'incorrect',
        diagnoses: [{ lessonKnowledgePointId: DEVELOPMENT_MOCK_KNOWLEDGE_POINT_ID, misconception: 'mock_mismatch', confidence: 1 }],
        teachingIntent: { schemaVersion: CLASSROOM_CONTRACT_SCHEMA_VERSION, kind: 'insert_remediation', targetLessonKnowledgePointIds: [DEVELOPMENT_MOCK_KNOWLEDGE_POINT_ID], recommendedStrategy: 'development_mock_concrete_example' },
        warnings: ['development_mock_only'], createdAt: submitted.occurredAt,
      }) },
    );
    const diagnosis = await adapter.diagnoseCheckpoint(event());
    expect(diagnosis.eventId).toBe(event().eventId);
    expect(adapter.learnerId).toBe(DEVELOPMENT_MOCK_LEARNER_ID);
  });

  it('rejects forged events, production mock configuration, and unknown intents', async () => {
    expect(() => parseClassroomEvent({ ...event(), schemaVersion: 'v2' })).toThrow(ClassroomContractError);
    expect(() => new ClassroomDiagnosisAdapter({ environment: 'production', developmentMockEnabled: true }, { diagnose: async () => ({}) })).toThrow(DevelopmentOnlyConfigurationError);
    const adapter = new ClassroomDiagnosisAdapter(
      { environment: 'test', developmentMockEnabled: true },
      { diagnose: async () => ({ schemaVersion: CLASSROOM_CONTRACT_SCHEMA_VERSION, eventId: event().eventId, correctness: 'incorrect', diagnoses: [], teachingIntent: { schemaVersion: CLASSROOM_CONTRACT_SCHEMA_VERSION, kind: 'unknown', targetLessonKnowledgePointIds: [], recommendedStrategy: 'x' }, warnings: [], createdAt: event().occurredAt }) },
    );
    await expect(adapter.diagnoseCheckpoint(event())).rejects.toThrow(ClassroomContractError);
  });
});
