import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreclassSelectionPrompt } from '@/lib/learner-context/contracts';

const mocks = vi.hoisted(() => ({
  resolveModel: vi.fn(),
  callLLM: vi.fn(),
  build: vi.fn(),
  validate: vi.fn(),
}));
vi.mock('@/lib/server/resolve-model', () => ({ resolveModel: mocks.resolveModel }));
vi.mock('@/lib/ai/llm', () => ({ callLLM: mocks.callLLM }));
vi.mock('@/lib/server/preclass-learner-context', () => ({
  buildPreclassLearnerContext: mocks.build,
  assertPreclassContextCurrent: mocks.validate,
}));

import { defaultRunStepServices } from '@/lib/server/generation/run/services';
import { PreclassLearnerContextError } from '@/lib/learner-context/contracts';

const prompt: PreclassSelectionPrompt = { system: 'Choose IDs', user: 'data', inputBytes: 100 };
const input = { student: 'B' as const, task: 'density', content: {} };
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe('production learner context selection', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', '');
    vi.clearAllMocks();
    mocks.resolveModel.mockResolvedValue({
      model: { id: 'configured-outline-model' },
      modelInfo: { contextWindow: 64000 },
      serverManaged: true,
    });
    mocks.callLLM.mockResolvedValue({ text: '{"selected":[]}', finishReason: 'stop' });
    mocks.build.mockImplementation(async (_input, deps) => deps.select(prompt));
  });

  it('uses the owner outline slot once, marking the durable call before invoking with no retry/fallback', async () => {
    const order: string[] = [];
    const beforeSelect = vi.fn(async () => {
      order.push('marker');
    });
    mocks.callLLM.mockImplementation(async () => {
      order.push('call');
      return { text: '{"selected":[]}', finishReason: 'stop' };
    });
    await defaultRunStepServices.learnerContext!('user:a', input, { log, beforeSelect });
    expect(mocks.resolveModel).toHaveBeenCalledWith({
      stage: 'scene-outlines-stream',
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
      }),
      'f65-learner-context',
      { retries: 0 },
      undefined,
      { enabled: false, serverManaged: true },
    );
  });

  it('does not resolve a model or record a call for an empty Memory', async () => {
    mocks.build.mockResolvedValue({ status: 'empty' });
    const beforeSelect = vi.fn();
    await defaultRunStepServices.learnerContext!('user:a', input, { log, beforeSelect });
    expect(mocks.resolveModel).not.toHaveBeenCalled();
    expect(mocks.callLLM).not.toHaveBeenCalled();
    expect(beforeSelect).not.toHaveBeenCalled();
  });

  it('checks capacity before recording or sending a call', async () => {
    mocks.resolveModel.mockResolvedValue({ model: {}, modelInfo: { contextWindow: 1000 } });
    const beforeSelect = vi.fn();
    await expect(
      defaultRunStepServices.learnerContext!('user:a', input, { log, beforeSelect }),
    ).rejects.toMatchObject({ code: 'LEARNER_CONTEXT_INPUT_CAPACITY_EXCEEDED' });
    expect(beforeSelect).not.toHaveBeenCalled();
    expect(mocks.callLLM).not.toHaveBeenCalled();
  });

  it.each(['length', 'error'])(
    'rejects a %s finish instead of accepting partial JSON',
    async (finishReason) => {
      mocks.callLLM.mockResolvedValue({ text: '{"selected":[]}', finishReason });
      await expect(
        defaultRunStepServices.learnerContext!('user:a', input, {
          log,
          beforeSelect: async () => {},
        }),
      ).rejects.toMatchObject({ code: 'LEARNER_CONTEXT_SELECTION_INVALID' });
    },
  );

  it('does not expose provider/connection errors in a persisted run message', async () => {
    mocks.callLLM.mockRejectedValue(new Error('private provider URL and credentials'));
    await expect(
      defaultRunStepServices.learnerContext!('user:a', input, {
        log,
        beforeSelect: async () => {},
      }),
    ).rejects.toThrow('LEARNER_CONTEXT_SELECTION_FAILED');
    mocks.build.mockRejectedValue(new Error('private database connection'));
    await expect(
      defaultRunStepServices.learnerContext!('user:a', input, {
        log,
        beforeSelect: async () => {},
      }),
    ).rejects.toThrow('LEARNER_MEMORY_UNAVAILABLE');
  });

  it('preserves a known source restriction and sanitizes unexpected recheck failures', async () => {
    const context = { student: 'B' } as Parameters<
      NonNullable<typeof defaultRunStepServices.validateLearnerContext>
    >[1];
    mocks.validate.mockRejectedValue(
      new PreclassLearnerContextError('LEARNER_MEMORY_RECHECK_REQUIRED'),
    );
    await expect(
      defaultRunStepServices.validateLearnerContext!('user:a', context, { log }),
    ).rejects.toMatchObject({ code: 'LEARNER_MEMORY_RECHECK_REQUIRED' });
    mocks.validate.mockRejectedValue(new Error('private database connection'));
    await expect(
      defaultRunStepServices.validateLearnerContext!('user:a', context, { log }),
    ).rejects.toThrow('LEARNER_MEMORY_UNAVAILABLE');
  });
});
