import { describe, expect, it } from 'vitest';
import { readSimulatedLearningLoopConfig } from '@/lib/server/quiz-learning-loop/config';

describe('simulated learning loop configuration', () => {
  it('is disabled when no explicit simulation attribution is configured', () => {
    expect(readSimulatedLearningLoopConfig({})).toBeNull();
  });
  it('requires a declared source and a specific isolated memory environment', () => {
    const environment = {
      OPENMAIC_SIMULATED_LEARNING_LOOP: JSON.stringify({
        sourceNature: 'proxy',
        conditions: ['代理预先看到参考答案'],
        memoryEnvironmentId: '94dc0199-7f20-4126-bfb8-3999a41dd57d',
      }),
    };
    expect(readSimulatedLearningLoopConfig(environment)).toEqual(
      JSON.parse(environment.OPENMAIC_SIMULATED_LEARNING_LOOP),
    );
    expect(() =>
      readSimulatedLearningLoopConfig({
        OPENMAIC_SIMULATED_LEARNING_LOOP: '{"sourceNature":"proxy"}',
      }),
    ).toThrow('INVALID_LEARNING_LOOP_CONFIGURATION');
    expect(() =>
      readSimulatedLearningLoopConfig({
        OPENMAIC_SIMULATED_LEARNING_LOOP: '{"sourceNature":"real"}',
      }),
    ).toThrow('INVALID_LEARNING_LOOP_CONFIGURATION');
  });
});
