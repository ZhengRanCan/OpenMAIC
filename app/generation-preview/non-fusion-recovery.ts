import { nanoid } from 'nanoid';
import type { GenerationSessionState } from './types';

export type NonFusionRecovery = {
  kind: 'non_fusion';
  requiresNewSession: true;
  message?: string;
};

export type RecoveryAudit = {
  source: 'fusion';
  errorCode: string;
  createdAt: number;
};

export function isNonFusionRecovery(value: unknown): value is NonFusionRecovery {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return entry.kind === 'non_fusion' && entry.requiresNewSession === true;
}

export function createOrdinaryRecoverySession(
  failedSession: GenerationSessionState,
): GenerationSessionState {
  const { lessonSessionId: _lessonSessionId, ...ordinary } = failedSession;
  return {
    ...ordinary,
    sessionId: nanoid(),
    sceneOutlines: null,
    currentStep: 'generating',
    previewPhase: 'preparing',
  };
}

export function createRecoveryAudit(errorCode: string): RecoveryAudit {
  return { source: 'fusion', errorCode, createdAt: Date.now() };
}
