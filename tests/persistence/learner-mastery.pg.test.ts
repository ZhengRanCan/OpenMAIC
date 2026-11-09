import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createOpenAI } from '@ai-sdk/openai';
import { NextRequest } from 'next/server';
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
import { model, reply } from './dialogue-evidence-fixture';
import { dialogueLoopFixture } from './dialogue-learning-loop-fixture';
import { controlledMemoryReply, memoryModel } from './dialogue-memory-fixture';
import { readDialogueEvidenceRun } from '@/lib/persistence/dialogue-evidence-read';
import { processDialogueJob } from '@/lib/server/dialogue-learning-loop/process';
import { enqueueClosedDialogueIn } from '@/lib/server/dialogue-learning-loop/enqueue';
import { noteDialogueSessionCreatedIn } from '@/lib/server/dialogue-learning-loop/registration';
import { MasteryLearningLoop, startMasteryLearningLoop } from '@/lib/server/mastery-learning-loop';
import { enqueueReviewedQuiz } from '@/lib/server/quiz-learning-loop/enqueue-reviewed';
import { claimLearningLoop, ensureLearningLoopSchema } from '@/lib/server/quiz-learning-loop/store';
import { requestFromStoredAttribution } from '@/lib/server/quiz-learning-loop/attribution';
import { createLearningLoopAdapter } from '@/lib/server/quiz-learning-loop/adapter';
import { processLearningLoop } from '@/lib/server/quiz-learning-loop/process';
import * as ownerAuth from '@/lib/server/identity/with-owner';
import {
  GET as readMasteryJobs,
  POST as recoverMasteryJob,
} from '@/app/api/mastery-learning-loop/[runId]/route';
import * as modelResolver from '@/lib/server/resolve-model';
import * as llm from '@/lib/ai/llm';

const url = process.env.PG_CONTRACT_URL;
const target = {
  id: 'run:target:1',
  revision: 1,
  statement: '给定以 kg 表示的质量和以 cm³ 表示的体积，独立写出换算、密度列式、结果和单位。',
};
const locator = { ownerId: 'owner', runId: 'run', targetId: target.id, targetRevision: 1 };
const unverified = ['独立完成 kg 到 g 的换算并列式求密度'];
type Fixture = Awaited<ReturnType<typeof dialogueLoopFixture>>;

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
    f = await dialogueLoopFixture(url!);
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
    const chatSessionId = question ? 'question' : independent ? 'new-problem' : 'assisted-problem';
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
      { operationId: randomUUID(), stageId: 'stage', chatSessionId },
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

  async function saveQuizEvidence(automatic?: 'empty' | 'memory-fails') {
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
    const source = {
      owner: 'owner',
      generationRunId: 'run',
      attemptId: attempt.attemptId,
      submissionId: 'quiz-submission',
      student: 'A' as const,
      conditions: ['authored synthetic fixture'],
      sourceNature: 'synthetic' as const,
      memoryEnvironmentId: f.settings.memoryEnvironmentId,
    };
    const invoke = (refs: string[]) => ({
      text: JSON.stringify({
        facts:
          automatic === 'empty'
            ? []
            : [
                {
                  type: 'error_performance',
                  evidence: '学生选择 0.006 g/cm³，答案错误，未提交计算过程。',
                  refs,
                },
              ],
      }),
      finishReason: 'stop',
      model: 'synthetic-test',
      usage: null,
    });
    if (automatic) {
      await ensureLearningLoopSchema(f.db);
      const review = await trace.beginReview('owner', attempt.attemptId, {
        operationId: 'quiz-review',
        submissionId: source.submissionId,
        language: 'zh-CN',
      });
      await trace.finishReview('owner', review, {
        results: [
          {
            questionId: 'density',
            correct: false,
            status: 'incorrect',
            earned: 0,
            evaluation: { state: 'normal', method: 'exact-key' },
          },
        ],
        summary: {
          status: 'complete',
          usableEarned: 0,
          usablePossible: 1,
          quizPossible: 1,
          unusableQuestionCount: 0,
        },
      });
      expect(
        await enqueueReviewedQuiz(f.provider.withTransaction, 'owner', attempt.attemptId, f.config),
      ).toBe('queued');
      const job = await f.provider.withTransaction((tx) => claimLearningLoop(tx, 'quiz-claim'));
      const updateMemory = vi.fn(async () => {
        throw new Error('simulated Memory transport loss');
      });
      await processLearningLoop(
        f.db,
        job!,
        createLearningLoopAdapter({
          service: facts,
          memory: f.memory,
          resolveRequest: requestFromStoredAttribution,
          extract: async () =>
            invoke(
              Object.keys((await facts.preview({ ...source, promptVersion: 'selection-v2' })).refs),
            ),
          updateMemory,
        }),
      );
      const { rows } = await f.db.query(
        'SELECT state,evidence_run_id,error_code FROM quiz_learning_loop_jobs',
      );
      expect(rows[0]?.state, rows[0]?.error_code ?? undefined).toBe(
        automatic === 'empty' ? 'completed' : 'failed',
      );
      expect(updateMemory).toHaveBeenCalledTimes(automatic === 'empty' ? 0 : 1);
      expect(rows[0]?.evidence_run_id).toBeTruthy();
      return { kind: 'quiz', runId: rows[0].evidence_run_id as string } as const;
    }
    const prepared = await facts.prepare(source);
    const quiz = await facts.extract('owner', prepared.id, async () =>
      invoke(Object.keys(prepared.context.refs)),
    );
    expect(quiz.state).toBe('completed');
    return { kind: 'quiz', runId: quiz.id } as const;
  }

  async function saveAutomaticDialogue(id: string, empty = false, trusted = true) {
    const qa = id.startsWith('qa-');
    const chat = {
      ...f.chat,
      id,
      type: qa ? ('qa' as const) : ('discussion' as const),
      learningRunId: trusted ? 'run' : undefined,
      learningClosure: { id: 'close-auto', source: 'manual_stop' as const },
      messages: [
        {
          id: 't',
          role: 'assistant' as const,
          parts: [{ type: 'text' as const, text: '质量已换算为 480 g，体积 40 cm³，求密度。' }],
        },
        {
          id: 's',
          role: 'user' as const,
          parts: [{ type: 'text' as const, text: qa ? '为什么要换算成克？' : '480÷40=12 g/cm³。' }],
        },
      ],
    };
    await f.provider.withTransaction((tx) =>
      noteDialogueSessionCreatedIn(tx, 'owner', 'stage', id, f.config),
    );
    await f.save(chat);
    const job = (await f.provider.withTransaction((tx) =>
      enqueueClosedDialogueIn(tx, 'owner', { stageId: 'stage', chatSessionId: id }, f.config),
    ))!;
    if (!trusted) return job;
    const claimed = await f.jobs.claim();
    expect(claimed?.id).toBe(job.id);
    await processDialogueJob(claimed!, {
      jobs: f.jobs,
      evidence: f.store,
      memory: f.service,
      config: f.config,
      settings: async () => f.settings,
      evidenceModel: { ...model, promptVersion: job.evidencePromptVersion! },
      memoryModel,
      readEvidence: (owner, runId) => readDialogueEvidenceRun(f.provider, owner, runId),
      invokeEvidence: async () => ({
        ...reply,
        text: JSON.stringify({
          facts: empty
            ? []
            : [
                {
                  type: qa ? 'question_help' : 'learning_performance',
                  evidence: chat.messages[1]!.parts[0]!.text,
                  refs: ['t', 's'],
                },
              ],
        }),
      }),
      invokeMemory: async (run) => controlledMemoryReply(run),
      checkEvidence: () => {},
      checkMemory: () => {},
    });
    return f.jobs.read('owner', job.id);
  }

  const automatic = (withTransaction = f.provider.withTransaction) =>
    new MasteryLearningLoop({ pool: f.db, withTransaction }, f.settings);
  const ready = () =>
    f.db.query("UPDATE mastery_loop_jobs SET ready_at=now() WHERE state='queued'");
  const respond = async (_owner: string, _system: string, input: string) => {
    const {
      evidence: [item],
    } = JSON.parse(input);
    const quiz = item.type === 'quiz_performance';
    return JSON.stringify({
      assessments: [
        {
          evidenceRef: item.evidenceRef,
          coverage: 'partial',
          result: quiz ? 'incorrect' : 'correct',
          assistance: quiz ? 'unknown' : 'assisted',
          observation: quiz ? '选错答案，过程未知。' : '教师给出换算后，学生算得 12 g/cm³。',
        },
      ],
      candidateState: {
        summary: '记录本次作答，独立完成目标仍待验证。',
        unverified,
        adoptedEvidenceRefs: [item.evidenceRef],
      },
    });
  };

  it('F82 discovers completed sources from both automatic loops and serializes a target independently of Memory', async () => {
    const loop = automatic();
    await loop.activate();
    const dialogue = await saveAutomaticDialogue('discussion-auto');
    expect(dialogue.memoryState).toBe('completed');
    const quiz = await saveQuizEvidence('memory-fails');
    await Promise.all([loop.discover(), loop.discover()]);
    expect(await loop.status('other', 'run')).toEqual([]);
    expect(await loop.status('owner', 'run')).toHaveLength(2);
    let allow!: () => void;
    const pause = new Promise<void>((resolve) => {
      allow = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const replyOnce = vi.fn(async (owner: string, system: string, input: string) => {
      entered();
      await pause;
      return respond(owner, system, input);
    });
    const first = loop.processOne(replyOnce);
    await Promise.race([
      started,
      first.then(() => {
        throw new Error('Missing first model request');
      }),
    ]);
    const other = vi.fn(respond);
    try {
      await loop.processOne(other);
      expect(other).not.toHaveBeenCalled();
      expect(await loop.status('owner', 'run')).toContainEqual(
        expect.objectContaining({ state: 'queued', reason: 'TARGET_PENDING' }),
      );
    } finally {
      allow();
      await first;
    }
    await ready();
    await loop.processOne(other);
    expect(replyOnce).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
    expect(
      (await service.read(locator))?.state.observations.map((item) => item.evidenceRef),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining(dialogue.evidenceRunId!),
        `quiz:${quiz.runId}/0`,
      ]),
    );
    await loop.discover();
    expect(await loop.processOne(other)).toBe(false);
    expect((await f.jobs.read('owner', dialogue.id)).memoryState).toBe('completed');
    expect(
      (await f.db.query('SELECT state,error_code FROM quiz_learning_loop_jobs')).rows[0],
    ).toMatchObject({
      state: 'failed',
      error_code: 'MEMORY_NOT_COMPLETED',
    });
  });

  it('F82 distinguishes invalid replies, unknown calls and captured commit recovery', async () => {
    const loop = automatic();
    await loop.activate();
    await saveAutomaticDialogue('recover-auto');
    await loop.discover();
    const [job] = await loop.status('owner', 'run');
    await loop.processOne(async () => '{}');
    expect(await loop.status('owner', 'run')).toMatchObject([
      { state: 'failed', reason: 'MASTERY_REPLY_INVALID' },
    ]);
    expect(await loop.recover('other', 'run', job.id, 'retry')).toBe(false);
    expect(await loop.recover('owner', 'run', job.id, 'retry')).toBe(true);
    let transactions = 0;
    const faulty = automatic((body) =>
      f.provider.withTransaction(async (tx) => {
        const phase = ++transactions;
        const value = await body(tx);
        if (phase === 4) throw new Error('simulated final commit failure');
        return value;
      }),
    );
    await faulty.processOne(respond);
    expect(await loop.status('owner', 'run')).toMatchObject([
      { state: 'queued', reason: 'REPLY_CAPTURED' },
    ]);
    expect(await service.read(locator)).toBeNull();
    await ready();
    const mustNotCall = vi.fn(async () => {
      throw new Error('unexpected invocation');
    });
    await loop.processOne(mustNotCall);
    expect(mustNotCall).not.toHaveBeenCalled();
    expect(await service.read(locator)).not.toBeNull();

    const later = await saveAutomaticDialogue('qa-unknown-auto');
    await loop.discover();
    const lost = vi.fn(async () => {
      throw new Error('simulated model transport loss');
    });
    await loop.processOne(lost);
    const unknown = (await loop.status('owner', 'run')).find(
      (item) => item.source_id === later.evidenceRunId,
    )!;
    expect(unknown).toMatchObject({ state: 'unknown', reason: 'MODEL_RESULT_UNKNOWN' });
    expect(await loop.processOne(lost)).toBe(false);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(await loop.recover('owner', 'run', unknown.id, 'retry')).toBe(false);
    expect(await loop.recover('owner', 'run', unknown.id, 'reconcile')).toBe(false);
    await f.db.query(
      `INSERT INTO mastery_loop_jobs(id,owner_id,run_id,environment_id,target_id,target_revision,
         source_kind,source_id,state)
       SELECT 'history-'||n,owner_id,run_id,environment_id,target_id,target_revision,
         source_kind,'history-'||n,'completed'
       FROM mastery_loop_jobs CROSS JOIN generate_series(1, 100) AS n WHERE id=$1`,
      [unknown.id],
    );
    expect((await loop.status('owner', 'run'))[0]).toMatchObject({
      id: unknown.id,
      state: 'unknown',
    });
    expect(await loop.recover('owner', 'run', unknown.id, 'discard_unknown')).toBe(true);
    expect(
      (await f.db.query('SELECT state,reason FROM mastery_loop_jobs WHERE id=$1', [unknown.id]))
        .rows,
    ).toMatchObject([{ state: 'skipped', reason: 'UNKNOWN_DISCARDED' }]);
    expect((await f.jobs.read('owner', later.id)).memoryState).toBe('completed');
  });

  it.each(['valid', 'invalid'])(
    'F82 settles a late %s reply after claim takeover without resending',
    async (kind) => {
      const loop = automatic();
      await loop.activate();
      await saveAutomaticDialogue('late');
      await loop.discover();
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let release!: () => void;
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      const original = vi.fn(async (owner: string, system: string, input: string) => {
        entered();
        await wait;
        return kind === 'valid' ? respond(owner, system, input) : '{}';
      });
      let captured!: () => void;
      const capturing = new Promise<void>((resolve) => {
        captured = resolve;
      });
      let commit!: () => void;
      const captureGate = new Promise<void>((resolve) => {
        commit = resolve;
      });
      let phase = 0;
      const originalWorker = automatic((body) =>
        f.provider.withTransaction(async (tx) => {
          const current = ++phase;
          const value = await body(tx);
          if (kind === 'valid' && current === 3) {
            captured();
            await captureGate;
          }
          return value;
        }),
      );
      const first = originalWorker.processOne(original);
      await Promise.race([
        started,
        first.then(() => {
          throw new Error('Missing model request');
        }),
      ]);
      const noCall = vi.fn(respond);
      const [job] = await loop.status('owner', 'run');
      try {
        await f.db.query(
          "UPDATE mastery_loop_jobs SET claimed_at=now()-interval '11 minutes' WHERE id=$1",
          [job.id],
        );
        await loop.processOne(noCall);
        expect(await loop.status('owner', 'run')).toMatchObject([{ state: 'unknown' }]);
        if (kind === 'valid') {
          release();
          await Promise.race([
            capturing,
            first.then(() => {
              throw new Error('Missing captured reply');
            }),
          ]);
          let identify!: (pid: number) => void;
          const identified = new Promise<number>((resolve) => {
            identify = resolve;
          });
          const recovery = automatic((body) =>
            f.provider.withTransaction(async (tx) => {
              const { rows } = await tx.query('SELECT pg_backend_pid() AS pid');
              identify(rows[0].pid as number);
              return body(tx);
            }),
          );
          const discard = recovery.recover('owner', 'run', job.id, 'discard_unknown');
          const rejected = expect(discard).rejects.toThrow(
            /MASTERY_REPLY_CAPTURED|MASTERY_RECOVERY_CONFLICT/,
          );
          try {
            const pid = await identified;
            await vi.waitFor(async () => {
              const { rows } = await f.db.query(
                'SELECT cardinality(pg_blocking_pids($1)) AS blockers',
                [pid],
              );
              expect(rows[0].blockers).toBeGreaterThan(0);
            });
          } finally {
            commit();
            await rejected;
          }
        }
      } finally {
        release();
        commit();
        await first;
      }
      if (kind === 'valid') {
        expect(await service.read(locator)).toMatchObject({ state: { unverified } });
        expect(await loop.recover('owner', 'run', job.id, 'reconcile')).toBe(true);
        await loop.processOne(noCall);
        expect(await loop.status('owner', 'run')).toMatchObject([{ state: 'completed' }]);
      } else {
        expect(await service.read(locator)).toBeNull();
        expect(await loop.status('owner', 'run')).toMatchObject([
          { state: 'failed', reason: 'MASTERY_REPLY_INVALID' },
        ]);
        expect(await loop.recover('owner', 'run', job.id, 'reconcile')).toBe(false);
        expect(await loop.processOne(noCall)).toBe(false);
      }
      expect(original).toHaveBeenCalledTimes(1);
      expect(noCall).not.toHaveBeenCalled();
    },
  );

  it('F82 stops a worker that lost its claim after preparation and before dispatch', async () => {
    const loop = automatic();
    await loop.activate();
    await saveAutomaticDialogue('before-dispatch');
    await loop.discover();
    let persisted!: () => void;
    const prepared = new Promise<void>((resolve) => {
      persisted = resolve;
    });
    let release!: () => void;
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    let phase = 0;
    const worker = automatic(async (body) => {
      const current = ++phase;
      const value = await f.provider.withTransaction(body);
      if (current === 2) {
        persisted();
        await pause;
      }
      return value;
    });
    const generate = vi.fn(respond);
    const running = worker.processOne(generate);
    await Promise.race([
      prepared,
      running.then(() => {
        throw new Error('Missing prepared request');
      }),
    ]);
    try {
      await f.db.query("UPDATE mastery_loop_jobs SET claimed_at=now()-interval '11 minutes'");
      await loop.processOne(generate);
      const [job] = await loop.status('owner', 'run');
      expect(job.state).toBe('unknown');
      expect(await loop.recover('owner', 'run', job.id, 'discard_unknown')).toBe(true);
    } finally {
      release();
      await running;
    }
    expect(generate).not.toHaveBeenCalled();
    expect(await loop.status('owner', 'run')).toMatchObject([{ state: 'skipped' }]);
  });

  it('F82 requeues a stopped worker’s never-sent request even after claim takeover', async () => {
    const loop = automatic();
    await loop.activate();
    await saveAutomaticDialogue('stopping');
    await loop.discover();
    let aboutToClear!: () => void;
    const clearing = new Promise<void>((resolve) => {
      aboutToClear = resolve;
    });
    let release!: () => void;
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    let phase = 0;
    const worker = automatic(async (body) => {
      if (++phase === 3) {
        aboutToClear();
        await pause;
      }
      return f.provider.withTransaction(body);
    });
    const generate = vi.fn(respond);
    const active = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const running = worker.processOne(generate, active);
    await Promise.race([
      clearing,
      running.then(() => {
        throw new Error('Missing shutdown cleanup');
      }),
    ]);
    try {
      await f.db.query("UPDATE mastery_loop_jobs SET claimed_at=now()-interval '11 minutes'");
      await loop.processOne(generate);
      expect(await loop.status('owner', 'run')).toMatchObject([{ state: 'unknown' }]);
    } finally {
      release();
      await running;
    }
    expect(generate).not.toHaveBeenCalled();
    expect(await loop.status('owner', 'run')).toMatchObject([
      { state: 'queued', reason: 'MASTERY_DISABLED' },
    ]);
    await ready();
    await loop.processOne(generate);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await loop.status('owner', 'run')).toMatchObject([{ state: 'completed' }]);
  });

  it('F82 ignores old, empty and unattributed activities and stops before model calls on withdrawal', async () => {
    const loop = automatic();
    await saveAutomaticDialogue('historical');
    await loop.activate();
    await saveAutomaticDialogue('empty', true);
    await saveQuizEvidence('empty');
    expect((await saveAutomaticDialogue('unbound', false, false)).state).toBe('not_eligible');
    const valid = await saveAutomaticDialogue('valid');
    await f.db.query("UPDATE generation_runs SET outline=outline-'targets' WHERE id='run'");
    await loop.discover();
    expect(await loop.status('owner', 'run')).toEqual([]);
    await f.db.query(
      "UPDATE generation_runs SET outline=jsonb_set(outline,'{targets}',$1::jsonb) WHERE id='run'",
      [JSON.stringify([target])],
    );
    await loop.discover();
    expect(await loop.status('owner', 'run')).toMatchObject([{ source_id: valid.evidenceRunId }]);
    await f.store.delete('owner', valid.evidenceRunId!);
    const mustNotCall = vi.fn(async () => {
      throw new Error('unexpected invocation');
    });
    await loop.processOne(mustNotCall);
    expect(mustNotCall).not.toHaveBeenCalled();
    expect(await loop.status('owner', 'run')).toMatchObject([{ state: 'skipped' }]);
    expect(await service.read(locator)).toBeNull();
  });

  it('F82 lets the assessment reject unrelated targets without creating a Mastery state', async () => {
    const loop = automatic();
    const unrelated = {
      id: 'run:target:2',
      revision: 1,
      statement: '独立说明英语第三人称单数的规则。',
    };
    await f.db.query(
      "UPDATE generation_runs SET outline=jsonb_set(outline,'{targets}',$1::jsonb) WHERE id='run'",
      [JSON.stringify([target, unrelated])],
    );
    await loop.activate();
    const qa = await saveAutomaticDialogue('qa-context');
    expect(qa.memoryState).toBe('completed');
    await loop.discover();
    const judge = vi.fn(async (owner: string, system: string, input: string) => {
      expect(owner).toBe('owner');
      expect(system).toContain('unrelated');
      const data = JSON.parse(input);
      expect(data.evidence[0].type).toBe('question_help');
      const related = data.target.id === target.id;
      const evidenceRef = data.evidence[0].evidenceRef;
      return JSON.stringify({
        assessments: [
          {
            evidenceRef,
            coverage: related ? 'context' : 'unrelated',
            result: 'ungraded',
            assistance: 'unknown',
            observation: related ? '学生询问为何要换算成克。' : '求助与英语目标无关。',
          },
        ],
        candidateState: related
          ? {
              summary: '学生询问单位换算，实际能力待验证。',
              unverified,
              adoptedEvidenceRefs: [evidenceRef],
            }
          : null,
      });
    });
    await loop.processOne(judge);
    await loop.processOne(judge);
    expect(judge).toHaveBeenCalledTimes(2);
    expect((await service.read(locator))?.state.observations[0]).toMatchObject({
      coverage: 'context',
    });
    expect(await service.read({ ...locator, targetId: unrelated.id })).toBeNull();
    expect(await loop.status('owner', 'run')).toMatchObject([
      { state: 'completed' },
      { state: 'completed' },
    ]);
  });

  it('F82 exposes only owner-scoped status and same-origin recovery for an opted-in deployment', async () => {
    const loop = automatic();
    await loop.activate();
    await saveAutomaticDialogue('api');
    await loop.discover();
    await loop.processOne(async () => '{}');
    vi.spyOn(persistence, 'getServerPersistenceProvider').mockResolvedValue({
      ...f.provider,
      pool: f.db,
    } as Awaited<ReturnType<typeof persistence.getServerPersistenceProvider>>);
    let requestOwner = 'owner';
    vi.spyOn(ownerAuth, 'withRequestOwner').mockImplementation(async (_req, handle) =>
      handle(
        { ownerId: requestOwner, kind: 'user', roles: new Set(), assurance: 'verified' },
        new Headers(),
      ),
    );
    const url = 'http://localhost/api/mastery-learning-loop/run';
    const context = { params: Promise.resolve({ runId: 'run' }) };
    vi.stubEnv('OPENMAIC_AUTOMATIC_MASTERY', '');
    expect((await readMasteryJobs(new NextRequest(url), context)).status).toBe(404);
    vi.stubEnv('OPENMAIC_AUTOMATIC_MASTERY', 'true');
    vi.stubEnv('OPENMAIC_SIMULATED_LEARNING_LOOP', JSON.stringify(f.config));
    vi.stubEnv('OPENMAIC_DIALOGUE_EVIDENCE_ENABLED', 'false');
    const response = await readMasteryJobs(new NextRequest(url), context);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const {
      jobs: [job],
    } = await response.json();
    expect(job).toMatchObject({ state: 'failed', reason: 'MASTERY_REPLY_INVALID' });
    expect(job).not.toHaveProperty('claim_id');
    const recovery = (site: string) =>
      new NextRequest(`${url}?job=${job.id}&action=retry`, {
        method: 'POST',
        headers: { 'sec-fetch-site': site, 'content-type': 'application/json' },
      });
    expect((await recoverMasteryJob(recovery('cross-site'), context)).status).toBe(403);
    requestOwner = 'other';
    expect(await (await readMasteryJobs(new NextRequest(url), context)).json()).toEqual({
      jobs: [],
    });
    expect((await recoverMasteryJob(recovery('same-origin'), context)).status).toBe(409);
    requestOwner = 'owner';
    expect(await (await recoverMasteryJob(recovery('same-origin'), context)).json()).toMatchObject({
      jobs: [{ id: job.id, state: 'queued' }],
    });
  });

  it('F82 starts the installed worker and hands the eligible source to the server model adapter', async () => {
    const loop = automatic();
    await loop.activate();
    await saveAutomaticDialogue('worker');
    vi.spyOn(persistence, 'getServerPersistenceProvider').mockResolvedValue({
      ...f.provider,
      pool: f.db,
    } as Awaited<ReturnType<typeof persistence.getServerPersistenceProvider>>);
    vi.stubEnv('OPENMAIC_AUTOMATIC_MASTERY', 'true');
    vi.stubEnv('OPENMAIC_SIMULATED_LEARNING_LOOP', JSON.stringify(f.config));
    vi.stubEnv('OPENMAIC_DIALOGUE_EVIDENCE_ENABLED', 'true');
    vi.spyOn(dialogueSettings, 'loadDialogueEvidenceSettings').mockResolvedValue(f.settings);
    vi.spyOn(modelResolver, 'resolveModel').mockResolvedValue({
      model: createOpenAI({ apiKey: 'fixture' }).chat('fixture'),
      serverManaged: true,
    } as Awaited<ReturnType<typeof modelResolver.resolveModel>>);
    const generate = vi.spyOn(llm, 'callLLM').mockImplementation(
      async (request) =>
        ({
          text: await respond('owner', String(request.system), String(request.prompt)),
          finishReason: 'stop',
        }) as Awaited<ReturnType<typeof llm.callLLM>>,
    );
    const worker = await startMasteryLearningLoop();
    expect(worker).toBeDefined();
    try {
      await vi.waitFor(
        async () => {
          expect(await loop.status('owner', 'run')).toMatchObject([{ state: 'completed' }]);
        },
        { timeout: 4000 },
      );
      expect(await service.read(locator)).toMatchObject({ state: { unverified } });
      expect(generate).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ maxRetries: 0, maxOutputTokens: 4096 }),
        'mastery-maintenance',
        { retries: 0 },
        undefined,
        { enabled: false },
      );
    } finally {
      await worker?.stop();
    }
  });

  it('uses verified Quiz short facts on the same target while preserving the process gap', async () => {
    const discussion = await saveEvidence();
    const before = await service.maintain(locator, [discussion], synthesis('assisted'));
    const source = await saveQuizEvidence();
    const generate = (
      assistance: 'independent' | 'unknown',
      gaps = unverified,
      claimsFullCoverage = false,
    ) =>
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
              coverage: claimsFullCoverage ? 'direct' : 'partial',
              result: claimsFullCoverage ? 'correct' : 'incorrect',
              assistance,
              observation: '选错答案，具体过程未知。',
            },
          ],
          candidateState: {
            summary: '在教师给出换算值后算对，之后综合选择题选错，未提交过程。',
            unverified: gaps,
            adoptedEvidenceRefs: [evidenceRef],
          },
        });
      });
    await expect(service.maintain(locator, [source], generate('independent'))).rejects.toThrow(
      'MASTERY_INVALID_ASSESSMENT',
    );
    expect(await service.read(locator)).toEqual(before);
    await expect(service.maintain(locator, [source], generate('unknown', []))).rejects.toThrow(
      'MASTERY_UNVERIFIED_REQUIRED',
    );
    await expect(
      service.maintain(locator, [source], generate('unknown', [], true)),
    ).rejects.toThrow('MASTERY_UNVERIFIED_REQUIRED');
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

  it('rejects a context-only update that clears a previous gap', async () => {
    const first = await saveEvidence();
    const before = await service.maintain(locator, [first], synthesis('assisted'));
    const question = await saveEvidence(false, true);
    await expect(
      service.maintain(locator, [question], async (_system, user) => {
        const evidenceRef = JSON.parse(user).evidence[0].evidenceRef;
        return JSON.stringify({
          assessments: [
            {
              evidenceRef,
              coverage: 'context',
              result: 'ungraded',
              assistance: 'unknown',
              observation: '学生询问换算原因。',
            },
          ],
          candidateState: {
            summary: '学生已验证全部目标。',
            unverified: [],
            adoptedEvidenceRefs: [evidenceRef],
          },
        });
      }),
    ).rejects.toThrow('MASTERY_UNVERIFIED_REQUIRED');
    expect(await service.read(locator)).toEqual(before);
  });

  it('rejects a partial independent observation that clears every prior gap', async () => {
    const first = await saveEvidence();
    const before = await service.maintain(locator, [first], synthesis('assisted'));
    const second = await saveEvidence(true);
    const independent = synthesis('independent');
    await expect(
      service.maintain(locator, [second], async (system, user) => {
        const reply = JSON.parse(await independent(system, user));
        reply.assessments[0].coverage = 'partial';
        return JSON.stringify(reply);
      }),
    ).rejects.toThrow('MASTERY_UNVERIFIED_REQUIRED');
    expect(await service.read(locator)).toEqual(before);
  });
});
