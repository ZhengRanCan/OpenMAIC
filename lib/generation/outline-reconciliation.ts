import type { SceneOutline } from '@/lib/types/generation';

export type OutlineContentShape = 'slide-shaped' | 'quiz-shaped' | 'interactive-shaped' | 'pbl-shaped' | 'unknown';

export interface OutlineFallbackEvidence {
  reason: 'content-route-fallback';
  requestedType: SceneOutline['type'];
  effectiveType: SceneOutline['type'];
  contentShape: OutlineContentShape;
}

export type OutlineReconciliationReason =
  | 'server-canonical'
  | 'browser-fallback-compatible'
  | 'content-compatible'
  | 'mismatch-fail-closed';

export class OutlineContentTypeMismatchError extends Error {
  readonly code = 'OUTLINE_CONTENT_TYPE_MISMATCH' as const;

  constructor(
    readonly diagnostics: {
      sceneId: string;
      browserType: SceneOutline['type'];
      serverType: SceneOutline['type'];
      contentShape: OutlineContentShape;
      reason: OutlineReconciliationReason;
    },
  ) {
    super(
      `Outline/content type mismatch (scene id=${diagnostics.sceneId}, browser type=${diagnostics.browserType}, server type=${diagnostics.serverType}, content shape=${diagnostics.contentShape})`,
    );
    this.name = 'OutlineContentTypeMismatchError';
  }
}

export function classifyOutlineContent(content: unknown): OutlineContentShape {
  if (!content || typeof content !== 'object') return 'unknown';
  if ('elements' in content) return 'slide-shaped';
  if ('questions' in content) return 'quiz-shaped';
  if ('html' in content) return 'interactive-shaped';
  if ('projectConfig' in content) return 'pbl-shaped';
  return 'unknown';
}

function isCompatible(type: SceneOutline['type'], shape: OutlineContentShape): boolean {
  return (
    (type === 'slide' && shape === 'slide-shaped') ||
    (type === 'quiz' && shape === 'quiz-shaped') ||
    (type === 'interactive' && shape === 'interactive-shaped') ||
    (type === 'pbl' && shape === 'pbl-shaped')
  );
}

export function reconcileFusionOutline(input: {
  serverOutline: SceneOutline;
  browserOutline: SceneOutline;
  content: unknown;
  fallbackEvidence?: OutlineFallbackEvidence;
}): { outline: SceneOutline; contentShape: OutlineContentShape; reason: OutlineReconciliationReason } {
  const { serverOutline, browserOutline } = input;
  const contentShape = classifyOutlineContent(input.content);

  if (isCompatible(serverOutline.type, contentShape)) {
    return {
      outline: serverOutline,
      contentShape,
      reason: 'server-canonical',
    };
  }

  if (
    serverOutline.type === 'interactive' &&
    browserOutline.type === 'slide' &&
    contentShape === 'slide-shaped' &&
    input.fallbackEvidence?.reason === 'content-route-fallback' &&
    input.fallbackEvidence.requestedType === browserOutline.type &&
    input.fallbackEvidence.effectiveType === 'slide' &&
    input.fallbackEvidence.contentShape === contentShape
  ) {
    return {
      // Only the generation type changes. Every server-owned Fusion field and
      // every other canonical outline field remains server-owned.
      outline: { ...serverOutline, type: 'slide' },
      contentShape,
      reason: 'browser-fallback-compatible',
    };
  }

  throw new OutlineContentTypeMismatchError({
    sceneId: serverOutline.id,
    browserType: browserOutline.type,
    serverType: serverOutline.type,
    contentShape,
    reason: 'mismatch-fail-closed',
  });
}
