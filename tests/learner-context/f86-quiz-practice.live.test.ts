import { createOpenAI } from '@ai-sdk/openai';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DSL_VERSION } from '@openmaic/dsl';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { digest } from '@/lib/learner-memory/contracts';
import { ensureGenerationRunSchema } from '@/lib/persistence/generation-runs';
import { readQuizAttempt, loadQuizForPlay } from '@/lib/persistence/quiz-trace-read';
import { QuizTraceService } from '@/lib/persistence/quiz-trace';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import type { QuizFeedback, QuizFeedbackLocator } from '@/lib/quiz/feedback';
import type { QuizPracticeHelpRequest, QuizPracticeStatus } from '@/lib/quiz/practice';
import type { QuizReview } from '@/lib/quiz/trace-types';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { ensureLearningSceneBindings } from '@/lib/server/quiz-learning-loop/scene-bindings';
import * as resolver from '@/lib/server/resolve-model';
import type { Scene } from '@/lib/types/stage';

const mode = process.env.F86_MODE;
const modelId = 'deepseek-v4-flash';
const endpoint = 'https://api.deepseek.com/v1/chat/completions';
const identity = '67eb7df2-33a8-4fbd-acab-cda635b8ae83';
const owner = `anon:${identity}`;
const environment = '00000000-0000-4000-8000-000000000086';
const answer = {
  question: '物体质量为 0.42 kg、体积为 60 cm³，密度是多少 g/cm³？',
  options: ['0.007 g/cm³', '7 g/cm³', '70 g/cm³'],
  correctIndex: 1,
  analysis: '0.42 kg = 420 g，420 ÷ 60 = 7 g/cm³。',
};
type Ready = Extract<QuizPracticeStatus, { status: 'ready' }>;

async function check(dir: string, paid: boolean) {
  const load = async (name: string) =>
    JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8'));
  const result = await load('result');
  const input = await load('request');
  const response = await load('response');
  const reply = JSON.parse(response.choices[0].message.content);
  const user = JSON.parse(
    input.messages.find((message: { role: string }) => message.role === 'user').content,
  );
  expect(user.direction).toBe(result.source.practiceDirection);
  expect(user.quiz.items).toMatchObject([{ correct: true }, { correct: false }]);
  expect(result.opened.question.question).toBe(reply.question);
  expect(result.opened.question.answer).toBeUndefined();
  expect(result.opened.question.analysis).toBeUndefined();
  expect(result.opened.attemptId).not.toBe(result.locator.attemptId);
  expect(result.help.question).toBe(reply.question);
  expect(result.help.link).toMatchObject({
    attemptId: result.opened.attemptId,
    versionId: result.versionId,
  });
  expect(result.completed).toEqual(result.readback);
  expect(result.completed).toMatchObject({
    helpRequested: true,
    review: { summary: { usableEarned: 1, usablePossible: 1 } },
  });
  expect(result.original.summary).toMatchObject({ usableEarned: 1, usablePossible: 2 });
  expect(result.original).toEqual(result.originalReadback);
  const usage = await load('usage');
  expect(usage.calls).toBe(paid ? 1 : 0);
  expect(usage.tokens).toBe(response.usage.total_tokens);
}

it.skipIf(!process.env.F86_REPLAY_DIR)(
  'F86 replays the saved practice evidence with zero calls',
  async () => {
    await check(process.env.F86_REPLAY_DIR!, true);
  },
);

it.skipIf(mode !== 'preflight' && mode !== 'live' && mode !== 'resume')(
  'F86 starts from F85 feedback and saves a separate practice score and help link',
  async () => {
    const paid = mode === 'live';
    const resume = mode === 'resume';
    const batch = resume ? 'live' : mode;
    const output = process.env.F86_ARTIFACT_DIR;
    const sourceDir = process.env.F86_SOURCE_DIR;
    const key = process.env.DEEPSEEK_API_KEY;
    if (!output || !sourceDir || (paid && !key)) throw new Error('Missing isolated F86 settings');
    const url = new URL(process.env.DATABASE_URL ?? '');
    expect([url.hostname, url.port, url.pathname]).toEqual(['127.0.0.1', '55486', '/f86_contract']);
    if (!resume) await mkdir(output);
    const save = (name: string, value: unknown) =>
      writeFile(join(output, `${name}.json`), JSON.stringify(value, null, 2) + '\n', {
        flag: 'wx',
      });
    const sourceRecord = JSON.parse(await readFile(join(sourceDir, 'profile.json'), 'utf8'));
    const source: QuizFeedback = sourceRecord.feedback.feedback;
    const originalFixture = JSON.parse(await readFile(join(sourceDir, 'fixture.json'), 'utf8'));
    let invocations = 0;
    let calls = 0;
    let tokens = 0;
    let ms = 0;
    const model = createOpenAI({
      apiKey: key ?? 'f86-preflight',
      baseURL: 'https://api.deepseek.com/v1',
      fetch: async (url, init) => {
        if (resume || String(url) !== endpoint || invocations++ !== 0)
          throw new Error('F86 request cap');
        const raw = JSON.parse(String(init?.body));
        if (
          raw.model !== modelId ||
          raw.stream ||
          !raw.messages?.some((item: { content: string }) =>
            item.content.startsWith('根据已评分的 Quiz 和练习方向'),
          )
        )
          throw new Error('F86 unexpected request');
        const { max_completion_tokens, max_tokens, ...rest } = raw;
        const body = {
          ...rest,
          max_tokens: Math.min(max_completion_tokens ?? max_tokens ?? 600, 600),
          thinking: { type: 'disabled' },
        };
        const payload = JSON.stringify(body);
        if (Buffer.byteLength(payload) > 16_000) throw new Error('F86 prompt too large');
        await save('request', body);
        const start = performance.now();
        const response = paid
          ? await (async () => {
              calls++;
              return fetch(endpoint, {
                ...init,
                body: payload,
                redirect: 'error',
                signal: AbortSignal.any([
                  AbortSignal.timeout(25_000),
                  ...(init?.signal ? [init.signal] : []),
                ]),
              });
            })()
          : Response.json({
              id: 'f86-preflight',
              object: 'chat.completion',
              created: 1,
              model: modelId,
              choices: [
                {
                  index: 0,
                  finish_reason: 'stop',
                  message: { role: 'assistant', content: JSON.stringify(answer) },
                },
              ],
              usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            });
        if (!response.ok) {
          await save('http-error', { status: response.status });
          throw new Error('F86 provider HTTP failure');
        }
        const record = await response.clone().json();
        if (!Number.isFinite(record.usage?.total_tokens)) throw new Error('F86 usage unavailable');
        tokens = record.usage.total_tokens;
        ms = Math.round(performance.now() - start);
        await save('response', record);
        return response;
      },
    }).chat(modelId);
    vi.spyOn(resolver, 'resolveModel').mockImplementation(async ({ stage }) => {
      if (stage !== 'scene-content:quiz') throw new Error('Unexpected F86 model slot');
      return {
        model,
        modelId,
        modelString: `deepseek:${modelId}`,
        providerId: 'deepseek',
        modelInfo: {
          id: modelId,
          name: modelId,
          contextWindow: 131072,
          outputWindow: 8192,
          capabilities: {},
        },
        apiKey: key ?? 'f86-preflight',
        serverManaged: true,
        thinkingConfig: { mode: 'disabled' },
      };
    });
    vi.stubEnv('OWNER_SINGLE_USER', 'false');
    vi.stubEnv('OPENMAIC_QUIZ_FEEDBACK', 'true');
    vi.stubEnv('OPENMAIC_QUIZ_PRACTICE', 'true');
    vi.stubEnv(
      'OPENMAIC_SIMULATED_LEARNING_LOOP',
      JSON.stringify({
        sourceNature: 'synthetic',
        conditions: ['F86 synthetic fixture'],
        memoryEnvironmentId: environment,
      }),
    );
    const app = await getServerPersistenceProvider(url.href);
    try {
      await ensureGenerationRunSchema(app.pool);
      await ensureLearningSceneBindings(app.pool);
      const stageId = `f86-${batch}-stage`;
      const runId = `f86-${batch}-run`;
      const scene: Scene = { ...originalFixture.scene, id: `f86-${batch}-original`, stageId };
      const docs = await getOwnerScopedDocumentStore(owner);
      const headers = {
        cookie: `anonymous_id=${identity}`,
        origin: 'http://localhost',
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
      };
      if (!resume) {
        await docs.createDocument({
          dslVersion: DSL_VERSION,
          stage: {
            id: stageId,
            name: '密度补充练习验证',
            createdAt: 1,
            updatedAt: 2,
          },
          scenes: [scene],
        });
        await app.pool.query(
          "INSERT INTO generation_runs(id,owner_id,stage_id,input,state) VALUES($1,$2,$3,$4,'completed')",
          [runId, owner, stageId, { simulatedLearner: 'B' }],
        );
        await app.pool.query(
          'INSERT INTO generation_run_steps(run_id,step_id,output) VALUES($1,$2,$3)',
          [runId, 'scene:0:narration', { scene: { id: scene.id, stageId } }],
        );
        const trace = new QuizTraceService(app);
        const original = await trace.prepare(owner, {
          operationId: `f86-${mode}-prepare`,
          mode: 'start',
          stageId,
          sceneId: scene.id,
          scene,
        });
        const submission = await trace.submit(owner, original.attemptId, {
          operationId: `f86-${mode}-submit`,
          submissionId: `f86-${mode}-submission`,
          answers: { units: 'A', density: 'B' },
        });
        const { POST: grade } = await import('@/app/api/quiz-grade/route');
        const reviewResponse = await grade(
          new NextRequest('http://localhost/api/quiz-grade', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              attemptId: original.attemptId,
              operationId: `f86-${mode}-review`,
              submissionId: submission.id,
              language: 'zh-CN',
            }),
          }),
        );
        expect(reviewResponse.status).toBe(200);
        const graded: QuizReview = await reviewResponse.json();
        await app.pool.query(
          `INSERT INTO quiz_review_feedback(owner_id,review_id,claim_id,state,result)
        VALUES($1,$2,'f86-fixture','ready',$3)`,
          [
            owner,
            graded.id,
            {
              feedback: source,
              fingerprints: [],
              scopeDigest: digest([runId, 'B', environment]),
            },
          ],
        );
      }
      const original = await loadQuizForPlay(app, owner, stageId, scene.id);
      const review = original?.review;
      if (!original?.submission || !review) throw new Error('Original Quiz unavailable');
      expect(review.summary).toMatchObject({ usableEarned: 1, usablePossible: 2 });
      const locator: QuizFeedbackLocator = {
        attemptId: original.attemptId,
        versionId: original.version.id,
        submissionId: original.submission.id,
        reviewId: review.id,
      };
      const { GET, POST } = await import('@/app/api/quiz-practice/route');
      const path = 'http://localhost/api/quiz-practice';
      const get = () =>
        GET(new NextRequest(`${path}?${new URLSearchParams(locator)}`, { headers }));
      const post = async (body: unknown) => {
        const response = await POST(
          new NextRequest(path, {
            method: 'POST',
            headers,
            body: JSON.stringify({ ...locator, ...(body as Record<string, unknown>) }),
          }),
        );
        expect(response.status).toBe(200);
        return response.json();
      };
      const before = await (await get()).json();
      expect(before.status).toBe(resume ? 'ready' : 'idle');
      expect(invocations).toBe(0);
      const opened: Ready = await post({ action: 'accept', language: 'zh-CN' });
      expect(opened.status).toBe('ready');
      expect(await post({ action: 'accept', language: 'zh-CN' })).toEqual(opened);
      expect(invocations).toBe(resume ? 0 : 1);
      if (resume) expect(opened).toEqual(before);
      const practice = await readQuizAttempt(app, owner, opened.attemptId);
      expect(practice.practiceSourceReviewId).toBe(review.id);
      const help: QuizPracticeHelpRequest = await post({
        action: 'help',
        helpId: randomUUID(),
      });
      const savedQuestion =
        practice.version.scene.type === 'quiz' && practice.version.scene.content.questions[0]!;
      if (!savedQuestion) throw new Error('Missing question');
      const completed = await post({ action: 'submit', choice: savedQuestion.answer![0] });
      const readback = await (await get()).json();
      const originalReadback = (await loadQuizForPlay(app, owner, stageId, scene.id))?.review;
      const classroom = await docs.loadDocument(stageId);
      expect(classroom?.scenes.map(({ id }) => id)).toEqual([scene.id]);
      expect(invocations).toBe(resume ? 0 : 1);
      await save('result', {
        source,
        locator,
        opened,
        help,
        completed,
        readback,
        versionId: practice.version.id,
        original: review,
        originalReadback,
      });
    } finally {
      await save(resume ? 'continuation-usage' : 'usage', { calls, tokens, ms });
      await app.pool.end();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
    await check(output, paid || resume);
  },
  70_000,
);
