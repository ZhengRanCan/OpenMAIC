import { beforeEach, afterEach, it, expect, vi } from 'vitest';
vi.mock('@/lib/quiz/trace-client', () => ({ loadQuizForPlay: vi.fn() }));
import { loadQuizForPlay } from '@/lib/quiz/trace-client';
import {
  buildQuizResultsForStoreState,
  didActiveSceneRemainUnchanged,
} from '@/lib/chat/quiz-results-for-store-state';
import type { PreparedQuiz } from '@/lib/quiz/trace-types';
const scenes = [{ id: 'quiz', type: 'quiz', stageId: 'stage' }];
beforeEach(() => {
  vi.mocked(loadQuizForPlay).mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});
it('excludes fallback and returns only bounded server evaluation', async () => {
  vi.mocked(loadQuizForPlay).mockResolvedValue({
    version: { id: 'v' },
    submission: { id: 's', answers: { q: 'A' } },
    review: {
      id: 'r',
      summary: { status: 'partial' },
      results: [
        {
          questionId: 'q',
          correct: true,
          status: 'correct',
          earned: 1,
          evaluation: { state: 'normal', method: 'exact-key' },
        },
        {
          questionId: 'other',
          correct: null,
          status: 'incorrect',
          earned: 1,
          evaluation: { state: 'fallback', method: 'model' },
        },
      ],
    },
  } as unknown as PreparedQuiz);
  const result = await buildQuizResultsForStoreState(scenes, 'quiz');
  expect(result?.results).toHaveLength(1);
  expect(result?.reviewId).toBe('r');
  expect(result?.limitations).toHaveLength(2);
});
it('omits old/missing reviews and unavailable reads', async () => {
  vi.mocked(loadQuizForPlay).mockResolvedValue(null);
  expect(await buildQuizResultsForStoreState(scenes, 'quiz')).toBeUndefined();
  vi.mocked(loadQuizForPlay).mockRejectedValue(new Error('unavailable'));
  expect(await buildQuizResultsForStoreState(scenes, 'quiz')).toBeUndefined();
});
it('does not block chat indefinitely', async () => {
  vi.useFakeTimers();
  vi.mocked(loadQuizForPlay).mockReturnValue(new Promise(() => {}));
  const p = buildQuizResultsForStoreState(scenes, 'quiz');
  await vi.runAllTimersAsync();
  expect(await p).toBeUndefined();
});
it('active scene identity guards async delivery, not object allocation', () => {
  expect(didActiveSceneRemainUnchanged([{ id: 'q' }], 'q', [{ id: 'q' }], 'q')).toBe(true);
  expect(didActiveSceneRemainUnchanged([{ id: 'q' }], 'q', [], 'q')).toBe(false);
  expect(didActiveSceneRemainUnchanged([{ id: 'q' }], 'q', [{ id: 'x' }], 'x')).toBe(false);
});
