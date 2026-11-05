import type { ResolvedModel } from './resolve-model';
import { digest } from '@/lib/learner-memory/contracts';
import {
  DIALOGUE_LIMITS,
  DIALOGUE_PROMPT_VERSION,
  DialogueEvidenceError,
  type DialogueModelIdentity,
  type DialogueEvidenceRun,
  type DialogueEvidenceSettings,
  type DialogueCapturedReply,
} from '@/lib/dialogue/evidence-contracts';
import type { DialogueEvidenceStore } from '@/lib/persistence/dialogue-evidence-store';

export function dialogueModelIdentity(
  model: ResolvedModel,
  promptVersion: string = DIALOGUE_PROMPT_VERSION,
): DialogueModelIdentity {
  return {
    provider: model.providerId,
    model: model.modelId,
    endpointFingerprint: digest(model.baseUrl ?? 'provider-default'),
    slot: 'classroom',
    thinking:
      model.thinkingConfig ??
      (process.env.LLM_THINKING_DISABLED === 'true'
        ? { mode: 'disabled', enabled: false }
        : { mode: 'default' }),
    maxOutputTokens: DIALOGUE_LIMITS.maxOutputTokens,
    timeoutMs: DIALOGUE_LIMITS.timeoutMs,
    promptVersion,
  };
}
export async function invokeDialogueModel(
  model: ResolvedModel,
  run: DialogueEvidenceRun,
): Promise<DialogueCapturedReply> {
  if (!run.context || run.context.tooLarge) throw new DialogueEvidenceError('INPUT_TOO_LARGE', 413);
  const { callLLM } = await import('@/lib/ai/llm');
  const start = Date.now();
  const result = await callLLM(
    {
      model: model.model,
      system: run.system,
      prompt: run.context.text,
      maxOutputTokens: DIALOGUE_LIMITS.maxOutputTokens,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(DIALOGUE_LIMITS.timeoutMs),
    },
    'quiz-evidence',
    { retries: 0 },
    model.thinkingConfig ??
      (process.env.LLM_THINKING_DISABLED === 'true'
        ? { mode: 'disabled', enabled: false }
        : { mode: 'default' }),
    { enabled: false, serverManaged: model.serverManaged },
  );
  return {
    text: result.text,
    finishReason: result.finishReason ?? 'unknown',
    usage: result.totalUsage ?? result.usage ?? null,
    actualModel: result.response?.modelId ?? null,
    receivedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
  };
}
/** Only storage is retried. Neither SDK retries nor provider fallback is permitted. */
export async function extractDialogueEvidence(
  owner: string,
  id: string,
  model: DialogueModelIdentity,
  store: Pick<DialogueEvidenceStore, 'claim' | 'capture' | 'finalize'>,
  read: () => Promise<DialogueEvidenceRun>,
  invoke: (run: DialogueEvidenceRun) => Promise<DialogueCapturedReply>,
  settings: () => Promise<DialogueEvidenceSettings>,
): Promise<DialogueEvidenceRun> {
  const run = await read();
  if (run.state === 'captured') {
    await store.finalize(owner, id);
    return read();
  }
  if (run.state !== 'prepared') return run;
  if (digest(run.model) !== digest(model)) throw new DialogueEvidenceError('MODEL_CONFIG_CHANGED');
  const claim = await store.claim(owner, id, await settings());
  if (!claim) return read();
  let reply: DialogueCapturedReply;
  const start = Date.now();
  try {
    reply = await invoke(run);
  } catch {
    reply = {
      text: '',
      finishReason: 'unknown',
      usage: null,
      actualModel: null,
      receivedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
    };
  }
  const currentSettings = await settings();
  for (let attempt = 0; ; attempt++) {
    try {
      await store.capture(owner, claim, reply, currentSettings);
      break;
    } catch (error) {
      if (error instanceof DialogueEvidenceError || attempt >= 2) throw error;
    }
  }
  await store.finalize(owner, id);
  return read();
}
