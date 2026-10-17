import { it, expect } from 'vitest';
import { traceFixture, testScene } from './quiz-trace-fixture';
it('missing optional narration does not block a text Quiz and is explicitly scoped', async () => {
  const f = await traceFixture();
  try {
    const scene = {
      ...structuredClone(testScene),
      actions: [
        {
          id: 'narration',
          type: 'speech' as const,
          text: 'Optional narration',
          audioId: 'missing-audio',
        },
      ],
    };
    const a = await f.service.prepare('learner', {
      operationId: 'start',
      mode: 'start',
      stageId: 'stage',
      sceneId: 'scene',
      scene,
    });
    expect(a.version.resourceCoverage).toEqual({
      taskPresentation: 'text-and-math-quiz',
      unavailableBackgroundRefs: ['missing-audio'],
    });
    expect(a.version.scene.content).toEqual(testScene.content);
  } finally {
    await f.close();
  }
});
