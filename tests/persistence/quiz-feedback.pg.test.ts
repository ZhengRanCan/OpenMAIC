import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuizFeedbackService } from '@/lib/server/quiz-feedback';
import type { QuizEvaluation } from '@/lib/quiz/trace-types';
import { readQuizAttempt } from '@/lib/persistence/quiz-trace-read';
import { deleteQuizTraceIn } from '@/lib/persistence/quiz-trace-lifecycle';
import { testScene, traceFixture } from './quiz-trace-fixture';

const valid = {
  questionId: 'q',
  correct: true,
  status: 'correct',
  earned: 2,
  evaluation: { state: 'normal', method: 'exact-key' },
} satisfies QuizEvaluation['results'][number];
const fallback = {
  questionId: 'unknown',
  correct: null,
  status: 'incorrect',
  earned: 1,
  evaluation: { state: 'fallback', method: 'model' },
} satisfies QuizEvaluation['results'][number];
const response = JSON.stringify({
  summary: 'You selected Yes correctly.',
  practiceDirection: null,
});
type Services = NonNullable<ConstructorParameters<typeof QuizFeedbackService>[1]>;

describe('F85 Quiz feedback bound to a saved review', () => {
  let f: Awaited<ReturnType<typeof traceFixture>>;

  beforeEach(async () => {
    f = await traceFixture(process.env.F85_DATABASE_URL);
  });
  afterEach(async () => {
    await f.close();
  });

  const review = async (
    attemptId: string,
    operationId: string,
    results: QuizEvaluation['results'],
  ) =>
    f.service.finishReview(
      'learner',
      await f.service.beginReview('learner', attemptId, {
        operationId,
        submissionId: 'submission',
        language: 'en-US',
      }),
      { results, summary: {} as QuizEvaluation['summary'] },
    );

  async function fixture(results: QuizEvaluation['results'] = [valid], partial = false) {
    const scene = structuredClone(testScene);
    if (partial && scene.type === 'quiz')
      scene.content.questions.push({
        id: 'unknown',
        type: 'short_answer',
        question: 'PRIVATE FAILED QUESTION',
        points: 2,
      });
    const attempt = await f.service.prepare('learner', {
      operationId: 'prepare',
      stageId: 'stage',
      sceneId: 'scene',
      scene,
      mode: 'start',
    });
    await f.service.submit('learner', attempt.attemptId, {
      operationId: 'submit',
      submissionId: 'submission',
      answers: { q: 'A', ...(partial ? { unknown: 'PRIVATE FAILED ANSWER' } : {}) },
    });
    const saved = await review(attempt.attemptId, 'review', results);
    const options = {
      owner: 'learner',
      locator: {
        attemptId: attempt.attemptId,
        submissionId: 'submission',
        versionId: attempt.version.id,
        reviewId: saved.id,
      },
      environment: '00000000-0000-4000-8000-000000000085',
      language: 'en-US',
    };
    const deps = {
      scope: vi
        .fn<Services['scope']>()
        .mockResolvedValue({ runId: 'run', student: 'B', title: 'Test' }),
      select: vi.fn<Services['select']>().mockResolvedValue(undefined),
      verify: vi.fn<Services['verify']>().mockResolvedValue(true),
      model: vi
        .fn<Services['model']>()
        .mockResolvedValue({ serverManaged: true } as Awaited<ReturnType<Services['model']>>),
      generate: vi.fn<Services['generate']>().mockResolvedValue(response),
    };
    return { options, deps, service: new QuizFeedbackService(f.provider, deps) };
  }

  it('claims once and reuses a saved response without touching the original score', async () => {
    const { options, deps, service } = await fixture();
    const dispatched = Promise.withResolvers<void>();
    const answer = Promise.withResolvers<string>();
    deps.generate.mockImplementation(() => {
      dispatched.resolve();
      return answer.promise;
    });
    expect(await service.read(options)).toEqual({ status: 'idle' });
    expect(deps.generate).not.toHaveBeenCalled();
    const first = service.generate(options);
    try {
      await dispatched.promise;
      expect(await service.generate(options)).toEqual({ status: 'pending' });
    } finally {
      answer.resolve(response);
    }
    expect(await first).toMatchObject({ status: 'ready', partial: false });
    expect(await service.generate(options)).toEqual(await service.read(options));
    expect(deps.generate).toHaveBeenCalledTimes(1);
    const quiz = await readQuizAttempt(f.provider, 'learner', options.locator.attemptId);
    expect(quiz.review?.summary.usableEarned).toBe(2);
    expect(quiz.reviews).toHaveLength(1);
    await f.provider.withTransaction((tx) =>
      deleteQuizTraceIn(tx, options.owner, { stageId: quiz.stageId }),
    );
    expect((await f.db.query('SELECT review_id FROM quiz_review_feedback')).rows).toHaveLength(0);
    await expect(service.read(options)).rejects.toMatchObject({ status: 404 });
  });

  it('excludes unavailable items and invalidates a saved card when its historical source changes', async () => {
    const { options, deps, service } = await fixture([valid, fallback], true);
    deps.select.mockResolvedValue({
      text: JSON.stringify([
        { kind: 'mastery', data: { unverified: ['Historical practice direction'] } },
      ]),
      fingerprints: ['verified-profile'],
    });
    expect(await service.generate(options)).toMatchObject({
      status: 'ready',
      partial: true,
    });
    const input = deps.generate.mock.calls[0]![1];
    expect(input).not.toContain('PRIVATE FAILED');
    expect(JSON.parse(input)).toMatchObject({
      quiz: { partial: true, items: [{ number: 1, submitted: ['Yes'], correct: true }] },
      history: [{ kind: 'mastery' }],
    });
    deps.verify.mockResolvedValue(false);
    expect(await service.read(options)).toEqual({ status: 'currentOnly' });
    expect(deps.generate).toHaveBeenCalledTimes(1);
  });

  it('keeps an unavailable review on the grading path and rejects foreign or forged locators', async () => {
    const { options, deps, service } = await fixture([{ ...fallback, questionId: 'q' }]);
    expect(await service.generate(options)).toEqual({ status: 'disabled' });
    await expect(service.generate({ ...options, owner: 'another-owner' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      service.generate({
        ...options,
        locator: { ...options.locator, versionId: 'forged' },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(deps.model).not.toHaveBeenCalled();
    expect(deps.generate).not.toHaveBeenCalled();
  });

  it('prevents a late response from becoming the feedback for a new review', async () => {
    const { options, deps, service } = await fixture();
    deps.generate.mockImplementationOnce(async () => {
      await review(options.locator.attemptId, 'new-review', [
        { ...valid, correct: false, status: 'incorrect', earned: 0 },
      ]);
      return response;
    });
    await expect(service.generate(options)).rejects.toMatchObject({ status: 409 });
    const quiz = await readQuizAttempt(f.provider, 'learner', options.locator.attemptId);
    const latest = { ...options, locator: { ...options.locator, reviewId: quiz.review!.id } };
    expect(await service.read(latest)).toEqual({ status: 'idle' });
    deps.select.mockRejectedValueOnce(new Error('profile unavailable'));
    const incorrect = {
      summary: 'You selected Yes, which was marked incorrect for this attempt.',
      practiceDirection: null,
    };
    deps.generate.mockResolvedValueOnce(JSON.stringify(incorrect));
    expect(await service.generate(latest)).toMatchObject({ status: 'ready', feedback: incorrect });
    expect(JSON.parse(deps.generate.mock.calls[1]![1])).toMatchObject({
      quiz: { items: [{ correct: false }] },
    });
    expect(deps.generate.mock.calls[1]![1]).not.toContain('history');
  });

  it('requires explicit retry for a known failure and never resends an unknown outcome', async () => {
    const { options, deps, service } = await fixture();
    deps.generate
      .mockResolvedValueOnce('invalid JSON')
      .mockResolvedValueOnce('invalid JSON')
      .mockRejectedValueOnce(new Error('unknown'));
    const first = await service.generate(options);
    expect(first.status).toBe('failed');
    if (first.status !== 'failed') throw new Error('No retry token');
    expect(await service.generate(options)).toEqual(first);
    const second = await service.generate(options, first.retryToken);
    expect(second.status).toBe('failed');
    if (second.status !== 'failed') throw new Error('No retry token');
    expect(second.retryToken).not.toBe(first.retryToken);
    expect(await service.generate(options, first.retryToken)).toEqual(second);
    expect(await service.generate(options, second.retryToken)).toEqual({ status: 'unknown' });
    expect(await service.generate(options, second.retryToken)).toEqual({ status: 'unknown' });
    expect(deps.generate).toHaveBeenCalledTimes(3);
  });
});
