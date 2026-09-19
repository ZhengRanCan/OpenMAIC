import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneOutline } from '@/lib/types/generation';

const mocks = vi.hoisted(() => ({
  setOutlines: vi.fn(),
  getState: vi.fn(),
}));

vi.mock('@/lib/store/stage', () => ({
  useStageStore: {
    getState: mocks.getState,
  },
}));

const baseOutline = {
  id: 'scene_4',
  type: 'interactive',
  title: 'Slope and Intercept Explorer',
  description: 'Explore linear functions',
  keyPoints: ['slope', 'intercept'],
  order: 4,
} as SceneOutline;

describe('single-scene outline fallback synchronization', () => {
  beforeEach(() => {
    mocks.setOutlines.mockReset();
    mocks.getState.mockReturnValue({
      outlines: [baseOutline, { ...baseOutline, id: 'scene_5', order: 5 }],
      setOutlines: mocks.setOutlines,
    });
  });

  it('updates the canonical global outline when the server returns a slide fallback', async () => {
    const { synchronizeEffectiveOutline } = await import('@/lib/hooks/use-scene-generator');
    const effective = { ...baseOutline, type: 'slide' } as SceneOutline;

    expect(synchronizeEffectiveOutline(baseOutline, effective)).toBe(effective);
    expect(mocks.setOutlines).toHaveBeenCalledWith([
      effective,
      { ...baseOutline, id: 'scene_5', order: 5 },
    ]);
  });

  it('synchronizes normalized configuration even when the type is unchanged', async () => {
    const { synchronizeEffectiveOutline } = await import('@/lib/hooks/use-scene-generator');
    const effective = { ...baseOutline, description: 'normalized description' } as SceneOutline;

    expect(synchronizeEffectiveOutline(baseOutline, effective)).toBe(effective);
    expect(mocks.setOutlines).toHaveBeenCalledWith([
      effective,
      { ...baseOutline, id: 'scene_5', order: 5 },
    ]);
  });

  it('does not rewrite state when the effective outline is already canonical', async () => {
    const { synchronizeEffectiveOutline } = await import('@/lib/hooks/use-scene-generator');
    const effective = { ...baseOutline } as SceneOutline;

    expect(synchronizeEffectiveOutline(baseOutline, effective)).toEqual(baseOutline);
    expect(mocks.setOutlines).not.toHaveBeenCalled();
  });
});
