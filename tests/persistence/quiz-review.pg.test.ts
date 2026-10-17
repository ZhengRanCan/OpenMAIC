import { describe, it, expect } from 'vitest';
import { traceFixture } from './quiz-trace-fixture';
import { readQuizAttempt } from '@/lib/persistence/quiz-trace-read';
import type { QuizEvaluation } from '@/lib/quiz/trace-types';
const evaluation: QuizEvaluation = {
  results: [
    {
      questionId: 'q',
      correct: true,
      status: 'correct',
      earned: 2,
      evaluation: { state: 'normal', method: 'exact-key' },
    },
  ],
  summary: {
    status: 'complete',
    usableEarned: 2,
    usablePossible: 2,
    quizPossible: 2,
    unusableQuestionCount: 0,
  },
};
describe.skipIf(!process.env.PG_CONTRACT_URL)(
  'Review attempts and late results (real PostgreSQL)',
  () => {
    it('late review stays with original submission, regrade never creates an Attempt', async () => {
      const f = await traceFixture(process.env.PG_CONTRACT_URL);
      try {
        const a = await f.prepare();
        await f.service.submit('learner', a.attemptId, {
          operationId: 's',
          submissionId: 's',
          answers: { q: 'A' },
        });
        const r1 = await f.service.beginReview('learner', a.attemptId, {
          operationId: 'r1',
          submissionId: 's',
          language: 'en-US',
        });
        expect(
          (
            await f.service.beginReview('learner', a.attemptId, {
              operationId: 'r1',
              submissionId: 's',
              language: 'en-US',
            })
          ).pending,
        ).toBe(true);
        const r2 = await f.service.beginReview('learner', a.attemptId, {
          operationId: 'r2',
          submissionId: 's',
          language: 'en-US',
        });
        await f.service.finishReview('learner', r2, evaluation);
        const b = await f.service.prepare('learner', {
          operationId: 'retry',
          mode: 'retry',
          stageId: 'stage',
          sceneId: 'scene',
          previousAttemptId: a.attemptId,
        });
        await f.service.finishReview('learner', r1, evaluation);
        const old = await readQuizAttempt(f.provider, 'learner', a.attemptId),
          fresh = await readQuizAttempt(f.provider, 'learner', b.attemptId);
        expect(old.review?.id).toBe(r2.id);
        expect(old.reviews).toHaveLength(2);
        expect(fresh.review).toBeUndefined();
        expect((await f.db.query('SELECT * FROM runtime_sessions')).rows).toHaveLength(2);
        expect(
          (
            await f.db.query(
              "SELECT * FROM runtime_records WHERE session_id=$1 AND data->'payload'->>'phase'='reviewed'",
              [a.attemptId],
            )
          ).rows,
        ).toHaveLength(1);
        const r3 = await f.service.beginReview('learner', a.attemptId, {
          operationId: 'r3',
          submissionId: 's',
          language: 'en-US',
        });
        await f.service.finishReview('learner', r3, {
          ...evaluation,
          results: [
            {
              questionId: 'q',
              correct: null,
              status: 'incorrect',
              earned: 1,
              evaluation: { state: 'fallback', method: 'model' },
            },
          ],
        });
        const after = await readQuizAttempt(f.provider, 'learner', a.attemptId);
        expect(after.review?.summary.status).toBe('unavailable');
        expect(after.previousUsableReview?.id).toBe(r2.id);
      } finally {
        await f.close();
      }
    });
  },
);
