import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { CLASSROOM_CONTRACT_SCHEMA_VERSION, type AssessmentCorrectness } from '@/lib/fusion/contracts';
import { ClassroomDiagnosisAdapter, createF08DiagnosisPort, DEVELOPMENT_MOCK_KNOWLEDGE_POINT_ID } from '@/lib/fusion/adapter/classroom-diagnosis-adapter';

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try { const candidate: unknown = await request.json(); if (!record(candidate)) throw new Error(); body = candidate; } catch { return apiError('INVALID_REQUEST', 400, 'Invalid classroom event.'); }
  if (!text(body.question) || !text(body.answer) || !record(body.localAssessment) || !text(body.localAssessment.gradingMode)) return apiError('INVALID_REQUEST', 400, 'Question, answer, and local assessment are required.');
  const correctness = body.localAssessment.correctness;
  if (correctness !== undefined && !['correct', 'incorrect', 'partially_correct', 'unknown'].includes(String(correctness))) return apiError('INVALID_REQUEST', 400, 'Invalid local correctness.');
  const event = { schemaVersion: CLASSROOM_CONTRACT_SCHEMA_VERSION, eventId: crypto.randomUUID(), eventType: 'checkpoint_submitted' as const, lessonSessionId: 'development-lesson-session', courseId: 'development-course', sceneId: 'development-quiz-scene', correlationId: crypto.randomUUID(), checkpointId: 'development-checkpoint', mappingId: 'development-map', mappingRevision: '1', lessonKnowledgePointIds: [DEVELOPMENT_MOCK_KNOWLEDGE_POINT_ID], originalQuestion: body.question, studentAnswer: body.answer, localAssessment: { gradingMode: body.localAssessment.gradingMode, ...(correctness ? { correctness: correctness as AssessmentCorrectness } : {}) }, occurredAt: new Date().toISOString() };
  try {
    const adapter = new ClassroomDiagnosisAdapter({ environment: process.env.NODE_ENV, developmentMockEnabled: process.env.FUSION_DEVELOPMENT_MOCK_ENABLED === 'true' }, createF08DiagnosisPort());
    return apiSuccess({ diagnosis: await adapter.diagnoseCheckpoint(event) });
  } catch {
    return apiSuccess({ diagnosis: null, reasonCode: 'diagnosis_unavailable', continue: true });
  }
}
