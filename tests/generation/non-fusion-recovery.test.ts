import { describe, expect, it } from 'vitest';
import {
  createOrdinaryRecoverySession,
  createRecoveryAudit,
  isNonFusionRecovery,
} from '@/app/generation-preview/non-fusion-recovery';
import { FormalFusionError, formalFusionErrorResponse } from '@/lib/fusion/generation-session';

const failedSession = {
  sessionId: 'fusion-session',
  lessonSessionId: 'opaque-fusion-id',
  requirements: { requirement: 'Teach slope' },
  pdfText: '',
  sceneOutlines: [
    {
      id: 'old',
      type: 'slide' as const,
      title: 'old',
      description: 'old',
      keyPoints: [],
      order: 1,
    },
  ],
  currentStep: 'complete' as const,
  previewPhase: 'outline-ready' as const,
};

describe('F52 explicit non-Fusion recovery', () => {
  it('accepts only a server-declared new ordinary session recovery', () => {
    expect(isNonFusionRecovery({ kind: 'non_fusion', requiresNewSession: true })).toBe(true);
    expect(isNonFusionRecovery({ kind: 'non_fusion', requiresNewSession: false })).toBe(false);
    expect(isNonFusionRecovery({ kind: 'clarification', requiresNewSession: false })).toBe(false);
  });

  it('creates an isolated ordinary session without Fusion identity or frozen output', () => {
    const ordinary = createOrdinaryRecoverySession(failedSession);
    expect(ordinary.sessionId).not.toBe(failedSession.sessionId);
    expect(ordinary).not.toHaveProperty('lessonSessionId');
    expect(ordinary.sceneOutlines).toBeNull();
    expect(ordinary.previewPhase).toBe('preparing');
    expect(ordinary.requirements).toEqual(failedSession.requirements);
  });

  it('records only a non-sensitive recovery reason', () => {
    const audit = createRecoveryAudit('FUSION_CONTEXT_PARTIAL');
    expect(audit).toMatchObject({ source: 'fusion', errorCode: 'FUSION_CONTEXT_PARTIAL' });
    expect(JSON.stringify(audit)).not.toContain('opaque-fusion-id');
  });

  it.each([
    'FUSION_CONTEXT_PARTIAL',
    'FUSION_CONTEXT_UNRESOLVED',
    'FUSION_CONTEXT_REJECTED',
    'FUSION_CONTEXT_PROVIDER_UNAVAILABLE',
  ] as const)('exposes an explicit non-Fusion recovery for %s', async (code) => {
    const response = formalFusionErrorResponse(new FormalFusionError(code));
    const body = await response.json();
    expect(body.recovery).toEqual(
      expect.objectContaining({ kind: 'non_fusion', requiresNewSession: true }),
    );
    expect(JSON.stringify(body)).not.toContain('lessonSessionId');
  });
});
