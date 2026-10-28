import { QuizShortFactsService, type FactsInvoker } from '@/lib/server/quiz-short-facts';
import type { MemoryInvoker } from '@/lib/server/learner-memory';
import type { SimulatedMemoryEnvironment } from '@/lib/learner-memory/simulated-environment';
import type { LearningLoopJob } from './store';
import type { LearningLoopProcessor } from './process';

type FactsRequest = Parameters<QuizShortFactsService['prepare']>[0];

/** The resolver must use trusted, durable test attribution; the job alone is insufficient. */
export function createLearningLoopAdapter(options: {
  service: QuizShortFactsService;
  memory: SimulatedMemoryEnvironment;
  resolveRequest: (job: LearningLoopJob) => Promise<FactsRequest>;
  extract: FactsInvoker;
  updateMemory: MemoryInvoker;
}): LearningLoopProcessor {
  return {
    async prepare(job) {
      const request = await options.resolveRequest(job);
      if (
        request.owner !== job.owner_id ||
        request.submissionId !== job.submission_id ||
        request.attemptId !== job.attempt_id ||
        request.generationRunId !== job.generation_run_id ||
        request.promptVersion !== 'selection-v2'
      )
        throw new Error('LEARNING_LOOP_BINDING_CONFLICT');
      await options.memory.provider.withTransaction(async (tx) => {
        const environment = await tx.query<{ id: string } & Record<string, unknown>>(
          'SELECT id FROM f68_memory_environment WHERE singleton=true',
        );
        if (environment.rows.length !== 1 || environment.rows[0].id !== request.memoryEnvironmentId)
          throw new Error('MEMORY_ENVIRONMENT_MISMATCH');
      });
      return options.service.prepare(request);
    },
    async extract(job, id) {
      return options.service.extract(job.owner_id, id, options.extract);
    },
    async handoff(job, id) {
      const result = await options.service.handoff(
        job.owner_id,
        id,
        options.memory,
        options.updateMemory,
        job.memory_recovery_id ?? undefined,
      );
      return result.update
        ? { state: result.update.run.state, decisions: result.update.run.decisions }
        : { state: 'empty' };
    },
  };
}
