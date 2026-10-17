import { test, expect } from '../fixtures/base';
import type { Page } from '@playwright/test';
import { ClassroomPage } from '../pages/classroom.page';
import { seedServerDocument, readServerDocument, uniqueStageId } from '../fixtures/server-seed';
import { createSettingsStorage } from '../fixtures/test-data/settings';
import type { QuizQuestion } from '../../lib/types/stage';
import type { PreparedQuiz, QuizReview } from '../../lib/quiz/trace-types';

const choices: QuizQuestion[] = [
  {
    id: 'single',
    type: 'single',
    question: 'Frozen question: two plus two?',
    options: [
      { label: 'Four', value: 'A' },
      { label: 'Five', value: 'B' },
    ],
    answer: ['A'],
    points: 2,
  },
  {
    id: 'multiple',
    type: 'multiple',
    question: 'Choose both even numbers',
    options: [
      { label: 'Two', value: 'A' },
      { label: 'Three', value: 'B' },
      { label: 'Six', value: 'C' },
    ],
    answer: ['A', 'C'],
    points: 2,
  },
];

async function seed(page: Page, questions: QuizQuestion[]) {
  await page.addInitScript(
    (settings) => {
      localStorage.setItem('maic:account:settings-storage', settings);
      localStorage.setItem('locale', 'en-US');
    },
    createSettingsStorage({ sidebarCollapsed: false }),
  );
  await page.goto('/', { waitUntil: 'networkidle' });
  const stageId = uniqueStageId('e2e-quiz-trace');
  const now = Date.now();
  await seedServerDocument(page, {
    stage: {
      id: stageId,
      name: 'Trace test deck',
      description: '',
      style: 'professional',
      createdAt: now,
      updatedAt: now,
    },
    scenes: [
      {
        id: 'trace-scene',
        stageId,
        type: 'quiz',
        title: 'Trace quiz',
        order: 0,
        content: { type: 'quiz', questions },
        createdAt: now,
        updatedAt: now,
      },
    ],
    outline: { outlines: [], createdAt: now, updatedAt: now },
  });
  const classroom = new ClassroomPage(page);
  await classroom.goto(stageId);
  await classroom.waitForLoaded();
  return stageId;
}

async function answerChoices(page: Page) {
  await page.getByRole('button', { name: 'Start Quiz', exact: true }).click();
  await expect(page.getByText('Frozen question: two plus two?')).toBeVisible();
  await page.getByRole('button', { name: /Four/ }).click();
  await page.getByRole('button', { name: /^A\s+Two$/ }).click();
  await page.getByRole('button', { name: /^C\s+Six$/ }).click();
}

test.describe('Quiz Learning Trace', () => {
  test('real Provider: synthetic short-answer grading with saved execution metadata (opt-in)', async ({
    page,
  }, testInfo) => {
    test.skip(
      process.env.F62_LIVE_GRADE !== '1',
      'Requires explicit F62_LIVE_GRADE=1 to call the existing configured Provider.',
    );
    test.setTimeout(180_000);
    const stageId = await seed(page, [
      {
        id: 'synthetic-slope',
        type: 'short_answer',
        points: 2,
        question: 'Why is the slope negative when y decreases as x increases?',
      },
    ]);
    // APIRequestContext reads the real owner view; the base fixture's page.route
    // model-settings mock only answers browser requests and is not selection evidence.
    const configResponse = await page.request.get('/api/model-config');
    expect(
      configResponse.ok(),
      'The real test workspace model metadata must be readable.',
    ).toBeTruthy();
    const config = (await configResponse.json()) as {
      allowUserKeys: boolean;
      slots: Array<{
        slot: string;
        locked: boolean;
        effective: {
          status: string;
          providerId?: string;
          modelId?: string;
        };
      }>;
    };
    const classroom = config.slots.find((slot) => slot.slot === 'classroom');
    let selection: { source: string; providerId?: string; modelId?: string };
    if (classroom?.effective.status === 'assigned') {
      // A configured/locked slot remains authoritative; never replace it with a request model.
      selection = {
        source: 'existing-classroom-slot',
        providerId: classroom.effective.providerId,
        modelId: classroom.effective.modelId,
      };
    } else {
      expect(
        config.allowUserKeys && classroom?.effective.status === 'unassigned' && !classroom.locked,
        'No assigned classroom model, and this configuration does not allow request model selection.',
      ).toBeTruthy();
      const offeredResponse = await page.request.get('/api/server-providers');
      expect(offeredResponse.ok(), 'Server-offered model metadata must be readable.').toBeTruthy();
      const offered = (await offeredResponse.json()) as {
        providers: Record<string, { models?: string[] }>;
      };
      const candidate = Object.entries(offered.providers).flatMap(([providerId, entry]) =>
        (entry.models ?? [])
          .filter((modelId) => typeof modelId === 'string' && modelId.trim())
          .map((modelId) => ({ providerId, modelId })),
      )[0];
      expect(
        candidate,
        'No server-offered model is explicitly listed; do not invent a model or endpoint.',
      ).toBeTruthy();
      selection = { source: 'server-offered-request-header', ...candidate };
      // lib/ai/providers.ts parseModelString splits on the FIRST COLON, not a slash.
      const headerModel = `${candidate.providerId}:${candidate.modelId}`;
      await page.route('**/api/quiz-grade', async (route) => {
        await route.continue({ headers: { ...route.request().headers(), 'x-model': headerModel } });
      });
    }
    await testInfo.attach('live-grade-model-selection', {
      body: JSON.stringify(selection),
      contentType: 'application/json',
    });
    await page.getByRole('button', { name: 'Start Quiz', exact: true }).click();
    await page
      .getByPlaceholder('Type your answer here...')
      .fill(
        'When x increases by a positive amount and y decreases, delta y / delta x is negative.',
      );
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/quiz-grade') && response.request().method() === 'POST',
      { timeout: 150_000 },
    );
    await page.getByRole('button', { name: 'Submit Answers', exact: true }).click();
    const response = await responsePromise;
    if (response.status() !== 200) {
      await testInfo.attach('live-grade-http-status', {
        body: JSON.stringify({ status: response.status(), savedReviewConfirmed: false }),
        contentType: 'application/json',
      });
    }
    expect(
      response.status(),
      'A saved Provider evaluation must be returned; pending/error is not success.',
    ).toBe(200);
    const review = (await response.json()) as QuizReview;
    const savedResponse = await page.request.get(
      `/api/quiz-trace/restore?stageId=${stageId}&sceneId=trace-scene`,
    );
    expect(savedResponse.ok()).toBeTruthy();
    const saved = (await savedResponse.json()) as PreparedQuiz;
    expect(review.attemptId).toBe(saved.attemptId);
    expect(review.submissionId).toBe(saved.submission?.id);
    expect(review.versionId).toBe(saved.version.id);
    expect(saved.reviews.some((item) => item.id === review.id)).toBeTruthy();
    expect(review.results).toHaveLength(1);
    const result = review.results[0];
    // Deliberately exclude question text, answers, model comments and raw outputs.
    await testInfo.attach('live-grade-sanitized-metadata', {
      body: JSON.stringify(
        {
          attemptId: review.attemptId,
          submissionId: review.submissionId,
          versionId: review.versionId,
          reviewId: review.id,
          ordinal: review.ordinal,
          savedAt: review.savedAt,
          summary: review.summary,
          evaluation: {
            state: result.evaluation.state,
            method: result.evaluation.method,
            rule: result.evaluation.rule,
            configuredModel: result.evaluation.configuredModel,
            reason: result.evaluation.reason,
          },
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(result.evaluation.method).toBe('model');
    if (result.evaluation.state === 'normal') {
      expect(review.summary.status).toBe('complete');
      expect(review.summary.usablePossible).toBe(2);
      expect(Number.isFinite(review.summary.usableEarned)).toBeTruthy();
      await expect(page.getByTestId('quiz-trace-score')).toContainText('Usable score:');
    } else {
      expect(review.summary.status).toBe('unavailable');
      expect(review.summary.usablePossible).toBe(0);
      expect(review.summary.usableEarned).toBe(0);
      await expect(page.getByTestId('quiz-trace-score')).toContainText('No usable score yet.');
    }
    expect(
      result.evaluation.state,
      'Provider failure/fallback is preserved above and does not pass the live Provider gate.',
    ).toBe('normal');
  });

  test('draft flush recovery: refresh keeps the pending submission locked before its POST was sent', async ({
    page,
  }) => {
    const stageId = await seed(page, choices);
    let releaseDraft!: () => void;
    const draftGate = new Promise<void>((resolve) => {
      releaseDraft = resolve;
    });
    await page.route('**/api/quiz-trace/attempts/*/draft', async (route) => {
      await draftGate;
      await route.abort('failed');
    });
    await answerChoices(page);
    await page.getByRole('button', { name: 'Submit Answers', exact: true }).click();
    await expect(page.getByTestId('quiz-submission-uncertain')).toBeVisible();
    releaseDraft();
    const beforeRefresh = await page.request.get(
      `/api/quiz-trace/restore?stageId=${stageId}&sceneId=trace-scene`,
    );
    expect(((await beforeRefresh.json()) as PreparedQuiz).submission).toBeUndefined();
    await page.reload();
    await expect(page.getByTestId('quiz-submission-uncertain')).toBeVisible();
    await expect(page.getByRole('button', { name: /Four/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Submit Answers', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry the same submission', exact: true }).click();
    await expect(page.getByTestId('quiz-trace-score')).toContainText('Usable score: 4 / 4');
  });

  test('real trace: lost submission response, refresh lock, server choice grading, frozen retry and history', async ({
    page,
  }, testInfo) => {
    const stageId = await seed(page, choices);
    await answerChoices(page);
    const before = await page.request.get(
      `/api/quiz-trace/restore?stageId=${stageId}&sceneId=trace-scene`,
    );
    expect(before.ok()).toBeTruthy();
    const first = (await before.json()) as PreparedQuiz;
    expect(first.version.scene.content).toMatchObject({ type: 'quiz', questions: choices });

    // Commit through the real endpoint, then lose only the browser response.
    await page.route(
      '**/api/quiz-trace/attempts/*/submission',
      async (route) => {
        const response = await route.fetch();
        expect(response.ok()).toBeTruthy();
        await route.abort('failed');
      },
      { times: 1 },
    );
    await page.getByRole('button', { name: 'Submit Answers', exact: true }).click();
    await expect(page.getByTestId('quiz-submission-uncertain')).toBeVisible();
    await expect(page.getByRole('button', { name: /Four/ })).toBeDisabled();
    // The uncertain UI appears before draft flushing finishes. Prove that this
    // scenario actually committed, instead of reloading before POST was sent.
    await expect
      .poll(async () => {
        const saved = await page.request.get(
          `/api/quiz-trace/restore?stageId=${stageId}&sceneId=trace-scene`,
        );
        expect(saved.ok()).toBeTruthy();
        return ((await saved.json()) as PreparedQuiz).submission?.attemptId;
      })
      .toBe(first.attemptId);
    await page.reload();
    await expect(page.getByText('Submitted answers are locked.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: /Four/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Submit Answers', exact: true })).toHaveCount(0);
    // The review also commits before its response is lost. Recovery must replay
    // its operation rather than creating another grading execution.
    const reviewOperations: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/quiz-grade') && request.method() === 'POST') {
        reviewOperations.push((request.postDataJSON() as { operationId: string }).operationId);
      }
    });
    await page.route(
      '**/api/quiz-grade',
      async (route) => {
        const response = await route.fetch();
        expect(response.ok()).toBeTruthy();
        await route.abort('failed');
      },
      { times: 1 },
    );
    await page.getByRole('button', { name: 'Grade this submission', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Recover the original evaluation request', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Recover the original evaluation request', exact: true })
      .click();
    await expect(page.getByTestId('quiz-trace-score')).toContainText('Usable score: 4 / 4');
    await expect(
      page.getByRole('button', { name: 'Recover the original evaluation request', exact: true }),
    ).toHaveCount(0);
    expect(reviewOperations).toHaveLength(2);
    expect(reviewOperations[0]).toBe(reviewOperations[1]);
    const gradedResponse = await page.request.get(
      `/api/quiz-trace/restore?stageId=${stageId}&sceneId=trace-scene`,
    );
    expect(((await gradedResponse.json()) as PreparedQuiz).reviews).toHaveLength(1);

    const document = (await readServerDocument(page, stageId))!;
    await seedServerDocument(page, {
      stage: { ...document.stage, id: stageId, updatedAt: Date.now() },
      scenes: document.scenes.map((scene) => ({
        ...scene,
        content: {
          type: 'quiz',
          questions: [{ ...choices[0], question: 'Edited current question' }, choices[1]],
        },
        updatedAt: Date.now(),
      })),
      outline: { outlines: [], createdAt: Date.now(), updatedAt: Date.now() },
    });
    await page.reload();
    await expect(page.getByText('Frozen question: two plus two?')).toBeVisible();
    await expect(page.getByText('Edited current question')).toHaveCount(0);
    await page.getByRole('button', { name: 'Start another attempt', exact: true }).click();
    await page.getByRole('button', { name: 'Start Quiz', exact: true }).click();
    await expect(page.getByText('Frozen question: two plus two?')).toBeVisible();
    const retryResponse = await page.request.get(
      `/api/quiz-trace/restore?stageId=${stageId}&sceneId=trace-scene`,
    );
    const retry = (await retryResponse.json()) as PreparedQuiz;
    expect(retry.attemptId).not.toBe(first.attemptId);
    expect(retry.version.id).toBe(first.version.id);
    expect(retry.submission).toBeUndefined();
    await page.getByRole('button', { name: 'Quiz history', exact: true }).click();
    await expect(page.getByTestId('quiz-trace-history')).toContainText(first.attemptId);
    await expect(page.getByTestId('quiz-trace-history')).toContainText(retry.attemptId);
    const removed = await page.request.delete(
      '/api/persistence/documents/' + encodeURIComponent(stageId),
    );
    expect(removed.status()).toBe(204);
    expect((await page.request.get('/api/quiz-trace/attempts/' + first.attemptId)).status()).toBe(
      404,
    );
    expect((await page.request.get('/api/quiz-trace/history?stageId=' + stageId)).status()).toBe(
      404,
    );
    await testInfo.attach('quiz-trace-frozen-history', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  test('mocked evaluation UI: three question types with partial usable score (no Provider or review persistence claim)', async ({
    page,
  }, testInfo) => {
    const stageId = await seed(page, [
      ...choices,
      {
        id: 'short',
        type: 'short_answer',
        question: 'Explain addition',
        commentPrompt: 'A short explanation.',
        points: 2,
      },
    ]);
    let mockProjection: PreparedQuiz | undefined;
    await page.route('**/api/quiz-trace/restore?**', async (route) => {
      if (mockProjection)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockProjection),
        });
      else await route.continue();
    });
    await page.route('**/api/quiz-grade', async (route) => {
      const request = route.request().postDataJSON() as { attemptId: string; submissionId: string };
      const savedResponse = await page.request.get(
        `/api/quiz-trace/restore?stageId=${stageId}&sceneId=trace-scene`,
      );
      const saved = (await savedResponse.json()) as PreparedQuiz;
      const review: QuizReview = {
        id: 'mock-review',
        attemptId: request.attemptId,
        submissionId: request.submissionId,
        versionId: saved.version.id,
        ordinal: 1,
        savedAt: new Date().toISOString(),
        results: [
          {
            questionId: 'single',
            correct: true,
            status: 'correct',
            earned: 2,
            evaluation: { state: 'normal', method: 'exact-key' },
          },
          {
            questionId: 'multiple',
            correct: true,
            status: 'correct',
            earned: 2,
            evaluation: { state: 'normal', method: 'exact-key' },
          },
          {
            questionId: 'short',
            correct: null,
            status: 'incorrect',
            earned: 1,
            evaluation: { state: 'fallback', method: 'model', reason: 'MOCK_PROVIDER_FAILURE' },
          },
        ],
        summary: {
          status: 'partial',
          usableEarned: 4,
          usablePossible: 4,
          quizPossible: 6,
          unusableQuestionCount: 1,
        },
      };
      // Both evaluation response and its read projection are mocked in this UI-only case.
      mockProjection = { ...saved, review, reviews: [review] };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(review),
      });
    });
    await answerChoices(page);
    await page.getByPlaceholder('Type your answer here...').fill('Addition combines quantities.');
    await page.getByRole('button', { name: 'Submit Answers', exact: true }).click();
    await expect(page.getByTestId('quiz-trace-score')).toContainText(
      'Partial evaluation: 4 / 4 usable points; quiz total 6.',
    );
    await expect(
      page.getByText('Technical fallback; excluded from the usable score.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Re-evaluate this submission', exact: true }),
    ).toBeVisible();
    await expect(page.getByPlaceholder('Type your answer here...')).toBeDisabled();
    await testInfo.attach('mocked-partial-score-ui', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
});
