import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/fusion/classroom-events/route';
import { ClassroomDiagnosisAdapter } from '@/lib/fusion/adapter/classroom-diagnosis-adapter';

function request(body: unknown) {
  return new NextRequest('http://openmaic.local/api/fusion/classroom-events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('F09 classroom event route', () => {
  it('rejects malformed browser facts without accepting learner overrides', async () => {
    const response = await POST(request({ question: 'q', localAssessment: { gradingMode: 'local' }, learnerId: 'forged' }));
    expect(response.status).toBe(400);
  });
  it('degrades safely when diagnosis is unavailable', async () => {
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('FUSION_DEVELOPMENT_MOCK_ENABLED', 'true'); vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', '');
    const response = await POST(request({ question: '2 + 2 = ?', answer: '3', localAssessment: { gradingMode: 'local', correctness: 'incorrect' } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, diagnosis: null, reasonCode: 'diagnosis_unavailable', continue: true });
  });
  it('plans a remediation directive for an incorrect F08 diagnosis without leaking transport details', async () => {
    vi.spyOn(ClassroomDiagnosisAdapter.prototype, 'diagnoseCheckpoint').mockResolvedValue({ schemaVersion: 'v1', eventId: 'ignored', correctness: 'incorrect', diagnoses: [], teachingIntent: { schemaVersion: 'v1', kind: 'insert_remediation', targetLessonKnowledgePointIds: ['lesson-linear-function-slope'], recommendedStrategy: 'development_mock_concrete_example' }, warnings: [], createdAt: '2026-07-24T00:00:00Z' });
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('FUSION_DEVELOPMENT_MOCK_ENABLED', 'true'); vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://deeptutor.local');
    const response = await POST(request({ question: 'q', answer: 'wrong', localAssessment: { gradingMode: 'local', correctness: 'incorrect' } }));
    await expect(response.json()).resolves.toMatchObject({ success: true, diagnosis: { correctness: 'incorrect' }, directive: { kind: 'insert_remediation', targetSceneId: 'remediate-slope-concrete' } });
  });
});
