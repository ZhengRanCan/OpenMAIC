import { expect, it, vi } from 'vitest';
vi.mock('@/lib/ai/llm', () => ({ callLLM: vi.fn() }));
vi.mock('@/lib/server/resolve-model', () => ({ resolveModelFromRequest: vi.fn() }));
import { parseQuizGrade, gradeSubmittedQuiz } from '@/lib/server/quiz-grade';
import { callLLM } from '@/lib/ai/llm';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import type { NextRequest } from 'next/server';
const context = {
  id: 'r',
  attemptId: 'a',
  submissionId: 's',
  versionId: 'v',
  ordinal: 1,
  language: 'en-US',
  questions: [
    { id: 'q', type: 'short_answer' as const, question: 'Synthetic slope test', points: 10 },
  ],
  answers: { q: 'Synthetic response' },
};
it('rejects non numeric grades', () => {
  expect(parseQuizGrade('{"score":"oops"}', 10)).toBeUndefined();
  expect(parseQuizGrade('{"score":null}', 10)).toBeUndefined();
  expect(parseQuizGrade('{"score":99,"comment":"ok"}', 10)?.score).toBe(10);
});
it('invalid model JSON is fallback, excluded from usable score', async () => {
  vi.mocked(resolveModelFromRequest).mockResolvedValue({
    modelString: 'test/model',
    model: {} as never,
  } as never);
  vi.mocked(callLLM).mockResolvedValue({ text: 'not json' } as never);
  const r = await gradeSubmittedQuiz({} as NextRequest, context);
  expect(r.results[0].evaluation.state).toBe('fallback');
  expect(r.results[0].earned).toBe(5);
  expect(r.summary.usablePossible).toBe(0);
});
it('transport failure is distinct from wrong answer', async () => {
  vi.mocked(callLLM).mockRejectedValue(new Error('synthetic failure'));
  const r = await gradeSubmittedQuiz({} as NextRequest, context);
  expect(r.results[0].evaluation.state).toBe('failed');
  expect(r.results[0].correct).toBeNull();
});
it('choice uses stored key without resolving or invoking a model', async () => {
  vi.mocked(resolveModelFromRequest).mockClear();
  vi.mocked(callLLM).mockClear();
  const r = await gradeSubmittedQuiz({} as NextRequest, {
    ...context,
    questions: [
      {
        id: 'q',
        type: 'single',
        question: 'Synthetic?',
        answer: ['B'],
        options: [
          { label: 'A', value: 'A' },
          { label: 'B', value: 'B' },
        ],
      },
    ],
    answers: { q: 'A' },
  });
  expect(r.results[0]).toMatchObject({
    earned: 0,
    correct: false,
    evaluation: { state: 'normal', method: 'exact-key' },
  });
  expect(callLLM).not.toHaveBeenCalled();
  expect(resolveModelFromRequest).not.toHaveBeenCalled();
});
