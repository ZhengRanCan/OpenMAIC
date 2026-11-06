import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createOpenAI } from '@ai-sdk/openai';
import { ensureAssetSchema, PgAssetStore } from '@openmaic/storage/asset/pg';
import { PgAssetByteStore } from '@openmaic/storage/asset/pg-bytes';
import type { Queryable, WithTransaction } from '@openmaic/storage/document/pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDialogueSource } from '@/lib/persistence/dialogue-trace-read';
import { QuizTraceService } from '@/lib/persistence/quiz-trace';
import { ensureQuizTraceSchema } from '@/lib/persistence/quiz-trace-schema';
import { LearnerMastery } from '@/lib/server/learner-mastery';
import * as persistence from '@/lib/persistence/server-provider';
import * as dialogueSettings from '@/lib/server/dialogue-evidence-provenance';
import { executeGenerationRun } from '@/lib/server/generation/run/engine';
import { defaultRunStepServices } from '@/lib/server/generation/run/services';
import {
  claimNextGenerationRun,
  createGenerationRun,
  readGenerationRun,
  resetGenerationRunSchemaForTests,
} from '@/lib/server/generation/run/store';
import { generateOutlines } from '@/lib/server/generation/steps/outline';
import { ensureShortFactsSchema, QuizShortFactsService } from '@/lib/server/quiz-short-facts';
import type { Scene } from '@/lib/types/stage';
import { dialogueEvidenceFixture, model, reply } from './dialogue-evidence-fixture';

const url = process.env.PG_CONTRACT_URL;
const target = {
  id: 'run:target:1',
  revision: 1,
  statement: '给定以 kg 表示的质量和以 cm³ 表示的体积，独立写出换算、密度列式、结果和单位。',
};
const locator = { ownerId: 'owner', runId: 'run', targetId: target.id, targetRevision: 1 };
const unverified = ['独立完成 kg 到 g 的换算并列式求密度'];
type Fixture = Awaited<ReturnType<typeof dialogueEvidenceFixture>>;

function synthesis(assistance: 'assisted' | 'independent') {
  return vi.fn(async (_system: string, user: string) => {
    const { evidence } = JSON.parse(user);
    const evidenceRef = evidence[0].evidenceRef;
    const assisted = assistance === 'assisted';
    return JSON.stringify({
      assessments: [
        {
          evidenceRef,
          coverage: assisted ? 'partial' : 'direct',
          result: 'correct',
          assistance,
          observation: assisted
            ? '老师给出 480 g 后，学生算得 12 g/cm³。'
            : '学生独立换算 1.2 kg，列式并算得 3 g/cm³。',
        },
      ],
      candidateState: {
        summary: assisted
          ? '老师给出换算后算对。'
          : '先在老师给出换算后算对，后在新题中独立完成全过程。',
        unverified: assisted ? unverified : [],
        adoptedEvidenceRefs: [evidenceRef],
      },
    });
  });
}

describe.skipIf(!url)('F80 course target Mastery in PostgreSQL', () => {
  let f: Fixture;
  let service: LearnerMastery;
  beforeEach(async () => {
    if (process.env.F80_LIVE === '1') {
      const database = new URL(url!);
      if (database.hostname !== '127.0.0.1' || database.pathname !== '/f80_live')
        throw new Error('F80 live tests require a dedicated local database');
    }
    f = await dialogueEvidenceFixture(url!);
    await f.db.query("UPDATE generation_runs SET outline=$1, outline_revision=1 WHERE id='run'", [
      JSON.stringify({ outlines: [{ id: 'scene', type: 'slide' }], targets: [target] }),
    ]);
    service = new LearnerMastery(f.provider, f.settings);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetGenerationRunSchemaForTests();
    await f?.close();
  });

  async function saveEvidence(independent = false, question = false) {
    const chatSessionId = independent ? 'new-problem' : 'assisted-problem';
    const student = question
      ? '为什么先把千克换成克？'
      : independent
        ? '1.2 kg = 1200 g，ρ = 1200÷400 = 3 g/cm³。'
        : '480÷40=12 g/cm³。';
    await f.save({
      ...f.chat,
      id: chatSessionId,
      type: 'discussion',
      messages: [
        {
          id: 't',
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: independent
                ? '独立完成：质量 1.2 kg、体积 400 cm³，求密度。'
                : '质量已换算为 480 g，体积为 40 cm³，求密度。',
            },
          ],
        },
        { id: 's', role: 'user', parts: [{ type: 'text', text: student }] },
      ],
    });
    const source = await readDialogueSource(f.provider, 'owner', {
      stageId: 'stage',
      chatSessionId,
    });
    if (source.status !== 'available') throw new Error(source.status);
    f.settings.bindings.push({
      ...f.settings.bindings[0]!,
      chatSessionId,
      sourceDigest: source.source.contentDigest,
    });
    const run = await f.store.prepare(
      'owner',
      { ...f.request(), chatSessionId },
      f.settings,
      model,
    );
    const claim = await f.store.claim('owner', run.id, f.settings);
    if (!claim) throw new Error('Missing extraction claim');
    await f.store.capture(
      'owner',
      claim,
      {
        ...reply,
        text: JSON.stringify({
          facts: [
            {
              type: question ? 'question_help' : 'learning_performance',
              evidence: student,
              refs: ['t', 's'],
            },
          ],
        }),
      },
      f.settings,
    );
    const saved = await f.store.finalize('owner', run.id);
    expect(saved.state).toBe('completed');
    return saved.id;
  }

  it('skips empty inputs and retains assisted observations when independent work closes the gap', async () => {
    const assisted = synthesis('assisted');
    expect(await service.maintain(locator, [], assisted)).toBeNull();
    expect(assisted).not.toHaveBeenCalled();
    expect(await service.read(locator)).toBeNull();
    expect((await f.db.query('SELECT 1 FROM generation_target_mastery')).rowCount).toBe(0);

    const first = await saveEvidence();
    const before = await service.maintain(locator, [first], assisted);
    expect(before).toMatchObject({
      learnerId: 'simulated-A',
      target,
      state: { unverified, observations: [{ assistance: 'assisted' }] },
    });
    expect(await service.maintain(locator, [first, first], assisted)).toEqual(before);
    expect(assisted).toHaveBeenCalledTimes(1);

    const second = await saveEvidence(true);
    const independent = synthesis('independent');
    const after = await service.maintain(locator, [first, second], independent);
    expect(JSON.parse(independent.mock.calls[0]![1])).toMatchObject({
      previous: before?.state,
      evidence: [{ messages: [{ role: 'agent' }, { role: 'student' }] }],
    });
    expect(after?.state.unverified).toEqual([]);
    expect(after?.state.observations).toEqual([
      before?.state.observations[0],
      expect.objectContaining({ coverage: 'direct', assistance: 'independent' }),
    ]);
    expect(await new LearnerMastery(f.provider, f.settings).read(locator)).toEqual(after);
  });

  async function saveQuizEvidence() {
    await ensureAssetSchema(f.db);
    await f.db.query('CREATE TABLE document_scenes(stage_id TEXT,id TEXT,data JSONB)');
    await ensureQuizTraceSchema(f.db);
    await ensureShortFactsSchema(f.db);
    const assets = (tx: Queryable, withTransaction: WithTransaction) =>
      new PgAssetStore(tx, { withTransaction, byteStore: new PgAssetByteStore(f.db) });
    const trace = new QuizTraceService({
      ...f.provider,
      pool: f.db,
      runtimeStore: f.runtime,
      assetStore: assets(f.db, f.provider.withTransaction),
      assetStoreIn: (tx) => assets(tx, (body) => body(tx)),
    });
    const scene: Scene = {
      id: 'quiz-scene',
      stageId: 'stage',
      title: '密度小测',
      order: 1,
      type: 'quiz',
      content: {
        type: 'quiz',
        questions: [
          {
            id: 'density',
            type: 'single',
            question: '质量 0.42 kg，体积 70 cm³，密度是多少？',
            options: [
              { value: 'A', label: '6 g/cm³' },
              { value: 'B', label: '0.006 g/cm³' },
            ],
            answer: ['A'],
          },
        ],
      },
    };
    await f.db.query('INSERT INTO document_scenes VALUES($1,$2,$3::jsonb)', [
      'stage',
      scene.id,
      JSON.stringify(scene),
    ]);
    await f.db.query(
      'INSERT INTO generation_run_steps(run_id,step_id,output) VALUES($1,$2,$3::jsonb)',
      [
        'run',
        'scene:1:narration',
        JSON.stringify({ scene: { id: scene.id, stageId: scene.stageId } }),
      ],
    );
    const attempt = await trace.prepare('owner', {
      operationId: 'quiz-start',
      mode: 'start',
      stageId: 'stage',
      sceneId: scene.id,
      scene,
    });
    await trace.submit('owner', attempt.attemptId, {
      operationId: 'quiz-submit',
      submissionId: 'quiz-submission',
      answers: { density: 'B' },
    });
    const facts = new QuizShortFactsService(f.provider.withTransaction);
    const prepared = await facts.prepare({
      owner: 'owner',
      generationRunId: 'run',
      attemptId: attempt.attemptId,
      submissionId: 'quiz-submission',
      student: 'A',
      conditions: ['authored synthetic fixture'],
      sourceNature: 'synthetic',
      memoryEnvironmentId: f.settings.memoryEnvironmentId,
    });
    const quiz = await facts.extract('owner', prepared.id, async () => ({
      text: JSON.stringify({
        facts: [
          {
            type: 'error_performance',
            evidence: '学生选择 0.006 g/cm³，答案错误，未提交计算过程。',
            refs: Object.keys(prepared.context.refs),
          },
        ],
      }),
      finishReason: 'stop',
      model: 'synthetic-test',
      usage: null,
    }));
    expect(quiz.state).toBe('completed');
    return { kind: 'quiz', runId: quiz.id } as const;
  }

  it('uses verified Quiz short facts on the same target while preserving the process gap', async () => {
    const discussion = await saveEvidence();
    const before = await service.maintain(locator, [discussion], synthesis('assisted'));
    const source = await saveQuizEvidence();
    const generate = (assistance: 'independent' | 'unknown') =>
      vi.fn(async (system: string, user: string) => {
        const { evidence, previous } = JSON.parse(user);
        expect(system).toContain('仅凭选项至多判为 partial');
        expect(previous).toEqual(before?.state);
        expect(evidence).toMatchObject([
          {
            type: 'quiz_performance',
            questions: [{ type: 'single', submitted: 'B', answerKey: ['A'] }],
          },
        ]);
        const evidenceRef = evidence[0].evidenceRef;
        return JSON.stringify({
          assessments: [
            {
              evidenceRef,
              coverage: 'partial',
              result: 'incorrect',
              assistance,
              observation: '选错答案，具体过程未知。',
            },
          ],
          candidateState: {
            summary: '在教师给出换算值后算对，之后综合选择题选错，未提交过程。',
            unverified,
            adoptedEvidenceRefs: [evidenceRef],
          },
        });
      });
    await expect(service.maintain(locator, [source], generate('independent'))).rejects.toThrow(
      'MASTERY_INVALID_ASSESSMENT',
    );
    expect(await service.read(locator)).toEqual(before);
    const invoke = generate('unknown');
    const after = await service.maintain(locator, [discussion, source], invoke);
    expect(after?.state.unverified).toEqual(unverified);
    expect(after?.state.observations).toEqual([
      before?.state.observations[0],
      expect.objectContaining({
        evidenceRef: `quiz:${source.runId}/0`,
        coverage: 'partial',
        result: 'incorrect',
        assistance: 'unknown',
      }),
    ]);
    expect(await new LearnerMastery(f.provider, f.settings).read(locator)).toEqual(after);
    expect(await service.listForPlanner('owner', 'A')).toEqual([
      { target, summary: after?.state.summary, unverified },
    ]);
    expect(await service.listForPlanner('owner', 'B')).toEqual([]);
    expect(await service.listForPlanner('foreign', 'A')).toEqual([]);
    expect(await service.maintain(locator, [discussion, source, { ...source }], invoke)).toEqual(
      after,
    );
    expect(invoke).toHaveBeenCalledTimes(1);
    await f.db.query('DELETE FROM f68_short_facts_runs WHERE id=$1', [source.runId]);
    await expect(service.read(locator)).rejects.toThrow('SHORT_FACTS_NOT_FOUND');
    expect(await service.listForPlanner('owner', 'A')).toEqual([]);
  });

  it.skipIf(process.env.F80_LIVE !== '1')(
    'live model retains helped work and closes the gap after independent work',
    async () => {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      const output = process.env.F80_ARTIFACT_DIR;
      if (!apiKey || !output)
        throw new Error('F80 requires an artifact directory and DeepSeek credential');
      await mkdir(output);
      let calls = 0;
      const save = (file: string, value: unknown) =>
        writeFile(join(output, `${file}.json`), JSON.stringify(value, null, 2) + '\n', {
          flag: 'wx',
        });
      const runStep =
        (name: 'assisted' | 'independent') => async (system: string, user: string) => {
          const expected = name === 'assisted' ? 0 : 1;
          if (calls !== expected) throw new Error('F80 call limit');
          calls++;
          const request = {
            model: 'deepseek-v4-flash',
            thinking: { type: 'disabled' },
            max_tokens: 2048,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          };
          const body = JSON.stringify(request);
          expect(Buffer.byteLength(body)).toBeLessThanOrEqual(65536);
          await save(`${name}.request`, request);
          const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            body,
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
            redirect: 'error',
            signal: AbortSignal.timeout(120_000),
          });
          if (!response.ok) {
            await save(`${name}.error`, { status: response.status });
            throw new Error(`F80 DeepSeek HTTP ${response.status}`);
          }
          const result = await response.json();
          const choice = result.choices?.[0];
          const content = choice?.message?.content;
          await save(`${name}.response`, {
            content,
            model: result.model,
            usage: result.usage,
            finishReason: choice?.finish_reason,
          });
          expect(choice?.finish_reason).toBe('stop');
          expect(Number.isFinite(result.usage?.total_tokens)).toBe(true);
          if (typeof content !== 'string' || !content.trim())
            throw new Error('F80 empty model response');
          return content;
        };

      const first = await saveEvidence();
      const before = await service.maintain(locator, [first], runStep('assisted'));
      const reader = new LearnerMastery(f.provider, f.settings);
      const firstRead = await reader.read(locator);
      await save('assisted.mastery', firstRead);
      expect(firstRead).toEqual(before);
      expect(before?.state.observations).toMatchObject([
        { coverage: 'partial', result: 'correct', assistance: 'assisted' },
      ]);
      expect(before?.state.unverified.length).toBeGreaterThan(0);

      const second = await saveEvidence(true);
      const after = await service.maintain(locator, [first, second], runStep('independent'));
      const secondRead = await reader.read(locator);
      await save('independent.mastery', secondRead);
      expect(secondRead).toEqual(after);
      expect(after?.state.observations).toEqual([
        before?.state.observations[0],
        expect.objectContaining({
          coverage: 'direct',
          result: 'correct',
          assistance: 'independent',
        }),
      ]);
      expect(after?.state.unverified).toEqual([]);
      const duplicate = vi.fn(async () => {
        throw new Error('F80 duplicate call');
      });
      expect(await service.maintain(locator, [first, second], duplicate)).toEqual(after);
      expect(duplicate).not.toHaveBeenCalled();
      expect(calls).toBe(2);
    },
    260_000,
  );

  it('Quiz and next-class Planner use the persisted mastery state', async () => {
    const live = process.env.F80_LIVE === '1';
    const output = process.env.F80_ARTIFACT_DIR;
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (live) {
      if (!output || !apiKey) throw new Error('Missing F80 live configuration');
      await mkdir(output);
    }
    const save = async (file: string, value: unknown) => {
      if (live && output)
        await writeFile(join(output, `${file}.json`), JSON.stringify(value, null, 2) + '\n', {
          flag: 'wx',
        });
    };
    const endpoint = 'https://api.deepseek.com/v1/chat/completions';
    const modelId = 'deepseek-v4-flash';
    const attempted = new Set<string>();
    async function send(
      name: string,
      request: Record<string, unknown>,
      signal?: AbortSignal | null,
    ) {
      if (!live || !apiKey) throw new Error('F80 network not armed');
      if (attempted.has(name) || attempted.size >= 3) throw new Error('F80 call limit');
      attempted.add(name);
      const payload = {
        ...request,
        model: modelId,
        thinking: { type: 'disabled' },
        max_tokens: 2048,
      };
      const body = JSON.stringify(payload);
      expect(Buffer.byteLength(body)).toBeLessThanOrEqual(65536);
      await save(`${name}.request`, payload);
      const response = await fetch(endpoint, {
        method: 'POST',
        body,
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(120_000), ...(signal ? [signal] : [])]),
      });
      if (!response.ok) {
        await save(`${name}.error`, { status: response.status });
        throw new Error(`F80 DeepSeek HTTP ${response.status}`);
      }
      return response;
    }

    const discussion = await saveEvidence();
    const before = await service.maintain(locator, [discussion], synthesis('assisted'));
    const quiz = await saveQuizEvidence();
    const after = await service.maintain(locator, [discussion, quiz], async (system, user) => {
      if (!live) {
        const evidenceRef = JSON.parse(user).evidence[0].evidenceRef;
        return JSON.stringify({
          assessments: [
            {
              evidenceRef,
              coverage: 'partial',
              result: 'incorrect',
              assistance: 'unknown',
              observation: '选择了错误选项。',
            },
          ],
          candidateState: {
            summary: '受助算对，之后密度选择题选错。',
            unverified,
            adoptedEvidenceRefs: [evidenceRef],
          },
        });
      }
      const response = await send('quiz', {
        response_format: { type: 'json_object' },
        temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      const result = await response.json();
      await save('quiz.response', result);
      expect(result.choices?.[0]?.finish_reason).toBe('stop');
      expect(result.usage?.total_tokens).toBeGreaterThan(0);
      return result.choices[0].message.content;
    });
    await save('quiz.mastery', await service.read(locator));
    expect(after?.state.observations).toEqual([
      before?.state.observations[0],
      expect.objectContaining({ coverage: 'partial', result: 'incorrect', assistance: 'unknown' }),
    ]);
    expect(after?.state.unverified.join('')).toMatch(/换算/);
    expect(after?.state.unverified.join('')).toMatch(/列式/);

    vi.stubEnv('OPENMAIC_DIALOGUE_EVIDENCE_ENABLED', 'true');
    vi.stubEnv(
      'OPENMAIC_SIMULATED_LEARNING_LOOP',
      JSON.stringify({
        memoryEnvironmentId: f.settings.memoryEnvironmentId,
        sourceNature: 'synthetic',
        conditions: ['F80 synthetic'],
      }),
    );
    vi.spyOn(dialogueSettings, 'loadDialogueEvidenceSettings').mockResolvedValue(f.settings);
    vi.spyOn(persistence, 'getServerPersistenceProvider').mockResolvedValue({
      ...f.provider,
      pool: f.db,
      runtimeStore: f.runtime,
    } as persistence.ServerPersistenceProvider);
    const fingerprint = (data: unknown) =>
      createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const cases = [
      ['related', '生成三页中文密度接续课，练习如何用质量和体积求密度。'],
      ['unrelated', '生成三页中文浮沉课，题目直接给出物体与液体的密度，只比较密度并解释浮沉。'],
    ] as const;
    for (const [name, requirement] of cases) {
      let capture: Promise<void> | undefined;
      const provider = createOpenAI({
        apiKey,
        baseURL: 'https://api.deepseek.com/v1',
        fetch: async (url, init) => {
          if (String(url) !== endpoint) throw new Error('Unexpected F80 model endpoint');
          const response = await send(
            name,
            { ...JSON.parse(String(init?.body)), stream_options: { include_usage: true } },
            init?.signal,
          );
          capture = response
            .clone()
            .text()
            .then(async (stream) => {
              const events = stream
                .split(/\r?\n/)
                .filter((line) => line.startsWith('data: {'))
                .map((line) => JSON.parse(line.slice(6)));
              await save(`${name}.response`, events);
              expect(events.findLast((event) => event.usage)?.usage?.total_tokens).toBeGreaterThan(
                0,
              );
              expect(
                events.findLast((event) => event.choices?.[0]?.finish_reason)?.choices[0]
                  .finish_reason,
              ).toBe('stop');
            });
          void capture.catch(() => {});
          return response;
        },
      });
      const run = await createGenerationRun(
        'owner',
        {
          requirement,
          simulatedLearner: 'A',
          materialIds: [],
          interactive: false,
          taskEngine: false,
          agents: { mode: 'preset', agentIds: [] },
          outlineReview: 'wait',
        },
        { maxActiveRunsPerOwner: 3, maxWaitingRunsPerOwner: 3 },
      );
      const claim = await claimNextGenerationRun('f80-live', {
        runId: run.id,
        leaseTtlMs: 150_000,
        maxTakeovers: 0,
      });
      if (!claim) throw new Error('Missing F80 generation claim');
      const outcome = await executeGenerationRun(claim, {
        signal: AbortSignal.timeout(125_000),
        services: {
          ...defaultRunStepServices,
          learnerContext: async (_owner, input) => ({
            schemaVersion: 'learner-context.v1',
            promptVersion: 'learner-context-selection.v1',
            student: input.student,
            memoryRevision: 0,
            status: 'ready',
            selected: [],
            taskDigest: fingerprint(input.task),
            contentDigest: fingerprint({
              pdfText: input.content.pdfText ?? '',
              researchContext: input.content.researchContext ?? '',
            }),
          }),
          validateLearnerContext: async () => {},
          outline: async (_owner, input, ctx) => {
            expect(input.requirements.requirement).toBe(requirement);
            expect(input.learnerContext).toBeUndefined();
            expect(input.learnerMastery).toEqual([
              { target, summary: after?.state.summary, unverified: after?.state.unverified },
            ]);
            if (!live)
              return {
                outlines: [1, 2, 3].map((order) => ({
                  id: `o${order}`,
                  type: 'slide',
                  title: `页 ${order}`,
                  description: '内容',
                  keyPoints: ['说明'],
                  order,
                })),
                languageDirective: '使用中文',
                courseTitle: '受控测试',
                taskEngineMode: false,
              };
            return generateOutlines(
              {
                ...input,
                allowImageGeneration: false,
                allowVideoGeneration: false,
                model: {
                  model: provider.chat(modelId),
                  modelInfo: { id: modelId, name: modelId, outputWindow: 2048, capabilities: {} },
                  modelString: `deepseek:${modelId}`,
                  serverManaged: false,
                  thinkingConfig: undefined,
                },
              },
              { ...ctx, workspaceId: null, resolveVisionImages: async () => [] },
            );
          },
        },
      });
      await capture;
      expect(outcome).toBe('waiting');
      const stored = await readGenerationRun(run.id, 'owner');
      await save(`${name}.outline`, stored?.outline);
      expect(stored?.outline?.masteryTargets).toEqual([
        { id: target.id, revision: target.revision },
      ]);
      expect(stored?.outline?.outlines).toHaveLength(3);
    }
    expect(attempted.size).toBe(live ? 3 : 0);
  }, 390_000);

  it('fences concurrent invocation and retains an unknown outcome without redispatch', async () => {
    const run = await saveEvidence();
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const modelCall = vi.fn(async () => {
      started();
      await gate;
      throw new Error('provider unknown');
    });
    const first = service.maintain(locator, [run], modelCall);
    const expected = expect(first).rejects.toThrow('provider unknown');
    await entered;
    try {
      await expect(service.maintain(locator, [run], modelCall)).rejects.toThrow(
        'MASTERY_INVOCATION_PENDING_OR_UNKNOWN',
      );
    } finally {
      release();
      await expected;
    }
    await expect(service.maintain(locator, [run], modelCall)).rejects.toThrow(
      'MASTERY_INVOCATION_PENDING_OR_UNKNOWN',
    );
    expect(modelCall).toHaveBeenCalledTimes(1);
    expect(await service.read(locator)).toBeNull();
  });

  it('recovers a captured candidate after the final transaction fails', async () => {
    const run = await saveEvidence();
    let transactions = 0;
    const failing = new LearnerMastery(
      {
        withTransaction: (body) =>
          f.provider.withTransaction(async (tx) => {
            const transaction = ++transactions;
            const value = await body(tx);
            if (transaction === 3) throw new Error('final commit failed');
            return value;
          }),
      },
      f.settings,
    );
    const generate = synthesis('assisted');
    await expect(failing.maintain(locator, [run], generate)).rejects.toThrow('final commit failed');
    expect(await service.read(locator)).toBeNull();
    const second = await saveEvidence(true);
    const independent = synthesis('independent');
    expect(await service.maintain(locator, [run, second], independent)).toMatchObject({
      state: {
        unverified: [],
        observations: [{ assistance: 'assisted' }, { assistance: 'independent' }],
      },
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(independent).toHaveBeenCalledTimes(1);
  });

  it('refuses mismatched identity, revoked bindings, and untrusted model references', async () => {
    const run = await saveEvidence();
    const generate = synthesis('assisted');
    await expect(
      service.maintain({ ...locator, ownerId: 'other' }, [run], generate),
    ).rejects.toThrow('MASTERY_COURSE_UNAVAILABLE');
    const invalid = vi.fn(async () =>
      JSON.stringify({
        assessments: [
          {
            evidenceRef: 'invented',
            coverage: 'direct',
            result: 'correct',
            assistance: 'independent',
            observation: 'invented',
          },
        ],
        candidateState: null,
      }),
    );
    await expect(service.maintain(locator, [run], invalid)).rejects.toThrow(
      'MASTERY_INVALID_ASSESSMENT',
    );
    expect(await service.read(locator)).toBeNull();
    expect(await service.maintain(locator, [run], generate)).not.toBeNull();
    f.settings.bindings.pop();
    await expect(service.read(locator)).rejects.toThrow('MASTERY_SOURCE_UNAVAILABLE');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('keeps a relevant question as ungraded context with the target still unverified', async () => {
    const run = await saveEvidence(false, true);
    const context = (gaps: string[]) => async (_system: string, user: string) => {
      const evidenceRef = JSON.parse(user).evidence[0].evidenceRef;
      return JSON.stringify({
        assessments: [
          {
            evidenceRef,
            coverage: 'context',
            result: 'ungraded',
            assistance: 'unknown',
            observation: '学生询问为什么换算。',
          },
        ],
        candidateState: {
          summary: '只有求助。',
          unverified: gaps,
          adoptedEvidenceRefs: [evidenceRef],
        },
      });
    };
    await expect(service.maintain(locator, [run], context([]))).rejects.toThrow(
      'MASTERY_UNVERIFIED_REQUIRED',
    );
    expect(await service.maintain(locator, [run], context(unverified))).toMatchObject({
      state: {
        unverified,
        observations: [{ coverage: 'context', result: 'ungraded', assistance: 'unknown' }],
      },
    });
  });
});
