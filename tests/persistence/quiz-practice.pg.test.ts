import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuizPracticeService } from '@/lib/server/quiz-practice';
import { QuizFeedbackService } from '@/lib/server/quiz-feedback';
import {
  readQuizAttempt,
  loadQuizForPlay,
  readQuizHistory,
} from '@/lib/persistence/quiz-trace-read';
import { deleteQuizTraceIn } from '@/lib/persistence/quiz-trace-lifecycle';
import { maskUnreviewedQuizPractice } from '@/lib/quiz/practice';
import { traceFixture } from './quiz-trace-fixture';

const reply = JSON.stringify({
  question: 'A different synthetic question',
  options: ['One', 'Two', 'Three'],
  correctIndex: 1,
  analysis: 'The correct value is Two.',
});
const direction = 'Practice the original idea with a different example.';

describe('F86 supplemental practice', () => {
  let f: Awaited<ReturnType<typeof traceFixture>>;
  beforeEach(async () => {
    f = await traceFixture(process.env.F86_DATABASE_URL);
  });
  afterEach(async () => f.close());

  async function fixture() {
    const owner = 'learner';
    const attempt = await f.prepare();
    const submission = await f.service.submit(owner, attempt.attemptId, {
      operationId: 'submit',
      submissionId: 'submission',
      answers: { q: 'B' },
    });
    const review = await f.service.finishReview(
      owner,
      await f.service.beginReview(owner, attempt.attemptId, {
        operationId: 'review',
        submissionId: submission.id,
        language: 'en-US',
      }),
      {
        results: [
          {
            questionId: 'q',
            correct: false,
            earned: 0,
            status: 'incorrect',
            evaluation: { state: 'normal', method: 'exact-key' },
          },
        ],
        summary: {
          status: 'complete',
          usableEarned: 0,
          usablePossible: 2,
          quizPossible: 2,
          unusableQuestionCount: 0,
        },
      },
    );
    const options = {
      owner,
      locator: {
        attemptId: attempt.attemptId,
        versionId: attempt.version.id,
        submissionId: submission.id,
        reviewId: review.id,
      },
      environment: '00000000-0000-4000-8000-000000000086',
      language: 'en-US',
    };
    const model = vi.fn(
      async () =>
        ({ serverManaged: true }) as Awaited<
          ReturnType<NonNullable<ConstructorParameters<typeof QuizPracticeService>[1]>['model']>
        >,
    );
    const feedback = new QuizFeedbackService(f.provider, {
      model,
      scope: async () => ({ runId: 'run', student: 'B', title: 'Synthetic' }),
      select: async () => undefined,
      verify: async () => true,
      generate: async () =>
        JSON.stringify({ summary: 'You chose an incorrect option.', practiceDirection: direction }),
    });
    const generate = vi.fn(async (_model: unknown, _prompt: string) => reply);
    const service = new QuizPracticeService(f.provider, { model, generate }, feedback);
    return { options, review, service, generate, feedback };
  }

  it('only accepts a saved suggestion, creates one independent attempt and keeps the original grade', async () => {
    const { options, review, service, generate, feedback } = await fixture();
    expect(await service.read(options)).toEqual({ status: 'disabled' });
    expect(await service.accept(options)).toEqual({ status: 'disabled' });
    await feedback.generate(options);
    expect(await service.read(options)).toEqual({ status: 'idle' });
    expect(generate).not.toHaveBeenCalled();
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<string>();
    generate.mockImplementationOnce(() => {
      started.resolve();
      return response.promise;
    });
    const first = service.accept(options);
    try {
      await started.promise;
      expect(await service.accept(options)).toEqual({ status: 'pending' });
    } finally {
      response.resolve(reply);
    }
    const practice = await first;
    if (practice.status !== 'ready') throw new Error('Practice was not prepared');
    expect(practice.attemptId).not.toBe(options.locator.attemptId);
    expect(practice.question.answer).toBeUndefined();
    expect(practice.question.analysis).toBeUndefined();
    expect(await service.accept(options)).toEqual(practice);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(JSON.parse(generate.mock.calls[0]![1])).toMatchObject({
      direction,
      quiz: { items: [{ correct: false }] },
    });

    const saved = await readQuizAttempt(f.provider, options.owner, practice.attemptId);
    expect(saved.practiceSourceReviewId).toBe(review.id);
    expect(saved.version.id).not.toBe(options.locator.versionId);
    const projected = maskUnreviewedQuizPractice(saved);
    expect(projected?.version.scene.content).toMatchObject({ questions: [practice.question] });
    expect(JSON.stringify(projected)).not.toContain('The correct value is Two.');
    const helpId = '00000000-0000-4000-8000-000000000099';
    const help = await service.help(options, helpId);
    expect(help).toEqual({
      stageId: 'stage',
      sceneId: 'scene',
      link: { id: helpId, versionId: saved.version.id, attemptId: practice.attemptId },
      question: practice.question.question,
      options: ['One', 'Two', 'Three'],
    });
    expect(await service.help(options, helpId)).toEqual(help);
    expect((await f.db.query('SELECT id FROM quiz_practice_help')).rows).toHaveLength(1);
    expect(await service.read(options)).toMatchObject({ helpRequested: true });
    await f.service.saveDraft(options.owner, practice.attemptId, {
      operationId: 'save-practice',
      expectedLastSeq: practice.lastSeq,
      answers: { [practice.question.id]: 'B' },
    });
    expect(await service.read(options)).toMatchObject({ choice: 'B', submitted: false });
    const complete = await service.submit(options, 'B');
    expect(complete).toMatchObject({
      submitted: true,
      review: { summary: { usableEarned: 1, usablePossible: 1 } },
    });
    expect(await service.submit(options, 'B')).toEqual(complete);
    expect((await loadQuizForPlay(f.provider, options.owner, 'stage', 'scene'))?.review).toEqual(
      review,
    );
    expect(
      (await readQuizAttempt(f.provider, options.owner, practice.attemptId)).reviews,
    ).toHaveLength(1);
    await f.service.finishReview(
      options.owner,
      await f.service.beginReview(options.owner, options.locator.attemptId, {
        operationId: 'original-regrade',
        submissionId: options.locator.submissionId,
        language: 'en-US',
      }),
      { results: review.results, summary: review.summary },
    );
    await expect(service.read(options)).rejects.toMatchObject({ status: 409 });
    const history = await readQuizHistory(f.provider, options.owner, 'stage');
    const prior = history.attempts.find(({ attemptId }) => attemptId === practice.attemptId);
    expect(prior).toMatchObject({
      practiceSourceReviewId: review.id,
      practiceHelpRequested: true,
      review: { summary: { usableEarned: 1, usablePossible: 1 } },
    });
    await f.provider.withTransaction((tx) =>
      deleteQuizTraceIn(tx, options.owner, { stageId: 'stage' }),
    );
    for (const table of ['quiz_optional_practice', 'quiz_practice_help'])
      expect((await f.db.query('SELECT * FROM ' + table)).rows).toHaveLength(0);
  });

  it('rejects foreign, outdated and malformed requests without repeating an unknown generation', async () => {
    const { options, service, generate, feedback } = await fixture();
    await feedback.generate(options);
    await expect(service.accept({ ...options, owner: 'foreign' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      service.accept({ ...options, locator: { ...options.locator, versionId: 'forged' } }),
    ).rejects.toMatchObject({ status: 409 });
    generate
      .mockResolvedValueOnce('{"question":"invalid"}')
      .mockRejectedValueOnce(new Error('network timeout'));
    const failed = await service.accept(options);
    if (failed.status !== 'failed') throw new Error('Expected a retry token');
    expect(await service.accept(options)).toEqual(failed);
    expect(await service.accept(options, failed.retryToken)).toEqual({ status: 'unknown' });
    expect(await service.accept(options, failed.retryToken)).toEqual({ status: 'unknown' });
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
