import { describe, expect, it } from 'vitest';
import { buildCompleteScene } from '@/lib/generation/scene-builder';
import type { SceneOutline, GeneratedInteractiveContent } from '@/lib/types/generation';

const outline: SceneOutline = {
  id: 'explorer',
  type: 'interactive',
  title: 'Slope and Intercept Explorer',
  description: 'Explore slope and intercept.',
  keyPoints: ['slope', 'intercept'],
  order: 4,
  widgetType: 'simulation',
  widgetOutline: { concept: 'slope and intercept' },
};

describe('buildCompleteScene type compatibility', () => {
  it('does not build an interactive outline from slide-shaped content', () => {
    const slideContent = {
      elements: [],
      background: undefined,
    } as never;

    expect(buildCompleteScene(outline, slideContent, [], 'stage-1')).toBeNull();
  });

  it('builds an interactive outline from interactive content', () => {
    const content: GeneratedInteractiveContent = {
      html: '<html><body>Slope</body></html>',
      widgetType: 'simulation',
      widgetConfig: {
        type: 'simulation',
        concept: 'slope',
        description: 'Explore slope',
        variables: [],
      },
    };

    expect(buildCompleteScene(outline, content, [], 'stage-1')?.type).toBe('interactive');
  });
});
