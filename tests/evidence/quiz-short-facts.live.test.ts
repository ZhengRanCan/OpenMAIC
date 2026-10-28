import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { evidenceFixture } from '../persistence/quiz-evidence-fixture';
import { ensureMemorySchema } from '@/lib/persistence/learner-memory-schema';
import { SimulatedMemoryEnvironment } from '@/lib/learner-memory/simulated-environment';
import {
  ensureShortFactsSchema,
  initializeMemoryEnvironment,
  QuizShortFactsService,
} from '@/lib/server/quiz-short-facts';
import { resolveModel } from '@/lib/server/resolve-model';
import { callLLM } from '@/lib/ai/llm';
import { invokeSimulatedMemoryModel } from '@/lib/server/simulated-memory';

it.skipIf(process.env.F68_LIVE !== '1')(
  'extracts a newly saved simulated Trace and hands it to Memory',
  async () => {
    if (!process.env.F68_TEST_DATABASE_URL || !process.env.F68_ARTIFACT_DIR)
      throw new Error('TEST_CONFIGURATION_REQUIRED');
    const dir = path.resolve(process.env.F68_ARTIFACT_DIR);
    fs.mkdirSync(dir, { recursive: false });
    const write = (name: string, value: unknown) =>
      fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2), { flag: 'wx' });
    const f = await evidenceFixture(process.env.F68_TEST_DATABASE_URL);
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
      await ensureShortFactsSchema(f.db);
      await ensureMemorySchema(f.db);
      const memory = new SimulatedMemoryEnvironment(f.provider);
      await memory.initialize('B');
      const memoryEnvironmentId = await f.provider.withTransaction(initializeMemoryEnvironment);
      const before = await memory.read('B');
      const service = new QuizShortFactsService(f.provider.withTransaction);
      const run = await service.prepare({
        owner: 'learner',
        generationRunId: 'run',
        attemptId: f.source.attemptId,
        submissionId: 'submission',
        student: 'B',
        conditions: ['模拟作答，由测试程序构造，已接触参考答案，不代表真实学生'],
        sourceNature: 'synthetic',
        memoryEnvironmentId,
      });
      write('trace.json', f.source);
      write('before.json', before);
      write('prepared.json', run);
      const extracted = await service.extract('learner', run.id, async (system, prompt) => {
        const model = await resolveModel({
          stage: 'quiz-evidence',
          workspaceId: null,
          modelString: 'deepseek:deepseek-v4-flash',
        });
        const response = await callLLM(
          {
            model: model.model,
            system,
            prompt,
            maxOutputTokens: 16000,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(180000),
          },
          'quiz-evidence',
          { retries: 0 },
          model.thinkingConfig,
          { enabled: false, serverManaged: model.serverManaged },
        );
        return {
          text: response.text,
          finishReason: response.finishReason ?? 'unknown',
          model: response.response?.modelId ?? model.modelString,
          usage: response.totalUsage ?? response.usage ?? null,
        };
      });
      write('extraction.json', extracted);
      expect(extracted.state).toBe('completed');
      const handoff = await service.handoff('learner', run.id, memory, invokeSimulatedMemoryModel);
      write('handoff.json', handoff);
      write('after.json', await memory.read('B'));
      expect(
        handoff.update === null || ['completed', 'noop'].includes(handoff.update.run.state),
      ).toBe(true);
      const repeated = await service.handoff('learner', run.id, memory, async () => {
        throw Error('UNEXPECTED_REPEAT_CALL');
      });
      write('repeated.json', repeated);
      expect(repeated.sources).toEqual(handoff.sources);
    } finally {
      await f.close();
    }
  },
  420000,
);
