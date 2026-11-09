import { createOpenAI } from '@ai-sdk/openai';
import type { ConnectableQueryable } from '@openmaic/storage/server/reference';
import { nodePostgresTransaction } from '@openmaic/storage/server/reference';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { Pool } from 'pg';
import { expect, it, vi } from 'vitest';
import { POST as confirm } from '@/app/api/generation-runs/[id]/confirm-outline/route';
import * as llm from '@/lib/ai/llm';
import { emptySnapshot } from '@/lib/learner-memory/contracts';
import { SimulatedMemoryEnvironment } from '@/lib/learner-memory/simulated-environment';
import { simulatedScope } from '@/lib/learner-memory/simulated-seeds';
import { readDialogueEvidenceRun } from '@/lib/persistence/dialogue-evidence-read';
import { dialogueLoopRuntime } from '@/lib/persistence/dialogue-learning-loop-runtime';
import { readDialogueSource } from '@/lib/persistence/dialogue-trace-read';
import { ensureMemorySchema } from '@/lib/persistence/learner-memory-schema';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { stopAgentEventNotifyBus } from '@/lib/server/agent-runtime/event-notify-bus';
import { startDialogueLearningLoop } from '@/lib/server/dialogue-learning-loop/runner';
import { DialogueLoopStore } from '@/lib/server/dialogue-learning-loop/store';
import { executeGenerationRun } from '@/lib/server/generation/run/engine';
import { defaultRunStepServices, type RunStepServices } from '@/lib/server/generation/run/services';
import {
  claimNextGenerationRun,
  createGenerationRun,
  readGenerationRun,
} from '@/lib/server/generation/run/store';
import {
  LearnerMastery,
  readPlannerMastery,
  type MasteryLocator,
} from '@/lib/server/learner-mastery';
import { MasteryLearningLoop, startMasteryLearningLoop } from '@/lib/server/mastery-learning-loop';
import { initializeMemoryEnvironment } from '@/lib/server/quiz-short-facts';
import * as resolver from '@/lib/server/resolve-model';
import type { ChatSession } from '@/lib/types/chat';
import type { Scene } from '@/lib/types/stage';
import { saveChatSessions } from '@/lib/utils/chat-storage';

const mode = process.env.F83_MODE;
const continuation = mode === 'continue';
const live = mode === 'live' || continuation;
const modelId = 'deepseek-v4-flash';
const endpoint = 'https://api.deepseek.com/v1/chat/completions';
const identity = '67eb7df2-33a8-4fbd-acab-cda635b8ae83';
const owner = `anon:${identity}`;
const student = 'B';
const task = '给定质量 0.72 kg、体积 90 cm³，求密度。请独立写出单位换算、列式、结果和单位。';
const answer = '0.72 kg = 720 g。我先写到这里，还没有列式或计算密度。';
const statement = '给定以 kg 表示的质量和以 cm³ 表示的体积，独立写出换算、密度列式、结果和单位。';
const requirement =
  '为初二学生生成恰好一页中文密度巩固课，练习请使用新的数值。使用纯文本，无需图片、视频或语音合成。' +
  (continuation ? '只用普通幻灯片呈现一道独立练习，请学生通过 Discussion 提交过程。' : '');
const outline = {
  id: 'f83-slide',
  type: 'slide' as const,
  title: '密度过程题',
  description: task,
  keyPoints: [task],
  order: 1,
};
const message = (id: string, role: 'assistant' | 'user', text: string) => ({
  id,
  role,
  parts: [{ type: 'text' as const, text }],
});

it.skipIf(mode !== 'preflight' && !live)(
  'F83 automatically carries new Discussion evidence into a saved next classroom',
  async () => {
    const appUrl = process.env.DATABASE_URL ?? '';
    const memoryUrl = process.env.MEMORY_DATABASE_URL ?? '';
    for (const [raw, purpose] of [
      [appUrl, 'app'],
      [memoryUrl, 'memory'],
    ]) {
      const url = new URL(raw);
      expect([url.hostname, url.port, url.pathname]).toEqual([
        '127.0.0.1',
        '55483',
        `/f83_${live ? 'live' : 'preflight'}_${purpose}`,
      ]);
    }
    const output = process.env.F83_ARTIFACT_DIR;
    const key = process.env.DEEPSEEK_API_KEY;
    const proofPath = process.env.F83_PRIOR_PROOF;
    if (!output || (live && !key) || (continuation && !proofPath))
      throw new Error('Missing F83 test settings');
    await mkdir(output);
    const save = (name: string, value: unknown) =>
      writeFile(join(output, `${name}.json`), JSON.stringify(value, null, 2) + '\n', {
        flag: 'wx',
      });

    const receipts: { label: string; total: number }[] = [];
    const counts = new Map<string, number>();
    const caps: Record<string, number> = {
      evidence: 1,
      memory: 1,
      mastery: 1,
      selection: 1,
      outline: 1,
      slide: 2,
      actions: 2,
    };
    let calls = 0;
    let halted = false;
    const modelFor = (stage: string) =>
      createOpenAI({
        apiKey: key || 'fixture',
        baseURL: 'https://api.deepseek.com/v1',
        fetch: async (url, init) => {
          if (!live || halted || String(url) !== endpoint) throw new Error('F83 provider blocked');
          const request = JSON.parse(String(init?.body));
          const system = String(
            request.messages?.find((entry: { role: string }) => entry.role === 'system')?.content,
          );
          const allMessages = JSON.stringify(request.messages);
          const label =
            stage === 'quiz-evidence'
              ? system.includes('评估新 Evidence 对一个课级目标')
                ? 'mastery'
                : system.includes('# Dialogue兼容')
                  ? 'memory'
                  : 'evidence'
              : stage === 'scene-outlines-stream'
                ? allMessages.includes('## Learner Mastery')
                  ? 'outline'
                  : 'selection'
                : stage === 'scene-content:slide'
                  ? 'slide'
                  : 'actions';
          if (
            request.model !== modelId ||
            calls >= (continuation ? 4 : 9) ||
            (continuation && !['selection', 'outline', 'slide', 'actions'].includes(label)) ||
            (counts.get(label) ?? 0) >= (continuation ? 1 : caps[label])
          )
            throw new Error('F83 provider cap');
          const { max_completion_tokens, max_tokens, ...rest } = request;
          const body = {
            ...rest,
            thinking: { type: 'disabled' },
            max_tokens: Math.min(max_completion_tokens ?? max_tokens ?? 4096, 4096),
            ...(request.stream ? { stream_options: { include_usage: true } } : {}),
          };
          const payload = JSON.stringify(body);
          if (Buffer.byteLength(payload) > 128 * 1024) throw new Error('F83 request too large');
          const id = `${String(++calls).padStart(2, '0')}-${label}`;
          counts.set(label, (counts.get(label) ?? 0) + 1);
          await save(`${id}.request`, body);
          try {
            const response = await fetch(endpoint, {
              ...init,
              body: payload,
              redirect: 'error',
              signal: AbortSignal.any([
                AbortSignal.timeout(120_000),
                ...(init?.signal ? [init.signal] : []),
              ]),
            });
            if (!response.ok) {
              await save(`${id}.http-error`, { status: response.status });
              throw new Error('F83 provider returned HTTP error');
            }
            const raw = await response.clone().text();
            const records = request.stream
              ? raw
                  .split(/\r?\n/)
                  .filter((line) => line.startsWith('data: {'))
                  .map((line) => JSON.parse(line.slice(6)))
              : [JSON.parse(raw)];
            const usage = records.findLast((record) => record.usage)?.usage;
            await save(`${id}.response`, { usage, records });
            if (!Number.isFinite(usage?.total_tokens)) throw new Error('F83 usage unavailable');
            receipts.push({ label, total: usage.total_tokens });
            return response;
          } catch (error) {
            halted = true;
            throw error;
          }
        },
      }).chat(modelId);
    vi.spyOn(resolver, 'resolveModel').mockImplementation(async ({ stage }) => {
      if (
        !stage ||
        ![
          'quiz-evidence',
          'scene-outlines-stream',
          'scene-content:slide',
          'scene-actions',
        ].includes(stage)
      )
        throw new Error('F83 unexpected model route');
      return {
        model: modelFor(stage),
        modelInfo: {
          id: modelId,
          name: modelId,
          contextWindow: 131072,
          outputWindow: 8192,
          capabilities: {},
        },
        modelId,
        modelString: `deepseek:${modelId}`,
        providerId: 'deepseek',
        apiKey: key || 'fixture',
        serverManaged: true,
        thinkingConfig: { mode: 'disabled' },
      };
    });
    if (!live) {
      vi.spyOn(llm, 'callLLM').mockImplementation(async (request, source) => {
        let text: string;
        if (source === 'quiz-evidence') {
          text = JSON.stringify({
            facts: [
              { type: 'learning_performance', evidence: answer, refs: ['teacher', 'student'] },
            ],
          });
        } else if (source === 'f67-memory') {
          text = JSON.stringify({
            status: 'ready',
            sections: [],
            pieces: [],
            retired: [],
            decisions: [{ source: 'e1', action: 'not_adopt', pieceIds: [], reason: '单次作答' }],
          });
        } else if (source === 'mastery-maintenance') {
          const {
            evidence: [item],
          } = JSON.parse(String(request.prompt));
          text = JSON.stringify({
            assessments: [
              {
                evidenceRef: item.evidenceRef,
                coverage: 'partial',
                result: 'partial',
                assistance: 'independent',
                observation: '学生独立将 0.72 kg 换算为 720 g，未列式或求密度。',
              },
            ],
            candidateState: {
              summary: '学生独立换算了质量，未列式或求密度。',
              unverified: ['独立列式，计算密度并写出结果和单位。'],
              adoptedEvidenceRefs: [item.evidenceRef],
            },
          });
        } else throw new Error(`Unexpected preflight model step: ${source}`);
        return { text, finishReason: 'stop', response: { modelId } } as Awaited<
          ReturnType<typeof llm.callLLM>
        >;
      });
    }
    vi.stubGlobal('navigator', {
      locks: {
        request: async (
          _name: string,
          work: LockOptions | (() => Promise<unknown>),
          next?: () => Promise<unknown>,
        ) => (typeof work === 'function' ? work : next!)(),
      },
    });
    vi.stubEnv('OWNER_SINGLE_USER', 'false');
    vi.stubEnv('OPENMAIC_DIALOGUE_EVIDENCE_ENABLED', 'true');
    vi.stubEnv('OPENMAIC_DIALOGUE_EVIDENCE_BINDINGS_FILE', '');
    vi.stubEnv('OPENMAIC_AUTOMATIC_DIALOGUE_LOOP', 'true');
    vi.stubEnv('OPENMAIC_AUTOMATIC_MASTERY', 'true');
    const app = await getServerPersistenceProvider(appUrl);
    const memory = new Pool({
      connectionString: memoryUrl,
      options: '-c search_path=f67_simulated_memory',
    });
    const documents = await getOwnerScopedDocumentStore(owner);
    const workers: { stop: () => Promise<void> }[] = [];
    try {
      await memory.query('CREATE SCHEMA IF NOT EXISTS f67_simulated_memory');
      await ensureMemorySchema(memory);
      const environmentId = await initializeMemoryEnvironment(memory);
      vi.stubEnv(
        'OPENMAIC_SIMULATED_LEARNING_LOOP',
        JSON.stringify({
          sourceNature: 'synthetic',
          conditions: ['F83 synthetic fixture'],
          memoryEnvironmentId: environmentId,
        }),
      );
      const settings = { bindings: [], memoryEnvironmentId: environmentId };
      if (!continuation) {
        await new SimulatedMemoryEnvironment({
          withTransaction: nodePostgresTransaction(memory as unknown as ConnectableQueryable),
        }).initialize(student);
        const scope = simulatedScope(student);
        await memory.query(
          'UPDATE learner_memory_states SET snapshot=$3::jsonb WHERE namespace=$1 AND learner_key=$2',
          [scope.namespace, scope.learnerKey, JSON.stringify(emptySnapshot())],
        );
      }
      const mastery = new LearnerMastery(app, settings);
      const loop = new MasteryLearningLoop(app, settings);
      const fixed: Partial<RunStepServices> = {
        outline: async () => ({
          outlines: [outline],
          targetStatements: [statement],
          languageDirective: '用中文教学',
          courseTitle: outline.title,
          taskEngineMode: false,
        }),
        sceneContent: async (_owner, input) => ({
          content: { elements: [], remark: task },
          effectiveOutline: input.outline,
        }),
        sceneActions: async (_owner, input) => {
          const scene: Scene & { outlineId: string } = {
            id: `scene-${input.stageId}`,
            stageId: input.stageId,
            type: 'slide',
            title: input.outline.title,
            order: input.outline.order,
            outlineId: input.outline.id,
            content: {
              type: 'slide',
              canvas: {
                id: 'f83-canvas',
                viewportSize: 1000,
                viewportRatio: 0.5625,
                theme: {
                  backgroundColor: '#fff',
                  themeColors: ['#000'],
                  fontColor: '#000',
                  fontName: 'Inter',
                },
                elements: [],
              },
            },
            actions: [{ id: 'f83-discussion', type: 'discussion', topic: task, prompt: task }],
          };
          return { scene, previousSpeeches: [] };
        },
      };
      const generate = async (
        name: string,
        request: string,
        overrides: Partial<RunStepServices>,
      ) => {
        const run = await createGenerationRun(
          owner,
          {
            requirement: request,
            simulatedLearner: student,
            materialIds: [],
            interactive: false,
            taskEngine: false,
            agents: { mode: 'preset', agentIds: ['default-1'] },
            outlineReview: 'wait',
          },
          { maxActiveRunsPerOwner: 3, maxWaitingRunsPerOwner: 3 },
        );
        const drive = async () => {
          const claim = await claimNextGenerationRun('f83', {
            runId: run.id,
            leaseTtlMs: 300_000,
            maxTakeovers: 0,
          });
          if (!claim) throw new Error('Missing F83 generation claim');
          return executeGenerationRun(claim, {
            signal: AbortSignal.timeout(240_000),
            services: {
              ...defaultRunStepServices,
              research: async () => null,
              narrationTarget: async () => null,
              ...overrides,
            },
          });
        };
        const outcome = await drive();
        const planned = await readGenerationRun(run.id, owner);
        await save(`${name}.outline`, planned);
        expect(outcome).toBe('waiting');
        let editedOutlines;
        if (live && name === 'next') {
          const outlines = planned?.outline?.outlines ?? [];
          const selected = outlines.find((candidate) => {
            const text = [candidate.title, candidate.description, ...candidate.keyPoints].join(' ');
            return (
              candidate.type === 'slide' &&
              /独立|自行/.test(text) &&
              /列式|代入|公式/.test(text) &&
              /讨论|过程|提交/.test(text)
            );
          });
          if (!selected) throw new Error('F83 outline has no independent process exercise');
          editedOutlines = outlines.length > 1 ? [selected] : undefined;
          await save('next.confirm-selection', {
            selected: selected.id,
            originalCount: outlines.length,
          });
        }
        const url = `http://localhost/api/generation-runs/${run.id}/confirm-outline`;
        const confirmed = await confirm(
          new NextRequest(url, {
            method: 'POST',
            body: JSON.stringify({
              commandId: `f83-${name}`,
              outlineRevision: planned?.outline?.revision,
              outlines: editedOutlines,
            }),
            headers: {
              cookie: `anonymous_id=${identity}`,
              origin: 'http://localhost',
              'content-type': 'application/json',
            },
          }),
          { params: Promise.resolve({ id: run.id }) },
        );
        expect(confirmed.status, await confirmed.text()).toBe(200);
        const result = await drive();
        const completed = await readGenerationRun(run.id, owner);
        await save(`${name}.completed`, completed);
        expect(result).toBe('completed');
        const document = await documents.loadDocument(completed!.stageId!);
        await save(`${name}.classroom`, document);
        expect(document?.scenes).toHaveLength(1);
        if (!document) throw new Error('F83 classroom missing');
        return { run, document, completed };
      };
      const generateNext = async (locator: MasteryLocator) => {
        const updated = await mastery.read(locator);
        if (!updated) throw new Error('Missing F83 adopted Mastery');
        const { target } = updated;
        const profiles = await readPlannerMastery(owner, student);
        expect(profiles).toMatchObject([
          { target, summary: updated.state.summary, unverified: updated.state.unverified },
        ]);
        const next = await generate('next', requirement, {
          ...(live ? {} : fixed),
          outline: async (ownerId, input, context) => {
            await save('next.planner-input', {
              requirement: input.requirements.requirement,
              mastery: input.learnerMastery,
            });
            expect(input.learnerMastery).toEqual(profiles);
            return (live ? defaultRunStepServices.outline : fixed.outline!)(
              ownerId,
              input,
              context,
            );
          },
        });
        expect(next.completed?.outline?.masteryTargets).toEqual([
          { id: target.id, revision: target.revision },
        ]);
      };
      if (continuation) {
        const proof = JSON.parse(await readFile(proofPath!, 'utf8'));
        const locator: MasteryLocator = proof.locator;
        expect(locator.ownerId).toBe(owner);
        expect(proof.after?.target.statement).toBe(statement);
        expect(await mastery.read(locator)).toEqual(proof.after);
        expect(await loop.status(owner, locator.runId)).toEqual(proof.jobs);
        await save('mastery.reopened', proof);
        await generateNext(locator);
        expect(await mastery.read(locator)).toEqual(proof.after);
        expect(counts.get('outline')).toBe(1);
        expect(counts.get('slide')).toBe(1);
        return;
      }
      const first = await generate('prior', task, fixed);
      const [target] = first.completed!.outline!.targets!;
      expect(target).toMatchObject({ revision: 1, statement });
      const locator = {
        ownerId: owner,
        runId: first.run.id,
        targetId: target.id,
        targetRevision: target.revision,
      };
      expect(await mastery.read(locator)).toBeNull();
      expect(await readPlannerMastery(owner, student)).toEqual([]);
      workers.push((await startMasteryLearningLoop())!, (await startDialogueLearningLoop())!);
      const scene = first.document.scenes[0]!;
      const action = scene.actions?.find((candidate) => candidate.type === 'discussion');
      expect(action?.topic).toBe(task);
      const { stage } = first.document;
      const now = Date.now();
      const chat: ChatSession = {
        id: 'f83-new-attempt',
        type: 'discussion',
        title: task,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        messages: [message('teacher', 'assistant', task)],
        initialContext: {
          stageId: stage.id,
          stageTitle: stage.name,
          sceneId: scene.id,
          sceneTitle: scene.title,
        },
        learningRunId: first.run.id,
        config: { agentIds: ['default-1'] },
        toolCalls: [],
        pendingToolCalls: [],
      };
      const runtime = { store: dialogueLoopRuntime(app.runtimeStore, app), learnerKey: owner };
      await saveChatSessions(stage.id, [chat], runtime);
      const closed: ChatSession = {
        ...chat,
        messages: [...chat.messages, message('student', 'user', answer)],
        status: 'completed',
        updatedAt: now + 1,
        learningClosure: { id: 'f83-stop', source: 'manual_stop' },
      };
      await saveChatSessions(stage.id, [closed], runtime);
      const source = await readDialogueSource(app, owner, {
        stageId: stage.id,
        chatSessionId: chat.id,
      });
      await save('trace', source);
      expect(source.status).toBe('available');
      if (source.status !== 'available') throw new Error('Missing F83 source');
      expect(source.source.messages.map(({ text }) => text)).toEqual([task, answer]);
      const jobId = (
        await app.pool.query('SELECT id FROM dialogue_loop_jobs WHERE chat_session_id=$1', [
          chat.id,
        ])
      ).rows[0]?.id;
      expect(jobId).toBeTruthy();
      const dialogue = new DialogueLoopStore(app);
      await vi
        .waitFor(
          async () => {
            expect(await loop.status(owner, first.run.id)).toMatchObject([{ state: 'completed' }]);
          },
          { timeout: 85_000, interval: 500 },
        )
        .catch(async (error) => {
          await save('stopped', {
            mastery: await loop.status(owner, first.run.id),
            dialogue: await dialogue.read(owner, jobId),
          });
          throw error;
        });
      const job = await dialogue.read(owner, jobId);
      await save('dialogue-job', job);
      const evidence = await readDialogueEvidenceRun(app, owner, job.evidenceRunId!);
      await save('evidence', evidence);
      expect(evidence.state).toBe('completed');
      const updated = await mastery.read(locator);
      await save('mastery', {
        locator,
        before: null,
        after: updated,
        jobs: await loop.status(owner, first.run.id),
      });
      expect(
        updated?.state.observations.some(({ evidenceRef }) =>
          evidenceRef.startsWith(evidence.id + '/'),
        ),
      ).toBe(true);
      expect(updated?.state.unverified.length).toBeGreaterThan(0);
      await generateNext(locator);
      if (live)
        for (const label of ['evidence', 'mastery', 'outline', 'slide'])
          expect(counts.get(label), label).toBeGreaterThan(0);
      else expect(calls).toBe(0);
    } finally {
      await Promise.all(workers.map((worker) => worker.stop()));
      await save('usage', { calls, receipts, halted });
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      await stopAgentEventNotifyBus();
      await memory.end();
      await app.pool.end();
    }
  },
  360_000,
);
