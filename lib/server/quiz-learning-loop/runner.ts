import { randomUUID } from 'node:crypto';
import type { ConnectableQueryable } from '@openmaic/storage/server/reference';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { withSchemaBootstrapLock } from '@/lib/persistence/schema-bootstrap-lock';
import {
  QuizShortFactsService,
  ensureShortFactsSchema,
  type FactsInvoker,
} from '@/lib/server/quiz-short-facts';
import { invokeSimulatedMemoryModel, openSimulatedMemory } from '@/lib/server/simulated-memory';
import { resolveModel } from '@/lib/server/resolve-model';
import { callLLM } from '@/lib/ai/llm';
import { createLearningLoopAdapter } from './adapter';
import { requestFromStoredAttribution } from './attribution';
import { readSimulatedLearningLoopConfig } from './config';
import { activateLearningLoop, discoverReviewedQuizzes } from './discovery';
import { processLearningLoop } from './process';
import {
  claimLearningLoop,
  ensureLearningLoopSchema,
  finishLearningLoop,
  markStaleLearningLoopsUnknown,
} from './store';

const invokeFacts: FactsInvoker = async (system, prompt) => {
  const model = await resolveModel({
    stage: 'quiz-evidence',
    workspaceId: null,
    modelString: 'deepseek:deepseek-v4-flash',
  });
  const reply = await callLLM(
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
    text: reply.text,
    finishReason: reply.finishReason ?? 'unknown',
    model: reply.response?.modelId ?? model.modelString,
    usage: reply.totalUsage ?? reply.usage ?? null,
  };
};

/** A disabled deployment installs no scanner and makes no model calls. */
export async function startQuizLearningLoop(): Promise<{ stop: () => Promise<void> } | undefined> {
  const config = readSimulatedLearningLoopConfig();
  if (!config) return undefined;
  const provider = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
  await withSchemaBootstrapLock(
    provider.pool as unknown as ConnectableQueryable,
    async (locked) => {
      await ensureLearningLoopSchema(locked);
      await ensureShortFactsSchema(locked);
    },
  );
  await activateLearningLoop(provider.withTransaction, config);
  let stopped = false;
  let active: Promise<void> | undefined;
  const tick = async () => {
    await markStaleLearningLoopsUnknown(provider.pool, new Date(Date.now() - 20 * 60 * 1000));
    await discoverReviewedQuizzes(provider.withTransaction, config);
    const job = await provider.withTransaction((tx) => claimLearningLoop(tx, randomUUID()));
    if (!job) return;
    let environment: Awaited<ReturnType<typeof openSimulatedMemory>>;
    try {
      environment = await openSimulatedMemory();
    } catch {
      await finishLearningLoop(
        provider.pool,
        job,
        job.claim_id!,
        'failed',
        null,
        'MEMORY_ENVIRONMENT_UNAVAILABLE',
      );
      return;
    }
    try {
      const adapter = createLearningLoopAdapter({
        service: new QuizShortFactsService(provider.withTransaction),
        memory: environment.memory,
        resolveRequest: requestFromStoredAttribution,
        extract: invokeFacts,
        updateMemory: invokeSimulatedMemoryModel,
      });
      await processLearningLoop(provider.pool, job, adapter);
    } finally {
      await environment.close();
    }
  };
  const wake = () => {
    if (stopped || active) return;
    active = tick()
      .catch(() => {
        // Error messages can include learning material or credentials.
        console.error('[quiz-learning-loop] background processing failed');
      })
      .finally(() => {
        active = undefined;
      });
  };
  const timer = setInterval(wake, 10_000);
  timer.unref();
  wake();
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await active;
    },
  };
}
