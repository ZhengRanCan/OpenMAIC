import { expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { ServerPersistenceProvider } from '@/lib/persistence/server-provider';

const fixture = vi.hoisted(() => ({
  provider: null as ServerPersistenceProvider | null,
  memory: null as SimulatedMemoryEnvironment | null,
}));
vi.mock('@/lib/persistence/server-provider', async (original) => ({
  ...(await original<typeof import('@/lib/persistence/server-provider')>()),
  getServerPersistenceProvider: async () => fixture.provider!,
}));
vi.mock('@/lib/server/simulated-memory', async (original) => ({
  ...(await original<typeof import('@/lib/server/simulated-memory')>()),
  openSimulatedMemory: async () => ({ memory: fixture.memory!, close: async () => {} }),
}));

import { traceFixture, testScene } from '../persistence/quiz-trace-fixture';
import { ensureMemorySchema } from '@/lib/persistence/learner-memory-schema';
import { SimulatedMemoryEnvironment } from '@/lib/learner-memory/simulated-environment';
import { initializeMemoryEnvironment, QuizShortFactsService } from '@/lib/server/quiz-short-facts';
import { startQuizLearningLoop } from '@/lib/server/quiz-learning-loop/runner';

it.skipIf(process.env.F69_LIVE !== '1')(
  'automatically processes a saved simulated Quiz through real models',
  async () => {
    if (!process.env.F68_TEST_DATABASE_URL || !process.env.F69_ARTIFACT_DIR)
      throw new Error('TEST_CONFIGURATION_REQUIRED');
    const output = resolve(process.env.F69_ARTIFACT_DIR);
    mkdirSync(output, { recursive: false });
    const write = (name: string, value: unknown) =>
      writeFileSync(join(output, name), JSON.stringify(value, null, 2), { flag: 'wx' });
    const f = await traceFixture(process.env.F68_TEST_DATABASE_URL);
    let runner: ReturnType<typeof startQuizLearningLoop>;
    const previous = process.env.OPENMAIC_SIMULATED_LEARNING_LOOP;
    try {
      await f.db.query(
        'CREATE TABLE generation_runs(id text PRIMARY KEY,owner_id text,stage_id text,input jsonb)',
      );
      await f.db.query('CREATE TABLE generation_run_steps(run_id text,step_id text,output jsonb)');
      await f.db.query(
        `INSERT INTO generation_runs VALUES('run','learner','stage','{"simulatedLearner":"B"}'::jsonb)`,
      );
      await f.db.query(
        `INSERT INTO generation_run_steps VALUES('run','scene:0:narration','{"scene":{"id":"scene"}}'::jsonb)`,
      );
      await ensureMemorySchema(f.db);
      const memory = new SimulatedMemoryEnvironment(f.provider);
      await memory.initialize('B');
      const environmentId = await f.provider.withTransaction(initializeMemoryEnvironment);
      fixture.provider = f.provider;
      fixture.memory = memory;
      process.env.OPENMAIC_SIMULATED_LEARNING_LOOP = JSON.stringify({
        sourceNature: 'proxy',
        conditions: ['代理构造作答前已查看参考答案，不代表真实学生或独立学习过程'],
        memoryEnvironmentId: environmentId,
      });
      const before = await memory.read('B');
      runner = startQuizLearningLoop();
      expect(runner).toBeDefined();
      const deadline = Date.now() + 240000;
      while (Date.now() < deadline) {
        const ready = await f.db.query<{ name: string | null }>(
          "SELECT to_regclass('quiz_learning_loop_activation')::text AS name",
        );
        if (
          ready.rows[0].name &&
          (await f.db.query('SELECT 1 FROM quiz_learning_loop_activation')).rows.length
        )
          break;
        await new Promise((r) => setTimeout(r, 200));
      }
      const scene = structuredClone(testScene);
      if (scene.type !== 'quiz') throw new Error('BAD_TEST_SCENE');
      scene.content.questions[0].question =
        '已知 1 g/cm³=1000 kg/m³，将 2.7 g/cm³ 换算成 kg/m³，应选哪项？';
      scene.content.questions[0].options = [
        { value: 'A', label: '2.7 kg/m³' },
        { value: 'B', label: '2700 kg/m³' },
      ];
      scene.content.questions[0].answer = ['B'];
      const attempt = await f.service.prepare('learner', {
        operationId: 'start',
        mode: 'start',
        stageId: 'stage',
        sceneId: 'scene',
        scene,
      });
      await f.service.submit('learner', attempt.attemptId, {
        operationId: 'submit',
        submissionId: 'submission',
        answers: { q: 'A' },
      });
      const review = await f.service.beginReview('learner', attempt.attemptId, {
        operationId: 'review',
        submissionId: 'submission',
        language: 'zh-CN',
      });
      await f.service.finishReview('learner', review, {
        results: [
          {
            questionId: 'q',
            correct: false,
            status: 'incorrect',
            earned: 0,
            evaluation: { state: 'normal', method: 'exact-key' },
          },
        ],
        summary: {
          status: 'complete',
          usableEarned: 0,
          usablePossible: 2,
          quizPossible: 2,
          unusableQuestionCount: 0,
        },
      });
      let row: Record<string, unknown> | undefined;
      while (Date.now() < deadline) {
        row = (
          await f.db.query('SELECT state,evidence_run_id,error_code FROM quiz_learning_loop_jobs')
        ).rows[0];
        if (row && ['completed', 'failed', 'unknown'].includes(String(row.state))) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      write('before.json', before);
      write('job.json', row);
      expect(row?.state).toBe('completed');
      const service = new QuizShortFactsService(f.provider.withTransaction);
      const evidence = await service.read('learner', String(row?.evidence_run_id));
      write('evidence.json', evidence);
      write('after.json', await memory.read('B'));
      const runs = await f.db.query(
        'SELECT data FROM learner_memory_runs WHERE namespace=$1 AND learner_key=$2',
        ['f67-test:simulated-memory-v1', 'sim-b'],
      );
      write('memory-runs.json', runs.rows);
      expect(evidence.state).toBe('completed');
      expect(
        (await f.db.query('SELECT count(*)::int AS n FROM quiz_learning_loop_jobs')).rows[0].n,
      ).toBe(1);
    } finally {
      await runner?.stop();
      if (previous === undefined) delete process.env.OPENMAIC_SIMULATED_LEARNING_LOOP;
      else process.env.OPENMAIC_SIMULATED_LEARNING_LOOP = previous;
      fixture.provider = null;
      fixture.memory = null;
      await f.close();
    }
  },
  300000,
);
