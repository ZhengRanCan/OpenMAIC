import { describe, expect, it } from 'vitest';
import {
  captureChatSessionInitialContext,
  isChatSessionInitialContext,
} from '@/lib/chat/session-initial-context';

const state = {
  stage: { id: 'stage-a', name: '课堂A' },
  scenes: [{ id: 'scene-a', stageId: 'stage-a', title: '场景A' }],
  currentSceneId: 'scene-a',
};

describe('chat initial context', () => {
  it('captures one matching stage/scene snapshot without retaining mutable references', () => {
    const input = structuredClone(state);
    const result = captureChatSessionInitialContext(input);
    input.stage.name = 'renamed';
    input.scenes[0].title = 'renamed';
    expect(result).toEqual({
      stageId: 'stage-a',
      stageTitle: '课堂A',
      sceneId: 'scene-a',
      sceneTitle: '场景A',
    });
  });

  it('does not invent stage or scene background', () => {
    expect(captureChatSessionInitialContext({ ...state, stage: null })).toBeUndefined();
    expect(captureChatSessionInitialContext({ ...state, currentSceneId: 'missing' })).toEqual({
      stageId: 'stage-a',
      stageTitle: '课堂A',
    });
    expect(
      captureChatSessionInitialContext({
        ...state,
        scenes: [{ ...state.scenes[0], stageId: 'other' }],
      }),
    ).toEqual({ stageId: 'stage-a', stageTitle: '课堂A' });
  });

  it('accepts empty recorded titles but rejects malformed or unpaired scene fields', () => {
    expect(isChatSessionInitialContext({ stageId: 'a', stageTitle: '' })).toBe(true);
    for (const value of [
      null,
      [],
      {},
      { stageId: 'a', stageTitle: 2 },
      { stageId: 'a', stageTitle: 'A', sceneId: 's' },
    ]) {
      expect(isChatSessionInitialContext(value)).toBe(false);
    }
  });
});
