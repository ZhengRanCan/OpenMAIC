import { createOpenAI } from '@ai-sdk/openai';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { Pool } from 'pg';
import { expect, it, vi } from 'vitest';
import { simulatedScope, simulatedSeed } from '@/lib/learner-memory/simulated-seeds';
import { readDialogueSource } from '@/lib/persistence/dialogue-trace-read';
import { readQuizAttempt, loadQuizForPlay } from '@/lib/persistence/quiz-trace-read';
import { QuizTraceService } from '@/lib/persistence/quiz-trace';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import type { QuizFeedbackLocator, QuizFeedbackStatus } from '@/lib/quiz/feedback';
import type { QuizPracticeHelpRequest, QuizPracticeStatus } from '@/lib/quiz/practice';
import type { QuizReview } from '@/lib/quiz/trace-types';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { readPlannerMastery } from '@/lib/server/learner-mastery';
import * as resolver from '@/lib/server/resolve-model';
import * as webSearch from '@/lib/server/web-search-config';
import type { ChatSession, StatelessChatRequest, StatelessEvent } from '@/lib/types/chat';
import type { Scene } from '@/lib/types/stage';
import { saveChatSessions } from '@/lib/utils/chat-storage';

const mode = process.env.F87_MODE;
const modelId = 'deepseek-v4-flash';
const endpoint = 'https://api.deepseek.com/v1/chat/completions';
const identity = '67eb7df2-33a8-4fbd-acab-cda635b8ae83';
const owner = `anon:${identity}`;
const student = 'B';
const originalContent: Extract<Scene, { type: 'quiz' }>['content'] = {
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
const guidance = '请给我一个关于这道补充练习题的提示，答案先留到之后。';
const practiceReply = {
  question: '物体质量 0.42 kg、体积 60 cm³，密度是多少 g/cm³？',
  options: ['0.007 g/cm³', '7 g/cm³', '70 g/cm³'],
  correctIndex: 1,
  analysis: '0.42 kg = 420 g，420 ÷ 60 = 7 g/cm³。',
};
const limits = {
  'feedback-selection': 1,
  feedback: 1,
  practice: 1,
  'qa-selection': 1,
  director: 3,
  teacher: 1,
} as const;
type Phase = keyof typeof limits;
type ModelRequest = {
  stream?: boolean;
  model: string;
  messages: { role: string; content: string }[];
  max_tokens?: number;
  max_completion_tokens?: number;
};
type Receipt = { name: string; phase: Phase; tokens: number };

function phaseFor(input: ModelRequest): Phase {
  const system = input.messages.find(({ role }) => role === 'system')?.content ?? '';
  if (system.startsWith('为本次 Quiz 评价后的反馈')) return 'feedback-selection';
  if (system.startsWith('你为已评分的 Quiz')) return 'feedback';
  if (system.startsWith('根据已评分的 Quiz 和练习方向')) return 'practice';
  if (system.startsWith('为当前课堂交流选取')) return 'qa-selection';
  if (system.includes('You are the director of an in-class')) return 'director';
  if (system.includes('# Classroom Role')) return 'teacher';
  throw new Error('Unexpected F87 model phase');
}

function fixedResponse(name: string, phase: Phase, count: number, stream?: boolean) {
  const stub = { id: name, created: 1, model: modelId };
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const canned = {
    'feedback-selection': { selected: ['M5', 'T1'] },
    feedback: {
      summary: '第一题选择正确。第二题所选的 0.006 g/cm³ 与参考值不符。',
      practiceDirection: '用新数值练习先统一质量单位，再列式计算并写出单位。',
    },
    practice: practiceReply,
    'qa-selection': { selected: ['M5', 'T1'] },
  };
  if (phase !== 'director' && phase !== 'teacher')
    return Response.json({
      ...stub,
      object: 'chat.completion',
      usage,
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: JSON.stringify(canned[phase]) },
        },
      ],
    });
  if (!stream) throw new Error('Expected Pi streaming');
  const delta =
    phase === 'teacher'
      ? { content: '先看答案需要用克还是千克，再想质量和体积的关系。你可以试着选一项。' }
      : {
          tool_calls: [
            {
              index: 0,
              id: `call_${name}`,
              type: 'function',
              function:
                count === 1
                  ? {
                      name: 'call_agent',
                      arguments: JSON.stringify({
                        agentId: 'default-1',
                        instruction: '给补充题一个提示，保留答案。',
                      }),
                    }
                  : { name: 'cue_user', arguments: JSON.stringify({ prompt: '请继续作答。' }) },
            },
          ],
        };
  const chunk = { ...stub, object: 'chat.completion.chunk' };
  const records = [
    {
      ...chunk,
      choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }],
    },
    {
      ...chunk,
      choices: [
        { index: 0, delta: {}, finish_reason: phase === 'teacher' ? 'stop' : 'tool_calls' },
      ],
    },
    { ...chunk, choices: [], usage },
  ];
  return new Response(
    records.map((record) => `data: ${JSON.stringify(record)}\n\n`).join('') + 'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

async function check(dir: string, paid: boolean) {
  const load = async (name: string) =>
    JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8'));
  const result = await load('result');
  const { calls, receipts }: { calls: number; receipts: Receipt[] } = await load('usage');
  expect(calls).toBe(paid ? receipts.length : 0);
  expect(receipts.length).toBeLessThanOrEqual(8);
  expect(receipts.map(({ phase }) => phase).slice(0, 3)).toEqual([
    'feedback-selection',
    'feedback',
    'practice',
  ]);
  expect(result.locator.reviewId).toBe(result.original.id);
  expect(result.original).toEqual(result.originalReadback);
  expect(result.original.summary).toMatchObject({ usableEarned: 1, usablePossible: 2 });
  expect(result.practice).toEqual(result.practiceReadback);
  expect(result.practice.review.summary).toMatchObject({ usableEarned: 1, usablePossible: 1 });
  expect(result.practice.attemptId).not.toBe(result.locator.attemptId);
  expect(result.help.link.attemptId).toBe(result.practice.attemptId);
  expect(result.help.link.versionId).toBe(result.practice.review.versionId);
  expect(result.qa.events.map(({ type }: StatelessEvent) => type)).toEqual(
    expect.arrayContaining(['cue_user', 'done']),
  );
  expect(result.qa.events.some(({ type }: StatelessEvent) => type === 'error')).toBe(false);
  expect(result.qa.speech.trim()).not.toBe('');
  const feedback = await load(
    receipts.find(({ phase }) => phase === 'feedback')!.name + '.request',
  );
  const practice = await load(
    receipts.find(({ phase }) => phase === 'practice')!.name + '.request',
  );
  const teacher = await load(receipts.find(({ phase }) => phase === 'teacher')!.name + '.request');
  const input = (request: ModelRequest) =>
    JSON.parse(request.messages.find(({ role }) => role === 'user')!.content);
  expect(input(practice).direction).toBe(result.feedback.feedback.practiceDirection);
  expect(input(feedback).quiz).toEqual(input(practice).quiz);
  expect(input(feedback).history.map(({ kind }: { kind: string }) => kind)).toEqual(
    expect.arrayContaining(['memory', 'mastery']),
  );
  expect(JSON.stringify(teacher.messages)).toContain(result.help.question);
  expect(result.trace.status).toBe('available');
  expect(result.trace.source.messages[0].message.metadata.quizPracticeHelp).toEqual(
    result.help.link,
  );
  expect(result.trace.source.messages[1].text).toBe(result.qa.speech);
}

it.skipIf(!process.env.F87_REPLAY_DIR)('F87 replays the saved continuous run', async () => {
  await check(process.env.F87_REPLAY_DIR!, true);
});

it.skipIf(mode !== 'preflight' && mode !== 'live')(
  'F87 keeps feedback, practice and real Pi QA in one saved classroom',
  async () => {
    const paid = mode === 'live';
    const output = process.env.F87_ARTIFACT_DIR;
    const fixture = process.env.F87_FIXTURE_DIR;
    const key = process.env.DEEPSEEK_API_KEY;
    if (!output || !fixture || (paid && !key)) throw new Error('Missing F87 fixture settings');
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
    const counts = new Map<Phase, number>();
    const receipts: Receipt[] = [];
    const captures: Promise<void>[] = [];
    let calls = 0;
    let attempts = 0;
    let halted = false;
    const model = createOpenAI({
      apiKey: key ?? 'f87-fixture',
      baseURL: 'https://api.deepseek.com/v1',
      fetch: async (url, init) => {
        if (halted || String(url) !== endpoint) throw new Error('F87 external route blocked');
        const raw = JSON.parse(String(init?.body)) as ModelRequest;
        const phase = phaseFor(raw);
        const count = (counts.get(phase) ?? 0) + 1;
        if (attempts >= 8 || count > limits[phase] || raw.model !== modelId)
          throw new Error('F87 request cap');
        counts.set(phase, count);
        const name = `${String(++attempts).padStart(2, '0')}-${phase}`;
        const { max_completion_tokens, max_tokens, ...rest } = raw;
        const body = {
          ...rest,
          max_tokens: Math.min(max_completion_tokens ?? max_tokens ?? 1000, 1000),
          thinking: { type: 'disabled' },
          ...(raw.stream ? { stream_options: { include_usage: true } } : {}),
        };
        const payload = JSON.stringify(body);
        if (Buffer.byteLength(payload) > 128_000) throw new Error('F87 prompt too large');
        await save(`${name}.request`, body);
        try {
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
            : fixedResponse(name, phase, count, raw.stream);
          if (!response.ok) {
            await save(`${name}.http-error`, { status: response.status });
            throw new Error('F87 provider HTTP failure');
          }
          captures.push(
            response
              .clone()
              .text()
              .then(async (value) => {
                const records = raw.stream
                  ? value
                      .split(/\r?\n/)
                      .filter((line) => line.startsWith('data: {'))
                      .map((line) => JSON.parse(line.slice(6)))
                  : [JSON.parse(value)];
                const usage = records.findLast((record) => record.usage)?.usage;
                if (!Number.isFinite(usage?.total_tokens)) throw new Error('F87 usage unavailable');
                await save(`${name}.response`, { records, usage });
                receipts.push({ name, phase, tokens: usage.total_tokens });
              })
              .catch(async () => {
                halted = true;
                await save(`${name}.capture-error`, { phase });
              }),
          );
          return response;
        } catch (error) {
          halted = true;
          throw error;
        }
      },
    }).chat(modelId);
    vi.spyOn(resolver, 'resolveModel').mockImplementation(async ({ stage }) => {
      if (stage !== 'quiz-grade' && stage !== 'scene-content:quiz' && stage !== 'chat-adapter')
        throw new Error('Unexpected F87 model slot');
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
        apiKey: key ?? 'f87-fixture',
        serverManaged: true,
        thinkingConfig: { mode: 'disabled' },
      };
    });
    vi.spyOn(webSearch, 'resolveClassroomWebSearchConfig').mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      locks: {
        request: async (
          _name: string,
          work: LockOptions | (() => Promise<unknown>),
          next?: () => Promise<unknown>,
        ) => (typeof work === 'function' ? work : next!)(),
      },
    });
    for (const [name, value] of Object.entries({
      OWNER_SINGLE_USER: 'false',
      OPENMAIC_QUIZ_FEEDBACK: 'true',
      OPENMAIC_QUIZ_PRACTICE: 'true',
      NEXT_PUBLIC_PI_CHAT_ENABLED: 'true',
      OPENMAIC_ENABLE_PI_NATIVE_CHILD_RUNTIME: 'true',
      OPENMAIC_DIALOGUE_LEARNER_CONTEXT: 'true',
      OPENMAIC_DIALOGUE_EVIDENCE_ENABLED: 'true',
      OPENMAIC_DIALOGUE_EVIDENCE_BINDINGS_FILE: '',
    }))
      vi.stubEnv(name, value);
    const app = await getServerPersistenceProvider(appUrl.href);
    const memory = new Pool({
      connectionString: memoryUrl.href,
      options: '-c search_path=f67_simulated_memory',
    });
    const headers = {
      cookie: `anonymous_id=${identity}`,
      origin: 'http://localhost',
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
    };
    const request = (path: string, body?: unknown) =>
      new NextRequest(`http://localhost${path}`, {
        headers,
        ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      });
    async function json<T>(response: Promise<Response>): Promise<T> {
      const reply = await response;
      expect(reply.status).toBe(200);
      return reply.json();
    }
    try {
      const environment = (
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
      expect(await readPlannerMastery(owner, student)).not.toHaveLength(0);
      const source = JSON.parse(await readFile(join(fixture, 'next.classroom.json'), 'utf8'));
      const docs = await getOwnerScopedDocumentStore(owner);
      const doc = await docs.loadDocument(source.stage.id);
      if (!doc) throw new Error('Missing F87 classroom');
      const first = source.scenes[0] as Scene;
      const scene: Scene = {
        ...first,
        type: 'quiz',
        title: '密度测验',
        content: originalContent,
        actions: [],
      };
      const next: Scene = {
        ...first,
        id: 'f87-next-scene',
        order: scene.order + 1,
        title: '课堂继续',
        actions: [],
      };
      doc.scenes = [scene, next];
      await docs.saveDocument(doc);
      const trace = new QuizTraceService(app);
      const operation = `f87-${mode}-${randomUUID()}`;
      const previous = await trace.prepare(owner, {
        operationId: `${operation}-prepare`,
        mode: 'start',
        stageId: scene.stageId,
        sceneId: scene.id,
        scene,
      });
      const attempt = previous.submission
        ? await trace.prepare(owner, {
            operationId: `${operation}-retry`,
            mode: 'retry',
            stageId: scene.stageId,
            sceneId: scene.id,
            previousAttemptId: previous.attemptId,
          })
        : previous;
      const submissionId = `${operation}-submission`;
      await trace.submit(owner, attempt.attemptId, {
        operationId: `${operation}-submit`,
        submissionId,
        answers: { units: 'A', density: 'B' },
      });
      const { POST: grade } = await import('@/app/api/quiz-grade/route');
      const original = await json<QuizReview>(
        grade(
          request('/api/quiz-grade', {
            attemptId: attempt.attemptId,
            operationId: `${operation}-review`,
            submissionId,
            language: 'zh-CN',
          }),
        ),
      );
      const locator: QuizFeedbackLocator = {
        attemptId: attempt.attemptId,
        versionId: attempt.version.id,
        submissionId,
        reviewId: original.id,
      };
      const { POST: feedbackPost, GET: feedbackGet } =
        await import('@/app/api/quiz-feedback/route');
      const feedback = await json<QuizFeedbackStatus>(
        feedbackPost(request('/api/quiz-feedback', { ...locator, language: 'zh-CN' })),
      );
      await save('feedback', { locator, feedback });
      expect(
        await json(feedbackGet(request(`/api/quiz-feedback?${new URLSearchParams(locator)}`))),
      ).toEqual(feedback);
      if (feedback.status !== 'ready' || !feedback.feedback.practiceDirection)
        throw new Error('F87 stopped without a saved practice suggestion');
      const { GET: practiceGet, POST: practicePost } =
        await import('@/app/api/quiz-practice/route');
      const practiceRead = () =>
        json<QuizPracticeStatus>(
          practiceGet(request(`/api/quiz-practice?${new URLSearchParams(locator)}`)),
        );
      const practiceAction = <T>(fields: Record<string, unknown>) =>
        json<T>(practicePost(request('/api/quiz-practice', { ...locator, ...fields })));
      expect(await practiceRead()).toEqual({ status: 'idle' });
      expect(counts.get('practice') ?? 0).toBe(0);
      const accept = () =>
        practiceAction<QuizPracticeStatus>({ action: 'accept', language: 'zh-CN' });
      const opened = await accept();
      await save('practice-open', opened);
      if (opened.status !== 'ready') throw new Error('F87 practice unavailable');
      expect(opened.question.answer).toBeUndefined();
      expect(await accept()).toEqual(opened);
      const saved = await readQuizAttempt(app, owner, opened.attemptId);
      expect(saved.practiceSourceReviewId).toBe(original.id);
      const question =
        saved.version.scene.type === 'quiz' && saved.version.scene.content.questions[0];
      if (!question || !question.answer?.[0]) throw new Error('F87 missing answer key');
      const mass = Number(question.question.match(/(\d+(?:\.\d+)?)\s*(?:kg|千克)/i)?.[1]);
      const volume = Number(
        question.question.match(/(\d+(?:\.\d+)?)\s*(?:cm(?:³|\^?3)|立方厘米)/i)?.[1],
      );
      const reference =
        question.options?.find(({ value }) => value === question.answer![0])?.label ?? '';
      const density = Number(
        reference.match(
          /^\s*(\d+(?:\.\d+)?)\s*(?:g\s*\/\s*cm(?:³|\^?3)|克\s*\/\s*立方厘米)\s*$/i,
        )?.[1],
      );
      expect(Number.isFinite(mass) && volume > 0 && Number.isFinite(density)).toBe(true);
      expect([mass, volume]).not.toEqual([0.54, 90]);
      expect(density).toBeCloseTo((mass * 1000) / volume, 5);
      await save('answer-check', { mass, volume, density, reference });
      const help = await practiceAction<QuizPracticeHelpRequest>({
        action: 'help',
        helpId: randomUUID(),
      });
      const message: StatelessChatRequest['messages'][number] = {
        id: 'f87-help-question',
        role: 'user',
        parts: [
          {
            type: 'text',
            text: [
              guidance,
              help.question,
              ...help.options.map((label, i) => `${String.fromCharCode(65 + i)}. ${label}`),
            ].join('\n'),
          },
        ],
        metadata: { quizPracticeHelp: help.link },
      };
      const body: StatelessChatRequest = {
        messages: [message],
        config: { agentIds: ['default-1'], sessionType: 'qa', piMaxAgentTurns: 1 },
        storeState: {
          stage: doc.stage,
          scenes: doc.scenes,
          currentSceneId: scene.id,
          mode: 'autonomous',
          whiteboardOpen: false,
        },
        apiKey: '',
      };
      await save('qa-input', body);
      const { POST: chat } = await import('@/app/api/chat/pi/route');
      const qaReply = await chat(request('/api/chat/pi', body));
      expect(qaReply.status).toBe(200);
      const events: StatelessEvent[] = (await qaReply.text())
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data: {'))
        .map((line) => JSON.parse(line.slice(6)));
      const speech = events
        .flatMap((event) => (event.type === 'text_delta' ? [event.data.content] : []))
        .join('');
      await save('qa', { speech, events });
      await Promise.all(captures);
      expect(halted).toBe(false);
      expect(events.some(({ type }) => type === 'error')).toBe(false);
      expect(events.map(({ type }) => type)).toEqual(expect.arrayContaining(['cue_user', 'done']));
      expect(speech.trim()).not.toBe('');
      const now = Date.now();
      const chatSession: ChatSession = {
        id: `${operation}-qa`,
        type: 'qa',
        title: 'Q&A',
        status: 'completed',
        messages: [
          message,
          { id: 'f87-visible-teacher', role: 'assistant', parts: [{ type: 'text', text: speech }] },
        ],
        config: { agentIds: ['default-1'] },
        toolCalls: [],
        pendingToolCalls: [],
        initialContext: {
          stageId: scene.stageId,
          stageTitle: doc.stage.name,
          sceneId: scene.id,
          sceneTitle: scene.title,
        },
        sceneId: scene.id,
        createdAt: now,
        updatedAt: now,
      };
      await saveChatSessions(scene.stageId, [chatSession], {
        store: app.runtimeStore,
        learnerKey: owner,
      });
      const qaTrace = await readDialogueSource(app, owner, {
        stageId: scene.stageId,
        chatSessionId: chatSession.id,
      });
      const practice = await practiceAction<QuizPracticeStatus>({
        action: 'submit',
        choice: question.answer[0],
      });
      const practiceReadback = await practiceRead();
      const originalReadback = (await loadQuizForPlay(app, owner, scene.stageId, scene.id))?.review;
      const nextReadback = (await docs.loadDocument(scene.stageId))?.scenes[1];
      expect(nextReadback?.id).toBe(next.id);
      await save('result', {
        locator,
        original,
        originalReadback,
        feedback,
        opened,
        help,
        qa: { speech, events },
        trace: qaTrace,
        practice,
        practiceReadback,
        nextScene: nextReadback?.id,
      });
    } finally {
      await Promise.all(captures);
      receipts.sort((a, b) => a.name.localeCompare(b.name));
      await save('usage', {
        calls,
        receipts,
        totalTokens: receipts.reduce((sum, receipt) => sum + receipt.tokens, 0),
      });
      await memory.end();
      await app.pool.end();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
    await check(output, paid);
  },
  130_000,
);
