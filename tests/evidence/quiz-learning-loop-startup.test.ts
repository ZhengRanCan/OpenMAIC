import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ activate: vi.fn(), discover: vi.fn(), claim: vi.fn() }));
vi.mock('@/lib/server/quiz-learning-loop/config', () => ({
  readSimulatedLearningLoopConfig: () => ({
    sourceNature: 'proxy',
    conditions: ['test'],
    memoryEnvironmentId: 'id',
  }),
}));
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({
    pool: {},
    withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  }),
}));
vi.mock('@/lib/persistence/schema-bootstrap-lock', () => ({
  withSchemaBootstrapLock: async (pool: unknown, fn: (value: unknown) => Promise<void>) => fn(pool),
}));
vi.mock('@/lib/server/quiz-learning-loop/store', () => ({
  ensureLearningLoopSchema: async () => {},
  markStaleLearningLoopsUnknown: async () => {},
  claimLearningLoop: mocks.claim,
}));
vi.mock('@/lib/server/quiz-learning-loop/discovery', () => ({
  activateLearningLoop: mocks.activate,
  discoverReviewedQuizzes: mocks.discover,
}));
vi.mock('@/lib/server/quiz-short-facts', () => ({
  ensureShortFactsSchema: async () => {},
  QuizShortFactsService: class {},
}));
vi.mock('@/lib/server/simulated-memory', () => ({
  openSimulatedMemory: vi.fn(),
  invokeSimulatedMemoryModel: vi.fn(),
}));
vi.mock('@/lib/server/resolve-model', () => ({ resolveModel: vi.fn() }));
vi.mock('@/lib/ai/llm', () => ({ callLLM: vi.fn() }));

import { startQuizLearningLoop } from '@/lib/server/quiz-learning-loop/runner';

describe('learning loop startup', () => {
  it('does not become ready or scan until the activation transaction completes', async () => {
    let release!: () => void;
    const activation = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.activate.mockReturnValue(activation);
    mocks.discover.mockResolvedValue(0);
    mocks.claim.mockResolvedValue(null);
    let ready = false;
    const starting = startQuizLearningLoop().then((runner) => {
      ready = true;
      return runner;
    });
    await vi.waitFor(() => expect(mocks.activate).toHaveBeenCalledOnce());
    expect(ready).toBe(false);
    expect(mocks.discover).not.toHaveBeenCalled();
    release();
    const runner = await starting;
    expect(ready).toBe(true);
    await runner?.stop();
  });
});
