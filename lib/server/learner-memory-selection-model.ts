import { callLLM } from '@/lib/ai/llm';
import { PreclassLearnerContextError } from '@/lib/learner-context/contracts';
import type { MemorySelectionPrompt } from '@/lib/learner-context/selection-contracts';
import type { ResolvedModel } from '@/lib/server/resolve-model';

/** The caller resolves its model slot and persists the call marker. No retry or fallback. */
export async function invokeMemorySelectionModel(input: {
  resolvedModel: ResolvedModel;
  usageLabel: string;
  prompt: MemorySelectionPrompt;
  beforeSelect: () => Promise<void>;
  signal?: AbortSignal;
}): Promise<string> {
  const { resolvedModel: model, usageLabel, prompt, beforeSelect, signal } = input;
  signal?.throwIfAborted();
  const outputBudget = 2000;
  // UTF-8 bytes conservatively bound tokens; never truncate source material silently.
  if (
    (model.modelInfo?.contextWindow !== undefined &&
      prompt.inputBytes + outputBudget + 1024 > model.modelInfo.contextWindow) ||
    (model.modelInfo?.outputWindow !== undefined && model.modelInfo.outputWindow < outputBudget)
  ) {
    throw new PreclassLearnerContextError('LEARNER_CONTEXT_INPUT_CAPACITY_EXCEEDED');
  }
  await beforeSelect();
  signal?.throwIfAborted();
  try {
    const result = await callLLM(
      {
        model: model.model,
        system: prompt.system,
        prompt: prompt.user,
        maxOutputTokens: outputBudget,
        maxRetries: 0,
        abortSignal: signal,
      },
      usageLabel,
      { retries: 0 },
      model.thinkingConfig,
      { enabled: false, serverManaged: model.serverManaged },
    );
    if (result.finishReason !== 'stop')
      throw new PreclassLearnerContextError('LEARNER_CONTEXT_SELECTION_INVALID');
    return result.text;
  } catch (error) {
    if (error instanceof PreclassLearnerContextError || signal?.aborted) throw error;
    throw new PreclassLearnerContextError('LEARNER_CONTEXT_SELECTION_FAILED');
  }
}
