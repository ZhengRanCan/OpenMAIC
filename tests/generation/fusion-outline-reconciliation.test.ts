import { describe, expect, test } from 'vitest';
import {
  OutlineContentTypeMismatchError,
  reconcileFusionOutline,
} from '@/lib/generation/outline-reconciliation';
import type { SceneOutline } from '@/lib/types/generation';

const fusionCheckpoint = {
  checkpointId: 'checkpoint-1',
  mappingId: 'mapping-1',
  mappingRevision: 'rev-1',
  lessonKnowledgePointIds: ['kp-1'],
  remediationStrategy: 'targeted-review',
};

function outline(type: SceneOutline['type']): SceneOutline {
  return {
    id: 'scene-5', type, title: 'Slope Explorer', description: 'Explore slopes',
    keyPoints: ['m', 'b'], order: 5, fusionCheckpoint,
    widgetType: type === 'interactive' ? 'simulation' : undefined,
    widgetOutline: type === 'interactive' ? ({ prompt: 'change m and b' } as never) : undefined,
  };
}

const fallbackEvidence = {
  reason: 'content-route-fallback' as const,
  requestedType: 'interactive' as const,
  effectiveType: 'slide' as const,
  contentShape: 'slide-shaped' as const,
};

describe('Fusion outline reconciliation', () => {
  test('downgrades server interactive when browser already effective slide content agrees', () => {
    const result = reconcileFusionOutline({
      serverOutline: outline('interactive'), browserOutline: outline('slide'),
      content: { elements: [] }, fallbackEvidence,
    });
    expect(result.outline.type).toBe('slide');
    expect(result.outline.fusionCheckpoint).toEqual(fusionCheckpoint);
    expect(result.reason).toBe('browser-fallback-compatible');
  });

  test('keeps canonical interactive outline for interactive content', () => {
    const result = reconcileFusionOutline({
      serverOutline: outline('interactive'), browserOutline: outline('interactive'),
      content: { html: '<div>ok</div>' },
    });
    expect(result.outline).toEqual(outline('interactive'));
  });

  test('fails closed without fallback evidence', () => {
    expect(() => reconcileFusionOutline({
      serverOutline: outline('interactive'), browserOutline: outline('slide'), content: { elements: [] },
    })).toThrowError(OutlineContentTypeMismatchError);
  });

  test('rejects slide content with interactive request and mismatched evidence', () => {
    expect(() => reconcileFusionOutline({
      serverOutline: outline('interactive'), browserOutline: outline('interactive'),
      content: { elements: [] }, fallbackEvidence: { ...fallbackEvidence, requestedType: 'slide' },
    })).toThrowError(OutlineContentTypeMismatchError);
  });
});
