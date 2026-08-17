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
  return {
    sessionId: nanoid(),
    // Only the learner-entered requirement is carried across. Fusion-owned
    // profile, map, guidance, frozen context, research and source material are
    // intentionally discarded before ordinary generation starts.
    requirements: { requirement: failedSession.requirements.requirement },
    pdfText: '',
    pdfImages: [],
    imageStorageIds: [],
    documentSources: [],
    imageMapping: undefined,
    researchContext: undefined,
    researchSources: [],
    sceneOutlines: null,
    currentStep: 'generating',
    previewPhase: 'preparing',
  };
}

export function createRecoveryAudit(errorCode: string): RecoveryAudit {
  return { source: 'fusion', errorCode, createdAt: Date.now() };
}
