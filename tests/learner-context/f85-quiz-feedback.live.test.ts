import { createOpenAI } from '@ai-sdk/openai';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { Pool } from 'pg';
import { expect, it, vi } from 'vitest';
import { simulatedScope, simulatedSeed } from '@/lib/learner-memory/simulated-seeds';
import { readQuizAttempt } from '@/lib/persistence/quiz-trace-read';
import { QuizTraceService } from '@/lib/persistence/quiz-trace';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import type { QuizFeedbackLocator, QuizFeedbackStatus } from '@/lib/quiz/feedback';
import type { QuizReview } from '@/lib/quiz/trace-types';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import * as mastery from '@/lib/server/learner-mastery';
import * as resolver from '@/lib/server/resolve-model';
import * as memoryRead from '@/lib/server/simulated-learner-memory';
import type { Scene } from '@/lib/types/stage';

const mode = process.env.F85_MODE;
const modelId = 'deepseek-v4-flash';
const endpoint = 'https://api.deepseek.com/v1/chat/completions';
const identity = '67eb7df2-33a8-4fbd-acab-cda635b8ae83';
const owner = `anon:${identity}`;
const student = 'B';
const arms = ['baseline', 'profile'] as const;
type Arm = (typeof arms)[number];
type Phase = 'selection' | 'feedback';
type Candidate = { id: string; kind: 'memory' | 'mastery'; data: unknown };
type Receipt = { arm: Arm; phase: Phase; tokens: number; upstreamMs: number };
type ArmResult = {
  review: QuizReview;
  locator: QuizFeedbackLocator;
  feedback: QuizFeedbackStatus;
  readback: QuizFeedbackStatus;
  feedbackMs: number;
};
type ModelInput = { messages: { role: string; content: string }[] };
const quizContent: Extract<Scene, { type: 'quiz' }>['content'] = {
  type: 'quiz',
  questions: [
    {
      id: 'units',
      type: 'single',
      question: '6 g/cm³ 等于多少 kg/m³？',
      options: [
        { value: 'A', label: '6000 kg/m³' },
        { value: 'B', label: '6 kg/m³' },
      ],
      answer: ['A'],
      points: 1,
    },
    {
      id: 'density',
      type: 'single',
      question: '物体质量 0.54 kg、体积 90 cm³，密度是多少 g/cm³？',
      options: [
        { value: 'A', label: '6 g/cm³' },
        { value: 'B', label: '0.006 g/cm³' },
      ],
      answer: ['A'],
      points: 1,
    },
  ],
};

function userContent(input: ModelInput) {
  return JSON.parse(input.messages.find(({ role }) => role === 'user')!.content);
}

async function checkBatch(dir: string, paid: boolean) {
  const load = async (file: string) =>
    JSON.parse(await readFile(join(dir, `${file}.json`), 'utf8'));
  const baseline: ArmResult = await load('baseline');
  const profile: ArmResult = await load('profile');
  const baselineInput = userContent(await load('01-baseline-feedback.request'));
  const selectionInput = userContent(await load('02-profile-selection.request'));
  const profileInput = userContent(await load('03-profile-feedback.request'));
  const selection = await load('02-profile-selection.response');
  const aliases: string[] = JSON.parse(selection.choices[0].message.content).selected;
  const selected = aliases.map((id) => {
    const { kind, data } = (selectionInput.candidates as Candidate[]).find(
      (item) => item.id === id,
    )!;
    return { kind, data };
  });
  expect(baseline.locator).toEqual(profile.locator);
  expect(baseline.review).toEqual(profile.review);
  expect(baseline.review.summary.usableEarned).toBe(1);
  expect(baselineInput.quiz).toEqual(profileInput.quiz);
  expect(baselineInput.quiz).toEqual(selectionInput.task);
  expect(baselineInput.quiz.items).toMatchObject([
    { submitted: ['6000 kg/m³'], correct: true },
    { submitted: ['0.006 g/cm³'], correct: false },
  ]);
  expect(baselineInput.history).toBeUndefined();
  expect(profileInput.history).toEqual(selected);
  expect(selected.map(({ kind }) => kind)).toEqual(expect.arrayContaining(['memory', 'mastery']));
  expect(JSON.stringify(selected)).toContain('2.7kg/m³');
  expect(JSON.stringify(selected)).toContain('独立列式');
  for (const [arm, result, index] of [
    ['baseline', baseline, '01'],
    ['profile', profile, '03'],
  ] as const) {
    const reply = await load(`${index}-${arm}-feedback.response`);
    expect(result.feedback).toMatchObject({
      status: 'ready',
      feedback: JSON.parse(reply.choices[0].message.content),
      partial: false,
    });
    expect(result.readback).toEqual(result.feedback);
  }
  const usage = await load('usage');
  expect(usage.calls).toBe(paid ? 3 : 0);
  expect(usage.receipts.map(({ arm, phase }: Receipt) => `${arm}:${phase}`)).toEqual([
    'baseline:feedback',
    'profile:selection',
    'profile:feedback',
  ]);
}

it.skipIf(!process.env.F85_REPLAY_DIR)(
  'F85 replays the recorded comparison with zero calls',
  async () => {
    await checkBatch(process.env.F85_REPLAY_DIR!, true);
  },
);

it.skipIf(mode !== 'preflight' && mode !== 'live')(
  'F85 compares feedback through the saved Quiz review and learner context',
  async () => {
    const output = process.env.F85_ARTIFACT_DIR;
    const fixture = process.env.F85_FIXTURE_DIR;
    const paid = mode === 'live';
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!output || !fixture || (paid && !apiKey)) throw new Error('Missing isolated F85 settings');
    const appUrl = new URL(process.env.DATABASE_URL ?? '');
    const memoryUrl = new URL(process.env.MEMORY_DATABASE_URL ?? '');
    for (const [url, database] of [
      [appUrl, 'app'],
      [memoryUrl, 'memory'],
    ] as const) {
      expect([url.hostname, url.port, url.pathname]).toEqual([
        '127.0.0.1',
        '55483',
        `/f83_preflight_${database}`,
      ]);
    }
    await mkdir(output);
    const save = (file: string, value: unknown) =>
      writeFile(join(output, `${file}.json`), JSON.stringify(value, null, 2) + '\n', {
        flag: 'wx',
      });

    let arm: Arm = 'baseline';
    let attempts = 0;
    let calls = 0;
    let halted = false;
    const receipts: Receipt[] = [];
    const expected = ['baseline-feedback', 'profile-selection', 'profile-feedback'];
    const llm = createOpenAI({
      apiKey: apiKey ?? 'f85-preflight',
      baseURL: 'https://api.deepseek.com/v1',
      fetch: async (url, init) => {
        if (halted || String(url) !== endpoint) throw new Error('F85 external route blocked');
        const raw = JSON.parse(String(init?.body));
        const system = String(
          raw.messages?.find((message: { role: string }) => message.role === 'system')?.content,
        );
        const phase = system.startsWith('为本次 Quiz 评价后的反馈')
          ? 'selection'
          : system.startsWith('你为已评分的 Quiz')
            ? 'feedback'
            : null;
        if (
          !phase ||
          raw.model !== modelId ||
          raw.stream ||
          expected[attempts] !== `${arm}-${phase}`
        )
          throw new Error('F85 request route or cap');
        const { max_completion_tokens, max_tokens, ...rest } = raw;
        const limit = phase === 'selection' ? 400 : 700;
        const body = {
          ...rest,
          max_tokens: Math.min(max_completion_tokens ?? max_tokens ?? limit, limit),
          thinking: { type: 'disabled' },
        };
        const payload = JSON.stringify(body);
        if (Buffer.byteLength(payload) > 24_000) throw new Error('F85 prompt too large');
        const id = `${String(++attempts).padStart(2, '0')}-${arm}-${phase}`;
        await save(`${id}.request`, body);
        const start = performance.now();
        try {
          let response: Response;
          if (paid) {
            calls++;
            response = await fetch(endpoint, {
              ...init,
              body: payload,
              redirect: 'error',
              signal: AbortSignal.any([
                AbortSignal.timeout(25_000),
                ...(init?.signal ? [init.signal] : []),
              ]),
            });
          } else {
            const selected =
              phase === 'selection' &&
              (userContent(body).candidates as Candidate[])
                .filter(
                  ({ kind, data }) =>
                    kind === 'mastery' || JSON.stringify(data).includes('2.7kg/m³'),
                )
                .map(({ id }) => id);
            response = Response.json({
              id,
              object: 'chat.completion',
              created: 1,
              model: modelId,
              choices: [
                {
                  index: 0,
                  finish_reason: 'stop',
                  message: {
                    role: 'assistant',
                    content: JSON.stringify(
                      selected
                        ? { selected }
                        : {
                            summary: '单位题选对，综合题选择了 0.006 g/cm³，这一选项不正确。',
                            practiceDirection: '另做一道题，写出换算和列式。',
                          },
                    ),
                  },
                },
              ],
              usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            });
          }
          if (!response.ok) {
            await save(`${id}.http-error`, { status: response.status });
            throw new Error('F85 provider HTTP failure');
          }
          const value = await response.clone().json();
          if (!Number.isFinite(value.usage?.total_tokens)) throw new Error('F85 usage unavailable');
          await save(`${id}.response`, value);
          receipts.push({
            arm,
            phase,
            tokens: value.usage.total_tokens,
            upstreamMs: Math.round(performance.now() - start),
          });
          return response;
        } catch (error) {
          halted = true;
          throw error;
        }
      },
    }).chat(modelId);
    vi.spyOn(resolver, 'resolveModel').mockImplementation(async ({ stage }) => {
      if (stage !== 'quiz-grade') throw new Error('Unexpected F85 model route');
      return {
        model: llm,
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
        apiKey: apiKey ?? 'f85-preflight',
        serverManaged: true,
        thinkingConfig: { mode: 'disabled' },
      };
    });
    const readMemory = memoryRead.readSimulatedLearnerMemory;
    const readMastery = mastery.readPlannerMastery;
    vi.spyOn(memoryRead, 'readSimulatedLearnerMemory').mockImplementation((...args) =>
      arm === 'baseline' ? Promise.reject(new Error('No Memory in control')) : readMemory(...args),
    );
    vi.spyOn(mastery, 'readPlannerMastery').mockImplementation((...args) =>
      arm === 'baseline' ? Promise.resolve([]) : readMastery(...args),
    );
    vi.stubEnv('OWNER_SINGLE_USER', 'false');
    vi.stubEnv('OPENMAIC_QUIZ_FEEDBACK', 'true');
    vi.stubEnv('OPENMAIC_DIALOGUE_EVIDENCE_ENABLED', 'true');
    vi.stubEnv('OPENMAIC_DIALOGUE_EVIDENCE_BINDINGS_FILE', '');
    const app = await getServerPersistenceProvider(appUrl.href);
    const memory = new Pool({
      connectionString: memoryUrl.href,
      options: '-c search_path=f67_simulated_memory',
    });
    try {
      const environment: string = (
        await memory.query('SELECT id FROM f68_memory_environment WHERE singleton=true')
      ).rows[0].id;
      vi.stubEnv(
        'OPENMAIC_SIMULATED_LEARNING_LOOP',
        JSON.stringify({
          sourceNature: 'synthetic',
          conditions: ['F83 synthetic fixture'],
          memoryEnvironmentId: environment,
        }),
      );
      const scope = simulatedScope(student);
      await memory.query(
        'UPDATE learner_memory_states SET snapshot=$3::jsonb WHERE namespace=$1 AND learner_key=$2',
        [scope.namespace, scope.learnerKey, JSON.stringify(simulatedSeed(student).snapshot)],
      );
      expect(
        (await readMemory(student, environment)).usable.pieces.some(({ id }) => id === 'm-density'),
      ).toBe(true);
      expect(await readMastery(owner, student)).toMatchObject([
        { unverified: expect.arrayContaining([expect.stringContaining('独立列式')]) },
      ]);

      const fixtureClassroom = JSON.parse(
        await readFile(join(fixture, 'next.classroom.json'), 'utf8'),
      );
      const docs = await getOwnerScopedDocumentStore(owner);
      const doc = await docs.loadDocument(fixtureClassroom.stage.id);
      if (!doc) throw new Error('Missing F85 classroom fixture');
      const scene: Scene = {
        ...doc.scenes[0]!,
        type: 'quiz',
        content: structuredClone(quizContent),
        title: '密度选择题',
        actions: [],
      };
      doc.scenes = [scene];
      await docs.saveDocument(doc);
      const trace = new QuizTraceService(app);
      const operation = `f85-${mode}`;
      const previous = await trace.prepare(owner, {
        operationId: `${operation}-prepare`,
        mode: 'start',
        stageId: scene.stageId,
        sceneId: scene.id,
        scene,
      });
      const quiz = previous.submission
        ? await trace.prepare(owner, {
            operationId: `${operation}-retry`,
            mode: 'retry',
            stageId: scene.stageId,
            sceneId: scene.id,
            previousAttemptId: previous.attemptId,
          })
        : previous;
      const submissionId = `${operation}-submission`;
      await trace.submit(owner, quiz.attemptId, {
        operationId: `${operation}-submit`,
        submissionId,
        answers: { units: 'A', density: 'B' },
      });
      const headers = {
        cookie: `anonymous_id=${identity}`,
        origin: 'http://localhost',
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
      };
      const { POST: grade } = await import('@/app/api/quiz-grade/route');
      const reviewResponse = await grade(
        new NextRequest('http://localhost/api/quiz-grade', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            attemptId: quiz.attemptId,
            operationId: `${operation}-review`,
            submissionId,
            language: 'zh-CN',
          }),
        }),
      );
      expect(reviewResponse.status).toBe(200);
      const review: QuizReview = await reviewResponse.json();
      expect(review.summary).toMatchObject({
        status: 'complete',
        usableEarned: 1,
        usablePossible: 2,
      });
      const locator = {
        attemptId: quiz.attemptId,
        versionId: quiz.version.id,
        submissionId,
        reviewId: review.id,
      };
      await save('fixture', { scene, locator, review });
      const { GET, POST } = await import('@/app/api/quiz-feedback/route');
      const post = () =>
        POST(
          new NextRequest('http://localhost/api/quiz-feedback', {
            method: 'POST',
            headers,
            body: JSON.stringify({ ...locator, language: 'zh-CN' }),
          }),
        );
      const get = () =>
        GET(
          new NextRequest(`http://localhost/api/quiz-feedback?${new URLSearchParams(locator)}`, {
            headers,
          }),
        );
      for (const current of arms) {
        arm = current;
        expect(halted).toBe(false);
        expect(await (await get()).json()).toEqual({ status: 'idle' });
        const start = performance.now();
        const result = await post();
        const feedbackMs = Math.round(performance.now() - start);
        const feedback = await result.json();
        const readback = await (await get()).json();
        await save(arm, { locator, review, feedback, readback, feedbackMs });
        expect(result.status).toBe(200);
        expect(feedback.status).toBe('ready');
        expect(readback).toEqual(feedback);
        expect(await (await post()).json()).toEqual(feedback);
        expect((await readQuizAttempt(app, owner, quiz.attemptId)).review).toEqual(review);
        if (arm === 'baseline') {
          const reset = await app.pool.query(
            'DELETE FROM quiz_review_feedback WHERE owner_id=$1 AND review_id=$2',
            [owner, review.id],
          );
          expect(reset.rowCount).toBe(1);
        }
      }
    } finally {
      await save('usage', {
        calls,
        receipts,
        totalTokens: receipts.reduce((sum, item) => sum + item.tokens, 0),
      });
      await memory.end();
      await app.pool.end();
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    }
    await checkBatch(output, paid);
  },
  100_000,
);
