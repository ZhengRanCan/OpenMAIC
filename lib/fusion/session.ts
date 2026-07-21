import { FUSION_CONTRACT_VERSION, type FusionLessonSession, type FusionTeachingContext } from './contracts';

function createSessionId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `fusion_${uuid}` : `fusion_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Freezes the exact profile and teaching strategy used for one lesson run.
 * Persistence is intentionally owned by the caller (generation state today,
 * a dedicated classroom record later), keeping this module runtime-agnostic.
 */
export function createFusionLessonSession(
  context: FusionTeachingContext,
  options: { id?: string; createdAt?: string } = {},
): FusionLessonSession {
  return {
    contractVersion: FUSION_CONTRACT_VERSION,
    id: options.id ?? createSessionId(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    context,
  };
}

export function getFusionPromptText(session: FusionLessonSession): string {
  return session.context.promptText;
}
