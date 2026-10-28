import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  nodePostgresTransaction,
  type ConnectableQueryable,
} from '@openmaic/storage/server/reference';
import { evidenceFixture } from '../persistence/quiz-evidence-fixture';
import { ensureMemorySchema } from '@/lib/persistence/learner-memory-schema';
import { SimulatedMemoryEnvironment } from '@/lib/learner-memory/simulated-environment';
import {
  ensureShortFactsSchema,
  initializeMemoryEnvironment,
  QuizShortFactsService,
} from '@/lib/server/quiz-short-facts';
import { SHORT_FACTS_SYSTEM } from '@/lib/evidence/short-facts-system';
import {
  claimLearningLoop,
  checkpointLearningLoopEvidence,
  enqueueLearningLoop,
  ensureLearningLoopSchema,
  finishLearningLoop,
  markStaleLearningLoopsUnknown,
  retryUnstartedLearningLoop,
} from '@/lib/server/quiz-learning-loop/store';
import { processLearningLoop } from '@/lib/server/quiz-learning-loop/process';
import { createLearningLoopAdapter } from '@/lib/server/quiz-learning-loop/adapter';
import { requestFromStoredAttribution } from '@/lib/server/quiz-learning-loop/attribution';
import { enqueueReviewedQuiz } from '@/lib/server/quiz-learning-loop/enqueue-reviewed';
import {
  activateLearningLoop,
  discoverReviewedQuizzes,
} from '@/lib/server/quiz-learning-loop/discovery';
import { simulatedScope } from '@/lib/learner-memory/simulated-seeds';
import { retryEvidence } from '@/lib/server/quiz-learning-loop/retry-evidence';
import { retryMemory } from '@/lib/server/quiz-learning-loop/retry-memory';
import { retainLearningSceneBindings } from '@/lib/server/quiz-learning-loop/scene-bindings';
import { buildPreclassLearnerContext } from '@/lib/server/preclass-learner-context';

let f: Awaited<ReturnType<typeof evidenceFixture>>;
let service: QuizShortFactsService;
let memory: SimulatedMemoryEnvironment;
let environmentId: string;
beforeEach(async () => {
  f = await evidenceFixture(process.env.F68_TEST_DATABASE_URL);
  await f.db.query(
    'CREATE TABLE generation_runs(id text PRIMARY KEY,owner_id text,stage_id text,input jsonb)',
  );
  await f.db.query('CREATE TABLE generation_run_steps(run_id text,step_id text,output jsonb)');
  await f.db.query(
    `INSERT INTO generation_run_steps VALUES('run','scene:0:narration','{"scene":{"id":"scene"}}'::jsonb)`,
  );
  await f.db.query(
    `INSERT INTO generation_runs VALUES('run','learner','stage','{"simulatedLearner":"B"}'::jsonb)`,
  );
  await ensureShortFactsSchema(f.db);
  await ensureLearningLoopSchema(f.db);
  await ensureMemorySchema(f.db);
  service = new QuizShortFactsService(f.provider.withTransaction);
  memory = new SimulatedMemoryEnvironment(f.provider);
  await memory.initialize('B');
  environmentId = await f.provider.withTransaction(initializeMemoryEnvironment);
});
afterEach(async () => {
  await f.close();
});
const request = () => ({
  owner: 'learner',
  generationRunId: 'run',
  attemptId: f.source.attemptId,
  submissionId: 'submission',
  student: 'B' as const,
  conditions: ['代理已接触参考内容'],
  sourceNature: 'proxy' as const,
  memoryEnvironmentId: environmentId,
});

describe('short facts durable handoff', () => {
  it.skipIf(!process.env.F68_TEST_DATABASE_URL)(
    'serializes concurrent initialization in two independent processes',
    async () => {
      await f.db.query(
        'DROP TABLE quiz_learning_loop_jobs,quiz_learning_loop_preexisting_reviews,quiz_learning_loop_activation,quiz_learning_scene_bindings,f68_short_facts_runs',
      );
      const schema = (await f.db.query<{ name: string }>('SELECT current_schema() AS name')).rows[0]
        .name;
      const exec = promisify(execFile);
      const worker = () =>
        exec(process.execPath, ['tests/evidence/fixtures/claim-worker.mjs'], {
          cwd: process.cwd(),
          env: { ...process.env, F69_TEST_SCHEMA: schema, F69_WORKER_MODE: 'bootstrap' },
          timeout: 30000,
        });
      const results = await Promise.all([worker(), worker()]);
      expect(results.map((result) => JSON.parse(result.stdout).initialized)).toEqual([true, true]);
      expect(
        (
          await f.db.query(
            "SELECT to_regclass('quiz_learning_loop_jobs') IS NOT NULL AS jobs, to_regclass('f68_short_facts_runs') IS NOT NULL AS facts",
          )
        ).rows[0],
      ).toEqual({ jobs: true, facts: true });
    },
    40000,
  );
  it.skipIf(!process.env.F68_TEST_DATABASE_URL)(
    'two independent worker processes cannot claim one task twice',
    async () => {
      await enqueueLearningLoop(f.db, {
        owner: 'learner',
        submission: 'submission',
        attempt: f.source.attemptId,
        generationRun: 'run',
      });
      const schema = (await f.db.query<{ name: string }>('SELECT current_schema() AS name')).rows[0]
        .name;
      const exec = promisify(execFile);
      const worker = (id: string) =>
        exec(process.execPath, ['tests/evidence/fixtures/claim-worker.mjs'], {
          cwd: process.cwd(),
          env: { ...process.env, F69_TEST_SCHEMA: schema, F69_WORKER_ID: id },
          timeout: 30000,
        });
      const results = await Promise.all([worker('worker-one'), worker('worker-two')]);
      expect(results.map((result) => JSON.parse(result.stdout).claimed).sort()).toEqual([
        false,
        true,
      ]);
    },
    40000,
  );
  it.each([false, true])(
    'recovers a crash before Evidence checkpoint (prepared=%s)',
    async (prepared) => {
      const source = { ...request(), promptVersion: 'selection-v2' as const };
      await enqueueLearningLoop(f.db, {
        owner: source.owner,
        submission: source.submissionId,
        attempt: source.attemptId,
        generationRun: source.generationRunId,
        attribution: {
          student: source.student,
          sourceNature: source.sourceNature,
          conditions: source.conditions,
          memoryEnvironmentId: source.memoryEnvironmentId,
        },
      });
      const old = await f.provider.withTransaction((tx) => claimLearningLoop(tx, 'first'));
      if (prepared) await service.prepare(source);
      await markStaleLearningLoopsUnknown(f.db, new Date(Date.now() + 60_000));
      expect(await retryUnstartedLearningLoop(f.db, source.owner, source.attemptId, false)).toBe(
        false,
      );
      expect(await retryUnstartedLearningLoop(f.db, 'other', source.attemptId, true)).toBe(false);
      expect(await retryUnstartedLearningLoop(f.db, source.owner, source.attemptId, true)).toBe(
        true,
      );
      expect(await checkpointLearningLoopEvidence(f.db, old!, 'first', 'old')).toBe(false);
      const current = await f.provider.withTransaction((tx) => claimLearningLoop(tx, 'second'));
      let calls = 0;
      await processLearningLoop(
        f.db,
        current!,
        createLearningLoopAdapter({
          service,
          memory,
          resolveRequest: requestFromStoredAttribution,
          extract: async () => {
            calls++;
            return { text: '{"facts":[]}', finishReason: 'stop', model: 'fixture', usage: null };
          },
          updateMemory: async () => {
            throw new Error('empty evidence must not invoke Memory');
          },
        }),
      );
      expect(calls).toBe(1);
      expect((await f.db.query('SELECT state FROM quiz_learning_loop_jobs')).rows[0].state).toBe(
        'completed',
      );
      expect(
        (await f.db.query('SELECT count(*)::int AS n FROM f68_short_facts_runs')).rows[0].n,
      ).toBe(1);
    },
  );
  it('discovers and verifies a late submission after generation checkpoints are compacted', async () => {
    await f.db.query(
      `UPDATE generation_run_steps SET output=jsonb_set(output,'{scene,stageId}','"stage"'::jsonb) WHERE run_id='run'`,
    );
    await retainLearningSceneBindings(f.db, ['run']);
    await f.db.query("DELETE FROM generation_run_steps WHERE run_id='run'");
    const config = {
      sourceNature: 'proxy' as const,
      conditions: ['代理已查看参考答案'],
      memoryEnvironmentId: environmentId,
    };
    await activateLearningLoop(f.provider.withTransaction, config);
    const review = await f.service.beginReview('learner', f.source.attemptId, {
      operationId: 'review',
      submissionId: 'submission',
      language: 'en-US',
    });
    await f.service.finishReview('learner', review, {
      results: [
        {
          questionId: 'q',
          correct: true,
          status: 'correct',
          earned: 2,
          evaluation: { state: 'normal', method: 'exact-key' },
        },
      ],
      summary: {
        status: 'complete',
        usableEarned: 2,
        usablePossible: 2,
        quizPossible: 2,
        unusableQuestionCount: 0,
      },
    });
    expect(await discoverReviewedQuizzes(f.provider.withTransaction, config)).toBe(1);
    const job = await f.provider.withTransaction((tx) => claimLearningLoop(tx, 'claim'));
    const adapter = createLearningLoopAdapter({
      service,
      memory,
      resolveRequest: requestFromStoredAttribution,
      extract: async () => ({
        text: '{"facts":[]}',
        finishReason: 'stop',
        model: 'fixture',
        usage: null,
      }),
      updateMemory: async () => {
        throw new Error('empty evidence must not invoke Memory');
      },
    });
    await processLearningLoop(f.db, job!, adapter);
    expect((await f.db.query('SELECT state FROM quiz_learning_loop_jobs')).rows[0].state).toBe(
      'completed',
    );
    await expect(service.preview({ ...request(), student: 'A' })).rejects.toThrow(
      'SIMULATED_IDENTITY_MISMATCH',
    );
  });
  it('requires explicit confirmation to recover an unknown Memory call', async () => {
    const source = { ...request(), promptVersion: 'selection-v2' as const };
    const ref = Object.keys((await service.preview(source)).refs)[0];
    await enqueueLearningLoop(f.db, {
      owner: source.owner,
      submission: source.submissionId,
      attempt: source.attemptId,
      generationRun: source.generationRunId,
      attribution: {
        student: source.student,
        sourceNature: source.sourceNature,
        conditions: source.conditions,
        memoryEnvironmentId: source.memoryEnvironmentId,
      },
    });
    const job = await f.provider.withTransaction((tx) => claimLearningLoop(tx, 'first'));
    let started!: () => void,
      release!: () => void,
      calls = 0;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter = createLearningLoopAdapter({
      service,
      memory,
      resolveRequest: requestFromStoredAttribution,
      extract: async () => ({
        text: JSON.stringify({
          facts: [{ type: 'correct_performance', evidence: '选中正确选项A', refs: [ref] }],
        }),
        finishReason: 'stop',
        model: 'fixture',
        usage: null,
      }),
      updateMemory: async () => {
        calls++;
        if (calls === 1) {
          started();
          await wait;
        }
        return {
          text: JSON.stringify({
            status: 'ready',
            sections: [],
            pieces: [],
            retired: [],
            decisions: [{ source: 'e1', action: 'not_adopt', pieceIds: [], reason: '无需保存' }],
          }),
          finishReason: 'stop',
          model: 'fixture',
          origin: 'model' as const,
          usage: null,
        };
      },
    });
    const running = processLearningLoop(f.db, job!, adapter);
    await ready;
    await markStaleLearningLoopsUnknown(f.db, new Date(Date.now() + 60_000));
    expect(
      await retryMemory(f.db, service, memory, source.owner, source.attemptId, false),
    ).toBeNull();
    expect(await retryMemory(f.db, service, memory, source.owner, source.attemptId, true)).toBe(
      'queued',
    );
    release();
    await running;
    const retry = await f.provider.withTransaction((tx) => claimLearningLoop(tx, 'second'));
    await processLearningLoop(f.db, retry!, adapter);
    expect((await f.db.query('SELECT state FROM quiz_learning_loop_jobs')).rows[0].state).toBe(
      'completed',
    );
    expect(calls).toBe(2);
  });
  it('recovers Memory failure without extracting Evidence again', async () => {
    const source = { ...request(), promptVersion: 'selection-v2' as const };
    const ref = Object.keys((await service.preview(source)).refs)[0];
    await enqueueLearningLoop(f.db, {
      owner: source.owner,
      submission: source.submissionId,
      attempt: source.attemptId,
      generationRun: source.generationRunId,
      attribution: {
        student: source.student,
        sourceNature: source.sourceNature,
        conditions: source.conditions,
        memoryEnvironmentId: source.memoryEnvironmentId,
      },
    });
    const job = await f.provider.withTransaction((tx) => claimLearningLoop(tx, 'first'));
    let factCalls = 0,
      memoryCalls = 0;
    const adapter = createLearningLoopAdapter({
      service,
      memory,
      resolveRequest: requestFromStoredAttribution,
      extract: async () => {
        factCalls++;
        return {
          text: JSON.stringify({
            facts: [{ type: 'correct_performance', evidence: '选中正确选项A', refs: [ref] }],
          }),
          finishReason: 'stop',
          model: 'fixture',
          usage: null,
        };
      },
      updateMemory: async () => {
        memoryCalls++;
        return {
          text:
            memoryCalls === 1
              ? 'invalid'
              : JSON.stringify({
                  status: 'ready',
                  sections: [],
                  pieces: [],
                  retired: [],
                  decisions: [
                    { source: 'e1', action: 'not_adopt', pieceIds: [], reason: '无需保存' },
                  ],
                }),
          finishReason: 'stop',
          model: 'fixture',
          origin: 'model' as const,
          usage: null,
        };
      },
    });
    await processLearningLoop(f.db, job!, adapter);
    expect((await f.db.query('SELECT state FROM quiz_learning_loop_jobs')).rows[0].state).toBe(
      'failed',
    );
    expect(await retryMemory(f.db, service, memory, 'other', source.attemptId, false)).toBeNull();
    expect(await retryMemory(f.db, service, memory, source.owner, source.attemptId, false)).toBe(
      'queued',
    );
    const retry = await f.provider.withTransaction((tx) => claimLearningLoop(tx, 'second'));
    await processLearningLoop(f.db, retry!, adapter);
    expect((await f.db.query('SELECT state FROM quiz_learning_loop_jobs')).rows[0].state).toBe(
      'completed',
    );
    expect(factCalls).toBe(1);
    expect(memoryCalls).toBe(2);
  });
  it('requires an explicit decision before retrying an unknown Evidence call', async () => {
    const source = { ...request(), promptVersion: 'selection-v2' as const };
    await enqueueLearningLoop(f.db, {
      owner: source.owner,
      submission: source.submissionId,
      attempt: source.attemptId,
      generationRun: source.generationRunId,
      attribution: {
        student: source.student,
        sourceNature: source.sourceNature,
        conditions: source.conditions,
        memoryEnvironmentId: source.memoryEnvironmentId,
      },
    });
    const job = await f.provider.withTransaction((tx) => claimLearningLoop(tx, 'first'));
    let calls = 0;
    const adapter = createLearningLoopAdapter({
      service,
      memory,
      resolveRequest: requestFromStoredAttribution,
      extract: async () => {
        calls++;
        if (calls === 1) throw new Error('connection lost');
        return { text: '{"facts":[]}', finishReason: 'stop', model: 'fixture', usage: null };
      },
      updateMemory: async () => {
        throw new Error('empty evidence must not invoke Memory');
      },
    });
    await processLearningLoop(f.db, job!, adapter);
    expect((await f.db.query('SELECT state FROM quiz_learning_loop_jobs')).rows[0].state).toBe(
      'unknown',
    );
    expect(await retryEvidence(f.db, service, source.owner, source.attemptId, false)).toBe(false);
    expect(calls).toBe(1);
    expect(await retryEvidence(f.db, service, source.owner, source.attemptId, true)).toBe(true);
    const retry = await f.provider.withTransaction((tx) => claimLearningLoop(tx, 'second'));
    await processLearningLoop(f.db, retry!, adapter);
    expect((await f.db.query('SELECT state FROM quiz_learning_loop_jobs')).rows[0].state).toBe(
      'completed',
    );
    expect(calls).toBe(2);
  });
  it('recovers a failed Evidence run without changing its source or repeating a completed call', async () => {
    const source = { ...request(), promptVersion: 'selection-v2' as const };
    await enqueueLearningLoop(f.db, {
      owner: source.owner,
      submission: source.submissionId,
      attempt: source.attemptId,
      generationRun: source.generationRunId,
      attribution: {
        student: source.student,
        sourceNature: source.sourceNature,
        conditions: source.conditions,
        memoryEnvironmentId: source.memoryEnvironmentId,
      },
    });
    const job = await f.provider.withTransaction((tx) => claimLearningLoop(tx, 'first'));
    let calls = 0;
    const adapter = createLearningLoopAdapter({
      service,
      memory,
      resolveRequest: requestFromStoredAttribution,
      extract: async () => {
        calls++;
        return {
          text: calls === 1 ? 'invalid' : '{"facts":[]}',
          finishReason: 'stop',
          model: 'fixture',
          usage: null,
        };
      },
      updateMemory: async () => {
        throw new Error('empty evidence must not invoke Memory');
      },
    });
    await processLearningLoop(f.db, job!, adapter);
    expect((await f.db.query('SELECT state FROM quiz_learning_loop_jobs')).rows[0].state).toBe(
      'failed',
    );
    expect(await retryEvidence(f.db, service, 'other', source.attemptId, false)).toBe(false);
    expect(await retryEvidence(f.db, service, source.owner, source.attemptId, false)).toBe(true);
    const retry = await f.provider.withTransaction((tx) => claimLearningLoop(tx, 'second'));
    await processLearningLoop(f.db, retry!, adapter);
    expect((await f.db.query('SELECT state FROM quiz_learning_loop_jobs')).rows[0].state).toBe(
      'completed',
    );
    expect(calls).toBe(2);
    expect(await retryEvidence(f.db, service, source.owner, source.attemptId, false)).toBe(false);
  });
  it('excludes old reviews at activation and rejects changing source configuration', async () => {
    const config = {
      sourceNature: 'proxy' as const,
      conditions: ['代理已查看参考答案'],
      memoryEnvironmentId: environmentId,
    };
    const review = await f.service.beginReview('learner', f.source.attemptId, {
      operationId: 'review',
      submissionId: 'submission',
      language: 'en-US',
    });
    await f.service.finishReview('learner', review, {
      results: [
        {
          questionId: 'q',
          correct: true,
          status: 'correct',
          earned: 2,
          evaluation: { state: 'normal', method: 'exact-key' },
        },
      ],
      summary: {
        status: 'complete',
        usableEarned: 2,
        usablePossible: 2,
        quizPossible: 2,
        unusableQuestionCount: 0,
      },
    });
    await activateLearningLoop(f.provider.withTransaction, config);
    expect(await discoverReviewedQuizzes(f.provider.withTransaction, config)).toBe(0);
    await expect(
      activateLearningLoop(f.provider.withTransaction, { ...config, sourceNature: 'synthetic' }),
    ).rejects.toThrow('LEARNING_LOOP_CONFIGURATION_CHANGED');
  });
  it('only enqueues an authorized simulated run after its review and trace are saved', async () => {
    const config = {
      sourceNature: 'proxy' as const,
      conditions: ['代理已查看参考答案'],
      memoryEnvironmentId: environmentId,
    };
    await activateLearningLoop(f.provider.withTransaction, config);
    expect(await discoverReviewedQuizzes(f.provider.withTransaction, config)).toBe(0);
    expect(
      await enqueueReviewedQuiz(f.provider.withTransaction, 'learner', f.source.attemptId, config),
    ).toBe('ineligible');
    expect(
      await enqueueReviewedQuiz(f.provider.withTransaction, 'other', f.source.attemptId, config),
    ).toBe('ineligible');
    const review = await f.service.beginReview('learner', f.source.attemptId, {
      operationId: 'review',
      submissionId: 'submission',
      language: 'en-US',
    });
    await f.service.finishReview('learner', review, {
      results: [
        {
          questionId: 'q',
          correct: true,
          status: 'correct',
          earned: 2,
          evaluation: { state: 'normal', method: 'exact-key' },
        },
      ],
      summary: {
        status: 'complete',
        usableEarned: 2,
        usablePossible: 2,
        quizPossible: 2,
        unusableQuestionCount: 0,
      },
    });
    expect(await discoverReviewedQuizzes(f.provider.withTransaction, config)).toBe(1);
    expect(
      await enqueueReviewedQuiz(f.provider.withTransaction, 'learner', f.source.attemptId, config),
    ).toBe('queued');
    const rows = (await f.db.query('SELECT attribution FROM quiz_learning_loop_jobs')).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].attribution).toEqual({ ...config, student: 'B' });
  });
  it('uses the existing Evidence and Memory services in the claimed pipeline', async () => {
    const source = { ...request(), promptVersion: 'selection-v2' as const };
    const preview = await service.preview(source);
    const ref = Object.keys(preview.refs)[0];
    const config = {
      sourceNature: source.sourceNature,
      conditions: source.conditions,
      memoryEnvironmentId: source.memoryEnvironmentId,
    };
    await activateLearningLoop(f.provider.withTransaction, config);
    const review = await f.service.beginReview('learner', source.attemptId, {
      operationId: 'review',
      submissionId: 'submission',
      language: 'en-US',
    });
    await f.service.finishReview('learner', review, {
      results: [
        {
          questionId: 'q',
          correct: true,
          status: 'correct',
          earned: 2,
          evaluation: { state: 'normal', method: 'exact-key' },
        },
      ],
      summary: {
        status: 'complete',
        usableEarned: 2,
        usablePossible: 2,
        quizPossible: 2,
        unusableQuestionCount: 0,
      },
    });
    expect(await discoverReviewedQuizzes(f.provider.withTransaction, config)).toBe(1);
    await expect(
      enqueueLearningLoop(f.db, {
        owner: source.owner,
        submission: source.submissionId,
        attempt: source.attemptId,
        generationRun: source.generationRunId,
        attribution: {
          student: source.student,
          sourceNature: 'synthetic',
          conditions: source.conditions,
          memoryEnvironmentId: source.memoryEnvironmentId,
        },
      }),
    ).rejects.toThrow('LEARNING_LOOP_BINDING_CONFLICT');
    const job = await f.provider.withTransaction((tx) => claimLearningLoop(tx, 'claim'));
    const adapter = createLearningLoopAdapter({
      service,
      memory,
      resolveRequest: requestFromStoredAttribution,
      extract: async (system) => {
        expect(system).toContain('除非作答明确写出计算过程');
        return {
          text: JSON.stringify({
            facts: [{ type: 'correct_performance', evidence: '选中正确选项A', refs: [ref] }],
          }),
          finishReason: 'stop',
          model: 'fixture',
          usage: null,
        };
      },
      updateMemory: async () => ({
        text: JSON.stringify({
          status: 'ready',
          sections: [],
          pieces: [],
          retired: [],
          decisions: [{ source: 'e1', action: 'not_adopt', pieceIds: [], reason: '无需保存' }],
        }),
        finishReason: 'stop',
        model: 'fixture',
        origin: 'model',
        usage: null,
      }),
    });
    await processLearningLoop(f.db, job!, adapter);
    const row = (await f.db.query('SELECT state,evidence_run_id FROM quiz_learning_loop_jobs'))
      .rows[0];
    expect(row.state).toBe('completed');
    expect((await service.read(source.owner, String(row.evidence_run_id))).state).toBe('completed');
    const stored = await memory.store.getRun(simulatedScope('B'), `f68:${row.evidence_run_id}`);
    expect(stored.decisions?.[0].action).toBe('not_adopt');
    const updated = await memory.read('B');
    const next = await buildPreclassLearnerContext(
      { student: 'B', task: '密度单位换算', content: {} },
      {
        read: async () => memory.read('B'),
        select: async () =>
          JSON.stringify({ selected: [{ pieceId: 'm-density', reason: '本次任务涉及密度换算' }] }),
      },
    );
    expect(next.memoryRevision).toBe(updated.usable.revision);
    expect(next.selected[0].pieceId).toBe('m-density');
  });
  it.each([
    ['completed', 'completed', [], 'completed', null],
    ['completed', 'completed', [{ action: 'not_adopt' }], 'completed', null],
    ['completed', 'completed', [{ action: 'defer' }], 'failed', 'MEMORY_DEFERRED'],
    ['completed', 'calling', [], 'unknown', 'MEMORY_CALL_UNKNOWN'],
    ['calling', 'completed', [], 'unknown', 'EVIDENCE_CALL_UNKNOWN'],
  ])(
    'records evidence and memory outcomes independently (%s, %s)',
    async (evidenceState, memoryState, decisions, expectedState, errorCode) => {
      await enqueueLearningLoop(f.db, {
        owner: 'learner',
        submission: 'submission',
        attempt: f.source.attemptId,
        generationRun: 'run',
      });
      const job = await f.provider.withTransaction((tx) => claimLearningLoop(tx, 'claim'));
      expect(job).not.toBeNull();
      let memoryCalls = 0;
      await processLearningLoop(f.db, job!, {
        prepare: async () => ({ id: 'evidence-id', state: 'prepared' }),
        extract: async () => ({ id: 'evidence-id', state: evidenceState }),
        handoff: async () => {
          memoryCalls++;
          return { state: memoryState, decisions };
        },
      });
      const stored = (
        await f.db.query('SELECT state,error_code,evidence_run_id FROM quiz_learning_loop_jobs')
      ).rows[0];
      expect(stored).toEqual({
        state: expectedState,
        error_code: errorCode,
        evidence_run_id: 'evidence-id',
      });
      expect(memoryCalls).toBe(evidenceState === 'completed' ? 1 : 0);
    },
  );
  it('deduplicates saved submissions and never automatically reclaims an unknown call', async () => {
    const item = {
      owner: 'learner',
      submission: 'submission',
      attempt: f.source.attemptId,
      generationRun: 'run',
    };
    await enqueueLearningLoop(f.db, item);
    await enqueueLearningLoop(f.db, item);
    await expect(enqueueLearningLoop(f.db, { ...item, generationRun: 'other' })).rejects.toThrow(
      'LEARNING_LOOP_BINDING_CONFLICT',
    );
    const [first, second] = await Promise.all([
      f.provider.withTransaction((tx) => claimLearningLoop(tx, 'worker-a')),
      f.provider.withTransaction((tx) => claimLearningLoop(tx, 'worker-b')),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    const claim = first ?? second!;
    expect(await checkpointLearningLoopEvidence(f.db, claim, claim.claim_id!, 'evidence-1')).toBe(
      true,
    );
    expect(await checkpointLearningLoopEvidence(f.db, claim, claim.claim_id!, 'different')).toBe(
      false,
    );
    await markStaleLearningLoopsUnknown(f.db, new Date(Date.now() + 60_000));
    expect(await f.provider.withTransaction((tx) => claimLearningLoop(tx, 'worker-c'))).toBeNull();
    expect(await finishLearningLoop(f.db, claim, claim.claim_id!, 'completed', null, null)).toBe(
      false,
    );
    expect((await f.db.query('SELECT state FROM quiz_learning_loop_jobs')).rows[0].state).toBe(
      'unknown',
    );
    expect(
      (await f.db.query('SELECT evidence_run_id FROM quiz_learning_loop_jobs')).rows[0]
        .evidence_run_id,
    ).toBe('evidence-1');
  });
  it('keeps frozen prompt and rejects a mismatched student or owner', async () => {
    expect(createHash('sha256').update(SHORT_FACTS_SYSTEM).digest('hex')).toBe(
      '9f7b97ce6ba2967be7ef670b527420d6a58095e8be0bff6ed58b3c33f9a45006',
    );
    await expect(service.prepare({ ...request(), student: 'A' })).rejects.toThrow(
      'SIMULATED_IDENTITY_MISMATCH',
    );
    await expect(service.prepare({ ...request(), owner: 'other' })).rejects.toThrow();
  });
  it('previews without writing an extraction run', async () => {
    const preview = await service.preview(request());
    expect(preview.source.submissionId).toBe('submission');
    expect((await f.db.query('SELECT id FROM f68_short_facts_runs')).rows).toHaveLength(0);
  });
  it('persists the selection-boundary prompt for new runs without changing the frozen baseline', async () => {
    const run = await service.prepare({ ...request(), promptVersion: 'selection-v2' });
    expect(run.system).toContain('除非作答明确写出计算过程');
    expect((await service.read('learner', run.id)).system).toBe(run.system);
    const extracted = await service.extract('learner', run.id, async (system) => {
      expect(system).toBe(run.system);
      return { text: '{"facts":[]}', finishReason: 'stop', model: 'test', usage: null };
    });
    expect(extracted.state).toBe('completed');
  });
  it.skipIf(!process.env.F68_TEST_DATABASE_URL)(
    'runs the actual CLI preview against PostgreSQL',
    async () => {
      const schema = (await f.db.query<{ schema: string }>('SELECT current_schema() AS schema'))
        .rows[0].schema;
      const url = new URL(process.env.F68_TEST_DATABASE_URL!);
      url.searchParams.set('options', `-c search_path=${schema}`);
      const file = join(tmpdir(), `f68-request-${randomUUID()}.json`);
      writeFileSync(file, JSON.stringify(request()), { flag: 'wx' });
      try {
        const output = execFileSync(
          process.execPath,
          ['eval/learner-memory/quiz-short-facts.mjs', 'preview', 'learner', file],
          {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: { ...process.env, DATABASE_URL: url.href },
            timeout: 30000,
          },
        );
        expect(JSON.parse(output).source.submissionId).toBe('submission');
        expect((await f.db.query('SELECT id FROM f68_short_facts_runs')).rows).toHaveLength(0);
      } finally {
        unlinkSync(file);
      }
    },
    40000,
  );
  it.skipIf(!process.env.F68_TEST_DATABASE_URL)(
    'preflights Trace and an independent Memory database without changes',
    async () => {
      const name = `f68_test_${randomUUID().replaceAll('-', '')}`;
      const admin = new Pool({ connectionString: process.env.F68_TEST_DATABASE_URL });
      const appSchema = (await f.db.query<{ schema: string }>('SELECT current_schema() AS schema'))
        .rows[0].schema;
      const appUrl = new URL(process.env.F68_TEST_DATABASE_URL!);
      appUrl.searchParams.set('options', `-c search_path=${appSchema}`);
      const memoryUrl = new URL(process.env.F68_TEST_DATABASE_URL!);
      memoryUrl.pathname = `/${name}`;
      const file = join(tmpdir(), `f68-request-${randomUUID()}.json`);
      const outputDir = join(tmpdir(), `f68-output-${randomUUID()}`);
      let pool: Pool | undefined;
      try {
        await admin.query(`CREATE DATABASE "${name}"`);
        pool = new Pool({ connectionString: memoryUrl.href });
        await pool.query('CREATE SCHEMA f67_simulated_memory');
        await pool.end();
        pool = new Pool({
          connectionString: memoryUrl.href,
          options: '-c search_path=f67_simulated_memory',
        });
        await ensureMemorySchema(pool);
        const env = new SimulatedMemoryEnvironment({
          withTransaction: nodePostgresTransaction(pool as unknown as ConnectableQueryable),
        });
        await env.initialize('B');
        const otherId = await env.provider.withTransaction(initializeMemoryEnvironment);
        const before = await env.read('B');
        const firstRun = await service.prepare(request());
        const ref = Object.keys(firstRun.context.refs)[0];
        await service.extract('learner', firstRun.id, async () => ({
          text: JSON.stringify({
            facts: [{ type: 'correct_performance', evidence: '选择A', refs: [ref] }],
          }),
          finishReason: 'stop',
          model: 'fixture',
          usage: null,
        }));
        await expect(
          service.handoff('learner', firstRun.id, env, async () => {
            throw Error('unexpected');
          }),
        ).rejects.toThrow('MEMORY_ENVIRONMENT_MISMATCH');
        await expect(service.interruptMemory('learner', firstRun.id, env)).rejects.toThrow(
          'MEMORY_ENVIRONMENT_MISMATCH',
        );
        const next = await f.service.prepare('learner', {
          operationId: 'retry',
          mode: 'retry',
          stageId: f.source.stageId,
          sceneId: f.source.sceneId,
          previousAttemptId: f.source.attemptId,
        });
        await f.service.submit('learner', next.attemptId, {
          operationId: 'submit-next',
          submissionId: 'submission-next',
          answers: { q: 'A' },
        });
        const empty = await service.prepare({
          ...request(),
          attemptId: next.attemptId,
          submissionId: 'submission-next',
        });
        await service.extract('learner', empty.id, async () => ({
          text: '{"facts":[]}',
          finishReason: 'stop',
          model: 'fixture',
          usage: null,
        }));
        await expect(
          service.handoff('learner', empty.id, env, async () => {
            throw Error('unexpected');
          }),
        ).rejects.toThrow('MEMORY_ENVIRONMENT_MISMATCH');
        const readOutput = execFileSync(
          process.execPath,
          ['eval/learner-memory/quiz-short-facts.mjs', 'memory', 'read', 'B'],
          {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: { ...process.env, MEMORY_DATABASE_URL: memoryUrl.href },
            timeout: 30000,
          },
        );
        expect(JSON.parse(readOutput).scope.learnerKey).toBe('sim-b');
        writeFileSync(file, JSON.stringify({ ...request(), memoryEnvironmentId: otherId }), {
          flag: 'wx',
        });
        const output = execFileSync(
          process.execPath,
          ['eval/learner-memory/quiz-short-facts.mjs', 'preflight', 'learner', file],
          {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: {
              ...process.env,
              DATABASE_URL: appUrl.href,
              MEMORY_DATABASE_URL: memoryUrl.href,
              F68_OUTPUT_DIR: outputDir,
            },
            timeout: 30000,
          },
        );
        const parsed = JSON.parse(output);
        expect(parsed.memory.scope.learnerKey).toBe('sim-b');
        expect(parsed.memory.pendingSources).toBe(0);
        expect(await env.read('B')).toEqual(before);
      } finally {
        if (pool) await pool.end();
        try {
          unlinkSync(file);
        } catch {
          /* file was not created */
        }
        await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
        await admin.end();
      }
    },
    40000,
  );
  it('saves a result, hands it to F67 and avoids repeating paid calls', async () => {
    const prepared = await service.prepare(request());
    const ref = Object.keys(prepared.context.refs)[0];
    let factCalls = 0,
      memoryCalls = 0;
    const result = await service.extract('learner', prepared.id, async () => {
      factCalls++;
      return {
        text: JSON.stringify({
          facts: [{ type: 'correct_performance', evidence: '选中正确选项A', refs: [ref] }],
        }),
        finishReason: 'stop',
        model: 'fixture',
        usage: null,
      };
    });
    expect(result.state).toBe('completed');
    const invoke = async () => {
      memoryCalls++;
      return {
        text: JSON.stringify({
          status: 'ready',
          sections: [
            { section: 'learning_experiences', pieceIds: ['m-past', 'm-density', 'new:1'] },
          ],
          pieces: [
            { id: 'new:1', text: '选中正确选项A', formation: 'synthesis', supports: ['e1'] },
          ],
          retired: [],
          decisions: [{ source: 'e1', action: 'adopt', pieceIds: ['new:1'], reason: '具体表现' }],
        }),
        finishReason: 'stop',
        model: 'fixture',
        origin: 'model' as const,
        usage: null,
      };
    };
    const first = await service.handoff('learner', prepared.id, memory, invoke);
    expect(first.sources).toHaveLength(1);
    expect(first.sources[0].sourceNature).toBe('proxy');
    expect(first.update?.run.state).toBe('completed');
    await service.extract('learner', prepared.id, async () => {
      throw Error('unexpected');
    });
    await service.handoff('learner', prepared.id, memory, invoke);
    expect(factCalls).toBe(1);
    expect(memoryCalls).toBe(1);
  });
  it('preserves a valid empty result without invoking Memory', async () => {
    const run = await service.prepare(request());
    const output = await service.extract('learner', run.id, async () => ({
      text: '{"facts":[]}',
      finishReason: 'stop',
      model: 'fixture',
      usage: null,
    }));
    expect(output.state).toBe('completed');
    const result = await service.handoff('learner', run.id, memory, async () => {
      throw Error('unexpected');
    });
    expect(result.sources).toEqual([]);
    expect(result.update).toBeNull();
  });
  it('does not retry an unknown call', async () => {
    const run = await service.prepare(request());
    const unknown = await service.extract('learner', run.id, async () => {
      throw Error('timeout');
    });
    expect(unknown.state).toBe('calling');
    expect(
      (
        await service.extract('learner', run.id, async () => {
          throw Error('unexpected');
        })
      ).state,
    ).toBe('calling');
    await expect(
      service.handoff('learner', run.id, memory, async () => {
        throw Error('unexpected');
      }),
    ).rejects.toThrow('SHORT_FACTS_NOT_COMPLETED');
    await expect(service.prepare({ ...request(), retryOf: run.id })).rejects.toThrow(
      'REANALYSIS_NOT_ALLOWED',
    );
    await service.interrupt('learner', run.id);
    const retry = await service.prepare({ ...request(), retryOf: run.id });
    expect(retry.id).not.toBe(run.id);
    expect((await service.read('learner', run.id)).state).toBe('interrupted');
  });
  it('does not expose or deliver a run after its source is removed', async () => {
    const run = await service.prepare(request());
    await service.extract('learner', run.id, async () => ({
      text: '{"facts":[]}',
      finishReason: 'stop',
      model: 'fixture',
      usage: null,
    }));
    await f.db.query("UPDATE stage_meta SET deleted_at=now() WHERE stage_id='stage'");
    await expect(service.read('learner', run.id)).rejects.toThrow();
    await expect(
      service.handoff('learner', run.id, memory, async () => {
        throw Error('unexpected');
      }),
    ).rejects.toThrow();
  });
  it('retains captured run-to-scene proof after checkpoints are compacted', async () => {
    const run = await service.prepare(request());
    expect(run.context.binding).toBe('checkpoint');
    await service.extract('learner', run.id, async () => ({
      text: '{"facts":[]}',
      finishReason: 'stop',
      model: 'fixture',
      usage: null,
    }));
    await f.db.query("DELETE FROM generation_run_steps WHERE run_id='run'");
    expect((await service.read('learner', run.id)).state).toBe('completed');
    expect(
      (
        await service.handoff('learner', run.id, memory, async () => {
          throw Error('unexpected');
        })
      ).update,
    ).toBeNull();
  });
  it('requires explicit operator attribution when old checkpoints are already gone', async () => {
    await f.db.query("DELETE FROM generation_run_steps WHERE run_id='run'");
    await expect(service.prepare(request())).rejects.toThrow('RUN_SCENE_PROOF_UNAVAILABLE');
    const run = await service.prepare({ ...request(), sceneBinding: 'operator-confirmed' });
    expect(run.context.binding).toBe('operator-confirmed');
    expect(Object.values(run.context.refs)[0].conditions).toContain(
      '模拟课堂与学生的归属由操作人员显式确认',
    );
  });
  it('keeps the old Memory if the update reply is invalid', async () => {
    const run = await service.prepare(request());
    const ref = Object.keys(run.context.refs)[0];
    await service.extract('learner', run.id, async () => ({
      text: JSON.stringify({
        facts: [{ type: 'correct_performance', evidence: '选择了A', refs: [ref] }],
      }),
      finishReason: 'stop',
      model: 'fixture',
      usage: null,
    }));
    const before = await memory.read('B');
    const result = await service.handoff('learner', run.id, memory, async () => ({
      text: 'invalid',
      finishReason: 'stop',
      model: 'fixture',
      origin: 'model',
      usage: null,
    }));
    expect(result.update?.run.state).toBe('failed');
    expect((await memory.read('B')).usable).toEqual(before.usable);
    const retried = await service.handoff(
      'learner',
      run.id,
      memory,
      async () => ({
        text: JSON.stringify({
          status: 'ready',
          sections: [],
          pieces: [],
          retired: [],
          decisions: [{ source: 'e1', action: 'not_adopt', pieceIds: [], reason: '内容不足' }],
        }),
        finishReason: 'stop',
        model: 'fixture',
        origin: 'model',
        usage: null,
      }),
      'retry-1',
    );
    expect(retried.update?.run.state).toBe('completed');
    expect((await service.read('learner', run.id)).state).toBe('completed');
  });
  it('rolls back all ingested sources if F67 cannot fit the full batch', async () => {
    const run = await service.prepare({ ...request(), conditions: ['X'.repeat(6000)] });
    const ref = Object.keys(run.context.refs)[0];
    const facts = Array.from({ length: 12 }, (_, i) => ({
      type: 'correct_performance',
      evidence: `选择A，表现${i}`,
      refs: [ref],
    }));
    await service.extract('learner', run.id, async () => ({
      text: JSON.stringify({ facts }),
      finishReason: 'stop',
      model: 'fixture',
      usage: null,
    }));
    await expect(
      service.handoff('learner', run.id, memory, async () => {
        throw Error('unexpected');
      }),
    ).rejects.toThrow();
    const pending = await f.db.query(
      'SELECT source_id FROM learner_memory_sources WHERE namespace=$1 AND learner_key=$2 AND processed=false',
      ['f67-test:simulated-memory-v1', 'sim-b'],
    );
    expect(pending.rows).toHaveLength(0);
  });
  it('allows an explicit retry of only deferred sources', async () => {
    const run = await service.prepare(request());
    const ref = Object.keys(run.context.refs)[0];
    const facts = ['选择了A', '未给出理由', '只提交了选项'].map((evidence) => ({
      type: 'correct_performance',
      evidence,
      refs: [ref],
    }));
    await service.extract('learner', run.id, async () => ({
      text: JSON.stringify({ facts }),
      finishReason: 'stop',
      model: 'fixture',
      usage: null,
    }));
    const first = await service.handoff('learner', run.id, memory, async () => ({
      text: JSON.stringify({
        status: 'ready',
        sections: [],
        pieces: [],
        retired: [],
        decisions: [
          { source: 'e1', action: 'not_adopt', pieceIds: [], reason: '价值不足' },
          { source: 'e2', action: 'defer', pieceIds: [], reason: '暂缓' },
          { source: 'e3', action: 'defer', pieceIds: [], reason: '暂缓' },
        ],
      }),
      finishReason: 'stop',
      model: 'fixture',
      origin: 'model',
      usage: null,
    }));
    expect(first.update?.run.state).toBe('completed');
    const recovered = await service.handoff(
      'learner',
      run.id,
      memory,
      async (memoryRun) => {
        expect(memoryRun.batch).toHaveLength(2);
        expect(memoryRun.batch[0].text).toBe('未给出理由');
        return {
          text: JSON.stringify({
            status: 'ready',
            sections: [],
            pieces: [],
            retired: [],
            decisions: [
              { source: 'e1', action: 'not_adopt', pieceIds: [], reason: '处理完成' },
              { source: 'e2', action: 'defer', pieceIds: [], reason: '仍暂缓' },
            ],
          }),
          finishReason: 'stop',
          model: 'fixture',
          origin: 'model',
          usage: null,
        };
      },
      'defer-1',
    );
    expect(recovered.update?.run.state).toBe('completed');
    const replay = await service.handoff(
      'learner',
      run.id,
      memory,
      async () => {
        throw Error('unexpected');
      },
      'defer-1',
    );
    expect(replay.update?.run.state).toBe('completed');
    const next = await service.handoff(
      'learner',
      run.id,
      memory,
      async (memoryRun) => {
        expect(memoryRun.batch).toHaveLength(1);
        expect(memoryRun.batch[0].text).toBe('只提交了选项');
        return {
          text: JSON.stringify({
            status: 'ready',
            sections: [],
            pieces: [],
            retired: [],
            decisions: [{ source: 'e1', action: 'not_adopt', pieceIds: [], reason: '处理完成' }],
          }),
          finishReason: 'stop',
          model: 'fixture',
          origin: 'model',
          usage: null,
        };
      },
      'defer-2',
    );
    expect(next.update?.run.state).toBe('completed');
  });
  it('recovers deferred sources after an earlier failed operation', async () => {
    const run = await service.prepare(request());
    const ref = Object.keys(run.context.refs)[0];
    const facts = ['选择A', '未写理由'].map((evidence) => ({
      type: 'correct_performance',
      evidence,
      refs: [ref],
    }));
    await service.extract('learner', run.id, async () => ({
      text: JSON.stringify({ facts }),
      finishReason: 'stop',
      model: 'fixture',
      usage: null,
    }));
    const first = await service.handoff('learner', run.id, memory, async () => ({
      text: 'bad',
      finishReason: 'stop',
      model: 'fixture',
      origin: 'model',
      usage: null,
    }));
    expect(first.update?.run.state).toBe('failed');
    const recovered = await service.handoff(
      'learner',
      run.id,
      memory,
      async () => ({
        text: JSON.stringify({
          status: 'ready',
          sections: [],
          pieces: [],
          retired: [],
          decisions: [
            { source: 'e1', action: 'not_adopt', pieceIds: [], reason: '不足' },
            { source: 'e2', action: 'defer', pieceIds: [], reason: '暂缓' },
          ],
        }),
        finishReason: 'stop',
        model: 'fixture',
        origin: 'model',
        usage: null,
      }),
      'recover-1',
    );
    expect(recovered.update?.run.state).toBe('completed');
    const next = await service.handoff(
      'learner',
      run.id,
      memory,
      async (memoryRun) => {
        expect(memoryRun.batch).toHaveLength(1);
        return {
          text: JSON.stringify({
            status: 'ready',
            sections: [],
            pieces: [],
            retired: [],
            decisions: [{ source: 'e1', action: 'not_adopt', pieceIds: [], reason: '处理完成' }],
          }),
          finishReason: 'stop',
          model: 'fixture',
          origin: 'model',
          usage: null,
        };
      },
      'recover-2',
    );
    expect(next.update?.run.state).toBe('completed');
  });
  it('rejects recovery when a deferred source was withdrawn', async () => {
    const run = await service.prepare(request());
    const ref = Object.keys(run.context.refs)[0];
    const facts = ['选择A', '未写理由'].map((evidence) => ({
      type: 'correct_performance',
      evidence,
      refs: [ref],
    }));
    await service.extract('learner', run.id, async () => ({
      text: JSON.stringify({ facts }),
      finishReason: 'stop',
      model: 'fixture',
      usage: null,
    }));
    const first = await service.handoff('learner', run.id, memory, async () => ({
      text: JSON.stringify({
        status: 'ready',
        sections: [],
        pieces: [],
        retired: [],
        decisions: [
          { source: 'e1', action: 'defer', pieceIds: [], reason: '暂缓' },
          { source: 'e2', action: 'defer', pieceIds: [], reason: '暂缓' },
        ],
      }),
      finishReason: 'stop',
      model: 'fixture',
      origin: 'model',
      usage: null,
    }));
    await memory.store.restrictSource(
      { namespace: 'f67-test:simulated-memory-v1', learnerKey: 'sim-b' },
      first.sources[0].id,
      '来源撤回',
    );
    await expect(
      service.handoff(
        'learner',
        run.id,
        memory,
        async () => {
          throw Error('unexpected');
        },
        'recover-1',
      ),
    ).rejects.toThrow('MEMORY_SOURCE_UNAVAILABLE');
  });
  it('explicitly abandons an unknown F67 call before recovery', async () => {
    const run = await service.prepare(request());
    const ref = Object.keys(run.context.refs)[0];
    await service.extract('learner', run.id, async () => ({
      text: JSON.stringify({
        facts: [{ type: 'correct_performance', evidence: '选择了A', refs: [ref] }],
      }),
      finishReason: 'stop',
      model: 'fixture',
      usage: null,
    }));
    let started!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = service.handoff('learner', run.id, memory, async () => {
      started();
      await waiting;
      return { text: '{}', finishReason: 'stop', model: 'fixture', origin: 'model', usage: null };
    });
    await ready;
    const stopped = await service.interruptMemory('learner', run.id, memory);
    expect(stopped.errorCode).toBe('INVOCATION_RESULT_UNKNOWN');
    release();
    await expect(first).rejects.toThrow();
    const recovered = await service.handoff(
      'learner',
      run.id,
      memory,
      async () => ({
        text: JSON.stringify({
          status: 'ready',
          sections: [],
          pieces: [],
          retired: [],
          decisions: [{ source: 'e1', action: 'not_adopt', pieceIds: [], reason: '处理完成' }],
        }),
        finishReason: 'stop',
        model: 'fixture',
        origin: 'model',
        usage: null,
      }),
      'retry-after-unknown',
    );
    expect(recovered.update?.run.state).toBe('completed');
  });
  it('does not abandon a captured F67 reply', async () => {
    const run = await service.prepare(request());
    const ref = Object.keys(run.context.refs)[0];
    await service.extract('learner', run.id, async () => ({
      text: JSON.stringify({
        facts: [{ type: 'correct_performance', evidence: '选择了A', refs: [ref] }],
      }),
      finishReason: 'stop',
      model: 'fixture',
      usage: null,
    }));
    let started!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reply = {
      text: JSON.stringify({
        status: 'ready',
        sections: [],
        pieces: [],
        retired: [],
        decisions: [{ source: 'e1', action: 'not_adopt', pieceIds: [], reason: '处理完成' }],
      }),
      finishReason: 'stop',
      model: 'fixture',
      origin: 'model' as const,
      usage: null,
    };
    const first = service.handoff('learner', run.id, memory, async () => {
      started();
      await waiting;
      return reply;
    });
    await ready;
    const scope = { namespace: 'f67-test:simulated-memory-v1', learnerKey: 'sim-b' };
    const calling = await memory.store.getRun(scope, `f68:${run.id}`);
    await memory.store.capture(scope, calling.id, reply, calling.claimToken);
    await expect(service.interruptMemory('learner', run.id, memory)).rejects.toThrow(
      'INTERRUPT_NOT_ALLOWED',
    );
    release();
    const completed = await first;
    expect(completed.update?.run.state).toBe('completed');
  });
});
