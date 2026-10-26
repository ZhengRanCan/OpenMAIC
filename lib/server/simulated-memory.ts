import { Pool } from 'pg';
import type { ConnectableQueryable } from '@openmaic/storage/server/reference';
import {
  invariant,
  type CapturedMemoryReply,
  type PreparedMemoryRun,
} from '@/lib/learner-memory/contracts';
import { checkModelCapacity } from '@/lib/learner-memory/prompt';
import { SimulatedMemoryEnvironment } from '@/lib/learner-memory/simulated-environment';
import { ensureMemorySchema } from '@/lib/persistence/learner-memory-schema';

export const SIMULATED_MEMORY_SCHEMA = 'f67_simulated_memory';
/** Explicit server-only connection. Never falls back to the application's DATABASE_URL. */
export async function openSimulatedMemory(connectionString = process.env.MEMORY_DATABASE_URL) {
  invariant(connectionString, 'MEMORY_DATABASE_URL_REQUIRED');
  const admin = new Pool({ connectionString });
  try {
    await admin.query('CREATE SCHEMA IF NOT EXISTS ' + SIMULATED_MEMORY_SCHEMA);
  } finally {
    await admin.end();
  }
  const pool = new Pool({
    connectionString,
    options: '-c search_path=' + SIMULATED_MEMORY_SCHEMA,
    max: 4,
  });
  try {
    await ensureMemorySchema(pool);
  } catch (error) {
    await pool.end();
    throw error;
  }
  const { nodePostgresTransaction } = await import('@openmaic/storage/server/reference');
  const memory = new SimulatedMemoryEnvironment({
    withTransaction: nodePostgresTransaction(pool as unknown as ConnectableQueryable),
  });
  return { memory, close: () => pool.end() };
}

/** Same resolver, capacity check and no-retry invocation used by the F67 trial. */
export async function invokeSimulatedMemoryModel(
  run: PreparedMemoryRun,
): Promise<CapturedMemoryReply> {
  const { resolveModel } = await import('@/lib/server/resolve-model');
  const model = await resolveModel({
    stage: 'quiz-evidence',
    workspaceId: null,
    modelString: 'deepseek:deepseek-v4-flash',
  });
  checkModelCapacity(run.prompt, model.modelInfo?.contextWindow, model.modelInfo?.outputWindow);
  const { callLLM } = await import('@/lib/ai/llm');
  const output = await callLLM(
    {
      model: model.model,
      system: run.prompt.system,
      prompt: run.prompt.user,
      maxOutputTokens: 16000,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(180000),
    },
    'f67-memory',
    { retries: 0 },
    model.thinkingConfig,
    { enabled: false, serverManaged: model.serverManaged },
  );
  const usage = output.totalUsage ?? output.usage;
  return {
    text: output.text,
    finishReason: output.finishReason,
    origin: 'model',
    model: output.response?.modelId ?? model.modelString,
    usage: usage
      ? {
          inputTokens: usage.inputTokens ?? null,
          outputTokens: usage.outputTokens ?? null,
          totalTokens: usage.totalTokens ?? null,
        }
      : null,
  };
}
