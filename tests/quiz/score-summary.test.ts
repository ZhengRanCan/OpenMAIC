import { it, expect } from 'vitest';
import { projectQuizScore } from '@/lib/quiz/trace-validation';
it('excludes technical fallback from usable score and denominator', () => {
  expect(
    projectQuizScore(
      [
        {
          questionId: 'q1',
          correct: true,
          status: 'correct',
          earned: 8,
          evaluation: { state: 'normal', method: 'model' },
        },
        {
          questionId: 'q2',
          correct: null,
          status: 'incorrect',
          earned: 5,
          evaluation: { state: 'fallback', method: 'model', reason: 'invalid-json' },
        },
      ],
      [
        { id: 'q1', type: 'short_answer', question: 'A', points: 10 },
        { id: 'q2', type: 'short_answer', question: 'B', points: 10 },
      ],
    ),
  ).toEqual({
    status: 'partial',
    usableEarned: 8,
    usablePossible: 10,
    quizPossible: 20,
    unusableQuestionCount: 1,
  });
});
