import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemorySelectionPrompt } from '@/lib/learner-context/selection-contracts';

const mocks = vi.hoisted(() => ({
  resolveModel: vi.fn(),
  callLLM: vi.fn(),
  build: vi.fn(),
  validate: vi.fn(),
}));
vi.mock('@/lib/server/resolve-model', () => ({ resolveModel: mocks.resolveModel }));
vi.mock('@/lib/ai/llm', () => ({ callLLM: mocks.callLLM }));
vi.mock('@/lib/server/quiz-learner-context', () => ({
  buildQuizLearnerContext: mocks.build,
  assertQuizContextCurrent: mocks.validate,
}));

import { defaultRunStepServices } from '@/lib/server/generation/run/services';
import { PreclassLearnerContextError } from '@/lib/learner-context/contracts';

const prompt: MemorySelectionPrompt = {
  system: 'Choose quiz IDs',
  user: 'quiz data',
  inputBytes: 100,
};
const input: Parameters<NonNullable<typeof defaultRunStepServices.quizLearnerContext>>[1] = {
  student: 'B',
  sceneIndex: 1,
  task: {
    requirement: 'Teach density',
    courseTitle: 'Density',
    outline: {
      id: 'density-quiz',
      type: 'quiz',
      title: 'Density check',
      description: 'Explain density',
      keyPoints: ['density'],
      order: 2,
    },
  },
};
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe('production Quiz learner context selection', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', '');
    vi.clearAllMocks();
    mocks.resolveModel.mockResolvedValue({
      model: { id: 'configured-quiz-model' },
      modelInfo: { contextWindow: 64000 },
      serverManaged: true,
    });
    mocks.callLLM.mockResolvedValue({ text: '{"selected":[]}', finishReason: 'stop' });
    mocks.build.mockImplementation(async (_input, deps) => deps.select(prompt));
  });

  it('uses the owner Quiz slot and marks one durable call before invoking without retry or fallback', async () => {
    const order: string[] = [];
    const signal = new AbortController().signal;
    const beforeSelect = vi.fn(async () => {
      order.push('marker');
    });
    mocks.callLLM.mockImplementation(async () => {
      order.push('call');
      return { text: '{"selected":[]}', finishReason: 'stop' };
    });
    await defaultRunStepServices.quizLearnerContext!('user:a', input, {
      log,
      signal,
      beforeSelect,
    });
    expect(mocks.build.mock.calls[0]![0]).toEqual(input);
    expect(mocks.resolveModel).toHaveBeenCalledWith({
      stage: 'scene-content:quiz',
      workspaceId: 'user:a',
    });
    expect(order).toEqual(['marker', 'call']);
    expect(mocks.callLLM).toHaveBeenCalledTimes(1);
    expect(mocks.callLLM).toHaveBeenCalledWith(
      expect.objectContaining({
        system: prompt.system,
        prompt: prompt.user,
        maxOutputTokens: 2000,
        maxRetries: 0,
        abortSignal: signal,
      }),
      'f66-quiz-learner-context',
      { retries: 0 },
      undefined,
      { enabled: false, serverManaged: true },
    );
  });

  it('does not resolve a model or mark a call when the adapter finds empty Memory', async () => {
    mocks.build.mockResolvedValue({ status: 'empty' });
    const beforeSelect = vi.fn();
    await defaultRunStepServices.quizLearnerContext!('user:a', input, { log, beforeSelect });
    expect(mocks.resolveModel).not.toHaveBeenCalled();
    expect(mocks.callLLM).not.toHaveBeenCalled();
    expect(beforeSelect).not.toHaveBeenCalled();
  });

  it('checks capacity before marking or sending a selection', async () => {
    mocks.resolveModel.mockResolvedValue({ model: {}, modelInfo: { contextWindow: 1000 } });
    const beforeSelect = vi.fn();
    await expect(
      defaultRunStepServices.quizLearnerContext!('user:a', input, { log, beforeSelect }),
    ).rejects.toMatchObject({ code: 'LEARNER_CONTEXT_INPUT_CAPACITY_EXCEEDED' });
    expect(beforeSelect).not.toHaveBeenCalled();
    expect(mocks.callLLM).not.toHaveBeenCalled();
  });

  it('does not invoke the provider when durable marking fails', async () => {
    await expect(
      defaultRunStepServices.quizLearnerContext!('user:a', input, {
        log,
        beforeSelect: async () => {
          throw new Error('lease lost');
        },
      }),
    ).rejects.toBeDefined();
    expect(mocks.callLLM).not.toHaveBeenCalled();
  });

  it.each(['length', 'error'])(
    'rejects a %s finish without retrying partial JSON',
    async (finishReason) => {
      mocks.callLLM.mockResolvedValue({ text: '{"selected":[]}', finishReason });
      await expect(
        defaultRunStepServices.quizLearnerContext!('user:a', input, {
          log,
          beforeSelect: async () => {},
        }),
      ).rejects.toMatchObject({ code: 'LEARNER_CONTEXT_SELECTION_INVALID' });
      expect(mocks.callLLM).toHaveBeenCalledTimes(1);
    },
  );

  it('sanitizes provider and Memory errors', async () => {
    mocks.callLLM.mockRejectedValue(new Error('private provider URL and credentials'));
    await expect(
      defaultRunStepServices.quizLearnerContext!('user:a', input, {
        log,
        beforeSelect: async () => {},
      }),
    ).rejects.toThrow('LEARNER_CONTEXT_SELECTION_FAILED');
    expect(mocks.callLLM).toHaveBeenCalledTimes(1);
    mocks.build.mockRejectedValue(new Error('private database connection'));
    await expect(
      defaultRunStepServices.quizLearnerContext!('user:a', input, {
        log,
        beforeSelect: async () => {},
      }),
    ).rejects.toThrow('LEARNER_MEMORY_UNAVAILABLE');
  });

  it('preserves source restrictions and sanitizes unexpected validation failures', async () => {
    const context = { student: 'B' } as Parameters<
      NonNullable<typeof defaultRunStepServices.validateQuizLearnerContext>
    >[1];
    mocks.validate.mockRejectedValue(
      new PreclassLearnerContextError('LEARNER_MEMORY_RECHECK_REQUIRED'),
    );
    await expect(
      defaultRunStepServices.validateQuizLearnerContext!('user:a', context, { log }),
    ).rejects.toMatchObject({ code: 'LEARNER_MEMORY_RECHECK_REQUIRED' });
    expect(mocks.validate).toHaveBeenCalledWith(context);
    mocks.validate.mockRejectedValue(new Error('private database connection'));
    await expect(
      defaultRunStepServices.validateQuizLearnerContext!('user:a', context, { log }),
    ).rejects.toThrow('LEARNER_MEMORY_UNAVAILABLE');
  });
});
