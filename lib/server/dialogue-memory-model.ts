import type { ResolvedModel } from './resolve-model';
import { dialogueModelIdentity } from './dialogue-evidence';
import { invariant } from '@/lib/learner-memory/contracts';
import type { PreparedMemoryRun, CapturedMemoryReply } from '@/lib/learner-memory/contracts';
import {
  DIALOGUE_MEMORY_LIMITS,
  DIALOGUE_MEMORY_VERSION,
} from '@/lib/learner-memory/dialogue-contracts';
export function dialogueMemoryModelIdentity(model: ResolvedModel) {
  return {
    ...dialogueModelIdentity(model),
    promptVersion: DIALOGUE_MEMORY_VERSION,
    maxOutputTokens: DIALOGUE_MEMORY_LIMITS.maxOutputTokens,
    timeoutMs: DIALOGUE_MEMORY_LIMITS.timeoutMs,
  };
}
export function checkDialogueMemoryModelCapacity(model: ResolvedModel, run: PreparedMemoryRun) {
  const { contextWindow, outputWindow } = model.modelInfo ?? {};
  invariant(
    typeof contextWindow === 'number' &&
      Number.isFinite(contextWindow) &&
      contextWindow >= run.prompt.inputBytes + DIALOGUE_MEMORY_LIMITS.maxOutputTokens + 1024,
    'MODEL_CONTEXT_CAPACITY',
  );
  invariant(
    outputWindow === undefined || outputWindow >= DIALOGUE_MEMORY_LIMITS.maxOutputTokens,
    'MODEL_OUTPUT_CAPACITY',
  );
}
export async function invokeDialogueMemoryModel(
  model: ResolvedModel,
  run: PreparedMemoryRun,
): Promise<CapturedMemoryReply> {
  checkDialogueMemoryModelCapacity(model, run);
  const { callLLM } = await import('@/lib/ai/llm');
  const result = await callLLM(
    {
      model: model.model,
      system: run.prompt.system,
      prompt: run.prompt.user,
      maxOutputTokens: DIALOGUE_MEMORY_LIMITS.maxOutputTokens,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(DIALOGUE_MEMORY_LIMITS.timeoutMs),
    },
    'f67-memory',
    { retries: 0 },
    model.thinkingConfig,
    { enabled: false, serverManaged: model.serverManaged },
  );
  const usage = result.totalUsage ?? result.usage;
  return {
    text: result.text,
    finishReason: result.finishReason ?? 'unknown',
    model: result.response?.modelId ?? model.modelString,
    origin: 'model',
    usage: usage
      ? {
          inputTokens: usage.inputTokens ?? null,
          outputTokens: usage.outputTokens ?? null,
          totalTokens: usage.totalTokens ?? null,
        }
      : null,
  };
}
