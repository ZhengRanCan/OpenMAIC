import { createOpenAI } from '@ai-sdk/openai';
import {
  nodePostgresTransaction,
  type ConnectableQueryable,
} from '@openmaic/storage/server/reference';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { Pool } from 'pg';
import { expect, it, vi } from 'vitest';
import { POST as grade } from '@/app/api/quiz-grade/route';
import { GET as readQuiz, POST as writeQuiz } from '@/app/api/quiz-trace/[...path]/route';
import { POST as confirm } from '@/app/api/generation-runs/[id]/confirm-outline/route';
import { runPiDirectorLoop } from '@/lib/chat/pi/director-loop';
import {
  DIALOGUE_PROMPT_VERSION,
  type DialogueEvidenceSettings,
} from '@/lib/dialogue/evidence-contracts';
import { emptySnapshot } from '@/lib/learner-memory/contracts';
import { SimulatedMemoryEnvironment } from '@/lib/learner-memory/simulated-environment';
import { simulatedScope, simulatedSeed } from '@/lib/learner-memory/simulated-seeds';
import { getBuiltInAgent } from '@/lib/orchestration/registry/built-in';
import { DialogueEvidenceStore } from '@/lib/persistence/dialogue-evidence-store';
import { readDialogueSource } from '@/lib/persistence/dialogue-trace-read';
import { ensureMemorySchema } from '@/lib/persistence/learner-memory-schema';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { stopAgentEventNotifyBus } from '@/lib/server/agent-runtime/event-notify-bus';
import * as provenance from '@/lib/server/dialogue-evidence-provenance';
import { executeGenerationRun } from '@/lib/server/generation/run/engine';
import { defaultRunStepServices } from '@/lib/server/generation/run/services';
import type { GenerationRunInput } from '@/lib/server/generation/run/types';
import {
  claimNextGenerationRun,
  createGenerationRun,
  readGenerationRun,
} from '@/lib/server/generation/run/store';
import { LearnerMastery, readPlannerMastery } from '@/lib/server/learner-mastery';
import * as resolver from '@/lib/server/resolve-model';
import { readSimulatedLearnerMemory } from '@/lib/server/simulated-learner-memory';
import type { ChatSession, StatelessEvent } from '@/lib/types/chat';
import { loadChatSessions, saveChatSessions } from '@/lib/utils/chat-storage';
import {
  model as evidenceModel,
  reply as evidenceReply,
} from '../persistence/dialogue-evidence-fixture';

const mode = process.env.F81_MODE;
const endpoint = 'https://api.deepseek.com/v1/chat/completions';
const modelId = 'deepseek-v4-flash';
const identity = '67eb7df2-33a8-4fbd-acab-cda635b8ae81';
const owner = `anon:${identity}`;
const student = 'B';
const environmentId = '5ba2fc95-9387-4d4f-9ac1-94d9fedacf81';
const requirement =
  '给初二学生生成恰好两页的中文密度复习课。第一页为一题单选 Quiz，围绕密度单位和计算。第二页为普通幻灯片，安排一项新题并通过 Discussion 收集学生的解题过程。只用文字和表格，不需要图片、视频或语音合成。';
const limits = { maxActiveRunsPerOwner: 6, maxWaitingRunsPerOwner: 6 };
const message = (id: string, role: 'user' | 'assistant', text: string) => ({
  id,
  role,
  parts: [{ type: 'text' as const, text }],
});

const replay = mode === 'replay';

it.skipIf(mode !== 'preflight' && mode !== 'live' && !replay)(
  'F81 runs four actual profile contexts and completes the joint classroom',
  async () => {
    const appUrl = process.env.DATABASE_URL ?? '';
    const memoryUrl = process.env.MEMORY_DATABASE_URL ?? '';
    for (const [url, name] of [
      [appUrl, 'f81_app'],
      [memoryUrl, 'f81_memory'],
    ]) {
      const parsed = new URL(url!);
      expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual([
        '127.0.0.1',
        '55481',
        `/${name}`,
      ]);
    }
    const output = process.env.F81_ARTIFACT_DIR;
    const apiKey = process.env.DEEPSEEK_API_KEY;
    const replayClassroom = process.env.F81_REPLAY_CLASSROOM;
    if ((mode === 'live' && (!output || !apiKey)) || (replay && (!output || !replayClassroom)))
      throw new Error('Missing F81 validation configuration');
    if (output && mode !== 'preflight') await mkdir(output);
    const save = async (name: string, data: unknown) => {
      if (output && mode !== 'preflight')
        await writeFile(join(output!, `${name}.json`), JSON.stringify(data, null, 2) + '\n', {
          flag: 'wx',
        });
    };
    const callCounts = new Map<string, number>();
    let calls = 0;
    let stopped = false;
    const receipts: { label: string; total: number }[] = [];
    function modelFor(label: string, cap: number) {
      return createOpenAI({
        apiKey: apiKey || 'preflight',
        baseURL: 'https://api.deepseek.com/v1',
        fetch: async (url, init) => {
          const count = callCounts.get(label) ?? 0;
          if (mode !== 'live' || stopped || count >= cap || calls >= 24 || String(url) !== endpoint)
            throw new Error(`F81 transport blocked ${label}`);
          const request = JSON.parse(String(init?.body));
          if (request.model !== modelId) throw new Error('F81 unexpected model');
          const {
            max_completion_tokens: completionLimit,
            max_tokens: outputLimit,
            ...rest
          } = request;
          const body = {
            ...rest,
            thinking: { type: 'disabled' },
            max_tokens: Math.min(completionLimit ?? outputLimit ?? 4096, 4096),
            ...(request.stream ? { stream_options: { include_usage: true } } : {}),
          };
          const rawRequest = JSON.stringify(body);
          if (Buffer.byteLength(rawRequest) > 128 * 1024) throw new Error('F81 request cap');
          const prefix = `${String(++calls).padStart(2, '0')}-${label.replaceAll(':', '-')}`;
          callCounts.set(label, count + 1);
          await save(`${prefix}.request`, body);
          try {
            const response = await fetch(endpoint, {
              ...init,
              body: rawRequest,
              redirect: 'error',
              signal: AbortSignal.any([
                AbortSignal.timeout(120_000),
                ...(init?.signal ? [init.signal] : []),
              ]),
            });
            const raw = await response.clone().text();
            if (!response.ok) {
              await save(`${prefix}.error`, { status: response.status });
              throw new Error(`F81 provider HTTP ${response.status}`);
            }
            const result = request.stream
              ? raw
                  .split(/\r?\n/)
                  .filter((line) => line.startsWith('data: {'))
                  .map((line) => JSON.parse(line.slice(6)))
              : [JSON.parse(raw)];
            const usage = result.findLast((event) => event.usage)?.usage;
            await save(`${prefix}.response`, { usage, result });
            expect(usage?.total_tokens).toBeGreaterThan(0);
            receipts.push({ label, total: usage.total_tokens });
            return response;
          } catch (error) {
            stopped = true;
            throw error;
          }
        },
      }).chat(modelId);
    }

    const app = await getServerPersistenceProvider(appUrl);
    const memory = new Pool({
      connectionString: memoryUrl,
      options: '-c search_path=f67_simulated_memory',
    });
    const docStore = await getOwnerScopedDocumentStore(owner);
    const options = { store: app.runtimeStore, learnerKey: owner };
    vi.stubGlobal('navigator', {
      locks: {
        request: async (
          _name: string,
          work: LockOptions | (() => Promise<unknown>),
          next?: () => Promise<unknown>,
        ) => (typeof work === 'function' ? work : next!)(),
      },
    });
    vi.stubEnv('OPENMAIC_DIALOGUE_EVIDENCE_ENABLED', 'true');
    const settings: DialogueEvidenceSettings = { bindings: [], memoryEnvironmentId: environmentId };
    vi.spyOn(provenance, 'loadDialogueEvidenceSettings').mockResolvedValue(settings);
    const setMastery = (enabled: boolean) =>
      vi.stubEnv(
        'OPENMAIC_SIMULATED_LEARNING_LOOP',
        enabled
          ? JSON.stringify({
              sourceNature: 'synthetic',
              conditions: ['F81 synthetic fixture'],
              memoryEnvironmentId: environmentId,
            })
          : '',
      );
    const request = (path: string, body?: unknown) =>
      new NextRequest(`http://localhost${path}`, {
        ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
        headers: {
          cookie: `anonymous_id=${identity}`,
          origin: 'http://localhost',
          'content-type': 'application/json',
        },
      });
    const runInput: GenerationRunInput = {
      requirement,
      simulatedLearner: student,
      materialIds: [],
      interactive: false,
      taskEngine: false,
      agents: { mode: 'preset' as const, agentIds: ['default-1'] },
      outlineReview: 'wait' as const,
    };
    try {
      await memory.query('CREATE SCHEMA IF NOT EXISTS f67_simulated_memory');
      await ensureMemorySchema(memory);
      await new SimulatedMemoryEnvironment({
        withTransaction: nodePostgresTransaction(memory as unknown as ConnectableQueryable),
      }).initialize(student);
      const seed = simulatedSeed(student);
      const scope = simulatedScope(student);
      const setMemory = (enabled: boolean) =>
        memory.query(
          'UPDATE learner_memory_states SET snapshot=$3::jsonb WHERE namespace=$1 AND learner_key=$2',
          [
            scope.namespace,
            scope.learnerKey,
            JSON.stringify(enabled ? seed.snapshot : emptySnapshot()),
          ],
        );
      const prior = await createGenerationRun(owner, runInput, limits);
      const oldStage = `stage-f81-history-${prior.id}`;
      const now = Date.now();
      await docStore.createDocument({
        stage: {
          id: oldStage,
          name: '合成密度历史课',
          description: '',
          style: 'professional',
          createdAt: now,
          updatedAt: now,
        },
        scenes: [],
      });
      const target = {
        id: `${prior.id}:target:1`,
        revision: 1,
        statement: '给定 kg 和 cm³ 的新密度题，独立提交换算、列式、结果及单位。',
      };
      await app.pool.query(
        "UPDATE generation_runs SET stage_id=$2,state='completed',outline=$3::jsonb,outline_revision=1 WHERE id=$1",
        [prior.id, oldStage, JSON.stringify({ outlines: [], targets: [target] })],
      );
      const history: ChatSession = {
        id: 'f81-prior',
        type: 'discussion',
        title: '合成密度作答',
        status: 'completed',
        config: { agentIds: ['default-1'] },
        toolCalls: [],
        pendingToolCalls: [],
        createdAt: now,
        updatedAt: now + 1,
        initialContext: { stageId: oldStage, stageTitle: '合成密度历史课' },
        messages: [
          message('teacher', 'assistant', '0.48 kg 已换算为 480 g，体积为 40 cm³，请求密度。'),
          message('student', 'user', '480 ÷ 40 = 12 g/cm³。'),
        ],
      };
      await saveChatSessions(oldStage, [history], options);
      const source = await readDialogueSource(app, owner, {
        stageId: oldStage,
        chatSessionId: history.id,
      });
      if (source.status !== 'available') throw new Error(source.status);
      settings.bindings.push({
        ownerId: owner,
        stageId: oldStage,
        chatSessionId: history.id,
        sourceDigest: source.source.contentDigest,
        generationRunId: prior.id,
        student,
        sourceNature: 'synthetic',
        conditions: ['F81 synthetic history'],
        memoryEnvironmentId: environmentId,
      });
      const evidence = new DialogueEvidenceStore(app);
      const sourceRequest = {
        operationId: `${prior.id}:f81-prior`,
        stageId: oldStage,
        chatSessionId: history.id,
      };
      const model = { ...evidenceModel, promptVersion: DIALOGUE_PROMPT_VERSION };
      const prepared = await evidence.prepare(owner, sourceRequest, settings, model);
      const claimed = await evidence.claim(owner, prepared.id, settings);
      if (!claimed) throw new Error('Missing F81 synthetic source claim');
      await evidence.capture(
        owner,
        claimed,
        {
          ...evidenceReply,
          text: JSON.stringify({
            facts: [
              {
                type: 'learning_performance',
                evidence: '教师给出换算值后，学生算得 12 g/cm³。',
                refs: ['teacher', 'student'],
              },
            ],
          }),
        },
        settings,
      );
      const completed = await evidence.finalize(owner, prepared.id);
      expect(completed.state).toBe('completed');
      const mastery = await new LearnerMastery(app, settings).maintain(
        { ownerId: owner, runId: prior.id, targetId: target.id, targetRevision: 1 },
        [completed.id],
        async (_system, user) => {
          const evidenceRef = JSON.parse(user).evidence[0].evidenceRef;
          const text = '教师给出 480 g 后，学生算得 12 g/cm³。';
          return JSON.stringify({
            assessments: [
              {
                evidenceRef,
                coverage: 'partial',
                result: 'correct',
                assistance: 'assisted',
                observation: text,
              },
            ],
            candidateState: {
              summary: text,
              unverified: ['独立完成 kg 到 g 换算并写出密度列式、结果及单位'],
              adoptedEvidenceRefs: [evidenceRef],
            },
          });
        },
      );
      expect(mastery?.state.observations).toHaveLength(1);
      setMastery(true);
      expect(await readPlannerMastery(owner, student)).toHaveLength(1);
      expect(await readPlannerMastery(owner, 'A')).toEqual([]);
      expect(
        await readPlannerMastery('anon:00000000-0000-4000-8000-000000000001', student),
      ).toEqual([]);
      expect((await readSimulatedLearnerMemory(student)).usable.pieces.length).toBeGreaterThan(0);
      if (mode === 'preflight') {
        expect(calls).toBe(0);
        return;
      }
      await save('seed', {
        source: source.source,
        evidenceRunId: completed.id,
        mastery,
        memory: seed.snapshot,
      });

      async function quizAttempt(
        doc: NonNullable<Awaited<ReturnType<typeof docStore.loadDocument>>>,
      ) {
        const quiz = doc.scenes[0];
        if (quiz?.type !== 'quiz') throw new Error('F81 expected a Quiz');
        const question = quiz.content.questions[0];
        if (
          quiz.content.questions.length !== 1 ||
          question?.type !== 'single' ||
          !question.answer?.length
        )
          throw new Error('F81 expected one keyed choice');
        const choice = question.options?.find(
          ({ value }) => Boolean(question.answer?.includes(value)) === replay,
        );
        if (!choice) throw new Error('F81 missing option for this comparison');
        const attemptResponse = await writeQuiz(
          request('/api/quiz-trace/prepare', {
            operationId: 'f81-start',
            mode: 'start',
            stageId: doc.stage.id,
            sceneId: quiz.id,
            scene: quiz,
          }),
        );
        expect(attemptResponse.status).toBe(200);
        const attempt = await attemptResponse.json();
        const submitted = await writeQuiz(
          request(`/api/quiz-trace/attempts/${attempt.attemptId}/submission`, {
            operationId: 'f81-submit',
            submissionId: 'f81-answer',
            answers: { [question.id]: choice.value },
          }),
        );
        expect(submitted.status).toBe(200);
        const gradeResponse = await grade(
          request('/api/quiz-grade', {
            attemptId: attempt.attemptId,
            operationId: 'f81-grade',
            submissionId: 'f81-answer',
            language: 'zh-CN',
          }),
        );
        expect(gradeResponse.status).toBe(200);
        const graded = await gradeResponse.json();
        const trace = await readQuiz(request(`/api/quiz-trace/attempts/${attempt.attemptId}`));
        expect(trace.status).toBe(200);
        const saved = await trace.json();
        expect(saved.submission.answers).toEqual({ [question.id]: choice.value });
        expect(saved.review.summary).toMatchObject({
          usableEarned: replay ? 1 : 0,
          usablePossible: 1,
        });
        expect(graded.results[0].correct).toBe(replay);
        return { selected: choice, grade: graded, trace: saved };
      }

      if (replay) {
        vi.stubGlobal(
          'fetch',
          vi.fn(() => {
            throw new Error('F81 replay network blocked');
          }),
        );
        const beforeMemory = (await readSimulatedLearnerMemory(student)).usable;
        const historical = beforeMemory.pieces.find(({ id }) => id === 'm-density');
        expect(historical?.text).toContain('直接写成2.7kg/m³');
        const beforeMastery = await readPlannerMastery(owner, student);
        const savedDoc = JSON.parse(await readFile(replayClassroom!, 'utf8'));
        await docStore.createDocument(savedDoc);
        const doc = await docStore.loadDocument(savedDoc.stage.id);
        if (!doc) throw new Error('Missing F81 replay classroom');
        const attempt = await quizAttempt(doc);
        expect(attempt.selected.label).toContain('2700 kg/m³');
        expect((await readSimulatedLearnerMemory(student)).usable).toEqual(beforeMemory);
        expect(await readPlannerMastery(owner, student)).toEqual(beforeMastery);
        expect(fetch).not.toHaveBeenCalled();
        await save('profile-conflict', {
          historicalMemory: historical,
          masteryBeforeAndAfter: beforeMastery,
          currentAttempt: attempt,
          modelCalls: 0,
        });
        return;
      }

      let arm = 'empty';
      vi.spyOn(resolver, 'resolveModel').mockImplementation(async ({ stage }) => {
        if (
          !stage ||
          ![
            'scene-outlines-stream',
            'scene-content:quiz',
            'scene-content:slide',
            'scene-actions',
          ].includes(stage)
        )
          throw new Error(`F81 unexpected route ${stage}`);
        const cap =
          stage === 'scene-actions' ||
          (stage === 'scene-outlines-stream' && (arm === 'memory' || arm === 'both')) ||
          (stage === 'scene-content:quiz' && arm === 'both')
            ? 2
            : 1;
        return {
          model: modelFor(`${arm}-${stage}`, cap),
          modelInfo: { id: modelId, name: modelId, outputWindow: 4096, capabilities: {} },
          providerId: 'deepseek',
          modelId,
          modelString: `deepseek:${modelId}`,
          apiKey: apiKey!,
          serverManaged: false,
          thinkingConfig: { mode: 'disabled' },
        };
      });
      const drive = async (id: string) => {
        const claim = await claimNextGenerationRun('f81-live', {
          runId: id,
          leaseTtlMs: 300_000,
          maxTakeovers: 0,
        });
        if (!claim) throw new Error('Missing F81 run claim');
        return executeGenerationRun(claim, {
          signal: AbortSignal.timeout(240_000),
          services: {
            ...defaultRunStepServices,
            research: async () => null,
            narrationTarget: async () => null,
          },
        });
      };
      let bothRunId = '';
      for (const [name, hasMemory, hasMastery] of [
        ['empty', false, false],
        ['memory', true, false],
        ['mastery', false, true],
        ['both', true, true],
      ] as const) {
        arm = name;
        await setMemory(hasMemory);
        setMastery(hasMastery);
        const run = await createGenerationRun(owner, runInput, limits);
        const outcome = await drive(run.id);
        const stored = await readGenerationRun(run.id, owner);
        await save(`${arm}.run`, stored);
        expect(outcome).toBe('waiting');
        expect(stored?.outline?.outlines.map(({ type }) => type)).toEqual(['quiz', 'slide']);
        expect(stored?.outline?.learnerContext?.status).toBe(hasMemory ? 'ready' : 'empty');
        expect(stored?.outline?.masteryTargets?.length ?? 0).toBe(hasMastery ? 1 : 0);
        if (arm === 'both') bothRunId = run.id;
      }
      const confirmed = await confirm(
        request(`/api/generation-runs/${bothRunId}/confirm-outline`, {
          commandId: 'f81-confirm',
          outlineRevision: 1,
        }),
        { params: Promise.resolve({ id: bothRunId }) },
      );
      expect(confirmed.status).toBe(200);
      const outcome = await drive(bothRunId);
      const finished = await readGenerationRun(bothRunId, owner);
      await save('both.completed', finished);
      expect(outcome).toBe('completed');
      const doc = await docStore.loadDocument(finished!.stageId!);
      await save('both.classroom', doc);
      if (!doc) throw new Error('Missing F81 classroom');
      expect(doc.outline).toMatchObject({ generationComplete: true });
      expect(finished?.outline?.quizLearnerContexts?.['scene:0']?.status).toBe('ready');
      const [quiz, slide] = doc.scenes;
      if (quiz?.type !== 'quiz' || slide?.type !== 'slide')
        throw new Error('F81 generated scene types');
      const discussion = slide.actions?.find((action) => action.type === 'discussion');
      if (discussion?.type !== 'discussion') throw new Error('F81 Discussion was not generated');

      await save('quiz.interaction', await quizAttempt(doc));

      const agent = getBuiltInAgent('default-1');
      if (!agent) throw new Error('Missing teacher');
      const sessions: ChatSession[] = [];
      for (const kind of ['qa', 'discussion'] as const) {
        const user = message(
          'student-question',
          'user',
          '我只知道要统一单位。能给我一个提示，让我自己判断要换什么单位吗？',
        );
        const events: StatelessEvent[] = [];
        const signal = AbortSignal.timeout(120_000);
        await runPiDirectorLoop({
          body: {
            messages: kind === 'qa' ? [user] : [],
            apiKey: '',
            storeState: {
              stage: doc.stage,
              scenes: doc.scenes,
              currentSceneId: slide.id,
              mode: 'autonomous',
              whiteboardOpen: false,
            },
            config: {
              agentIds: [agent.id],
              sessionType: kind,
              ...(kind === 'discussion'
                ? {
                    discussionTopic: discussion.topic,
                    discussionPrompt: discussion.prompt,
                    triggerAgentId: agent.id,
                  }
                : {}),
            },
          },
          agentConfigs: [agent],
          send: async (event) => {
            events.push(event);
          },
          languageModel: modelFor(kind, 6),
          thinkingConfig: { mode: 'disabled', enabled: false },
          maxOutputTokens: 2048,
          abortSignal: signal,
          signal,
          maxAgentTurns: 1,
          maxActionsPerAgent: 4,
          enableWhiteboardTools: false,
        });
        const answer = events
          .filter((event) => event.type === 'text_delta')
          .map((event) => event.data.content)
          .join('');
        await save(`${kind}.events`, { answer, events });
        expect(answer.trim()).not.toBe('');
        expect(events.some(({ type }) => type === 'error')).toBe(false);
        if (kind === 'discussion')
          expect(events.some(({ type }) => type === 'cue_user')).toBe(true);
        const opened = Date.now();
        const chat: ChatSession = {
          id: `f81-${kind}`,
          type: kind,
          title: `F81 ${kind}`,
          status: 'completed',
          createdAt: opened,
          updatedAt: opened + 1,
          messages:
            kind === 'qa'
              ? [user, message('teacher', 'assistant', answer)]
              : [
                  message('teacher', 'assistant', answer),
                  message(
                    'student-answer',
                    'user',
                    '我先把千克换成克，再用质量除以体积，最后写 g/cm³。',
                  ),
                ],
          config: { agentIds: [agent.id] },
          toolCalls: [],
          pendingToolCalls: [],
          initialContext: {
            stageId: doc.stage.id,
            stageTitle: doc.stage.name,
            sceneId: slide.id,
            sceneTitle: slide.title,
          },
          learningClosure: { id: `f81-close-${kind}`, source: 'manual_stop' },
        };
        sessions.push(chat);
        await saveChatSessions(doc.stage.id, sessions, options);
        const readback = await readDialogueSource(app, owner, {
          stageId: doc.stage.id,
          chatSessionId: chat.id,
        });
        await save(`${kind}.source`, readback);
        if (readback.status !== 'available') throw new Error(readback.status);
        expect(readback.source.messages.map(({ message }) => message)).toEqual(chat.messages);
      }
      const reopened = await loadChatSessions(doc.stage.id, options);
      expect(
        reopened
          .filter(({ id }) => id.startsWith('f81-'))
          .map(({ id }) => id)
          .sort(),
      ).toEqual(['f81-discussion', 'f81-qa']);
      expect(await docStore.loadDocument(doc.stage.id)).toEqual(doc);
      await save('classroom.reopen', {
        sceneIds: doc.scenes.map(({ id }) => id),
        sessions: reopened.map(({ id, type, status }) => ({ id, type, status })),
      });
    } finally {
      await save('usage', { calls, receipts, stopped });
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      await stopAgentEventNotifyBus();
      await memory.end();
      await app.pool.end();
    }
  },
  900_000,
);
