import { callLLM } from '@/lib/ai/llm';
import type { ResolvedModel } from '@/lib/server/resolve-model';
import type { OwnerPrincipal } from '@/lib/server/identity/types';
import type { ServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { QuizEvidenceStore } from '@/lib/persistence/quiz-evidence-store';
import { readEvidenceRun } from '@/lib/persistence/quiz-evidence-read';
import { evidenceDigest } from '@/lib/evidence/context';
import {
  EvidenceError,
  EVIDENCE_LIMITS,
  EVIDENCE_SCHEMA_VERSION,
  EVIDENCE_CONTEXT_VERSION,
  EVIDENCE_PROMPT_VERSION,
  type OrganizeEvidenceRequest,
  type EvidenceSettings,
  type EvidenceModelIdentity,
  type EvidenceCapturedReply,
  type EvidenceRunView,
} from '@/lib/evidence/contracts';

/** Describes the actual primary without persisting credentials or a sensitive URL. */
export function evidenceModelIdentity(model: ResolvedModel): EvidenceModelIdentity {
  return {
    provider: model.providerId,
    model: model.modelId,
    slot: 'classroom',
    endpointFingerprint: evidenceDigest(model.baseUrl ?? 'provider-default'),
    thinking:
      model.thinkingConfig ??
      (process.env.LLM_THINKING_DISABLED === 'true'
        ? { mode: 'disabled', enabled: false }
        : { mode: 'default' }),
    maxOutputTokens: EVIDENCE_LIMITS.maxOutputTokens,
    timeoutMs: EVIDENCE_LIMITS.timeoutMs,
    promptVersion: EVIDENCE_PROMPT_VERSION,
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    contextVersion: EVIDENCE_CONTEXT_VERSION,
  };
}

/** Database locks are confined to store methods, never held across the paid call. */
export async function organizeQuizEvidence(
  provider: ServerPersistenceProvider,
  principal: OwnerPrincipal,
  request: OrganizeEvidenceRequest,
  resolveModel: () => Promise<ResolvedModel>,
  loadSettings: () => Promise<EvidenceSettings>,
): Promise<{ status: 200 | 201 | 202; run: EvidenceRunView }> {
  const owner = principal.ownerId;
  const store = new QuizEvidenceStore(provider);
  let run = await store.lookupRequest(owner, request);
  let resolved: ResolvedModel | undefined;
  let created = false;
  if (!run) {
    const settings = await loadSettings();
    resolved = await resolveModel();
    const reservation = await store.reserve(
      owner,
      request,
      evidenceModelIdentity(resolved),
      settings,
    );
    run = reservation.run;
    created = reservation.kind === 'reserved';
  }
  const view = () => readEvidenceRun(provider, owner, run.id);
  if (run.state === 'calling') {
    if (run.leaseExpiresAt && Date.parse(run.leaseExpiresAt) <= Date.now()) {
      await store.interrupt(owner, run.id);
      throw new EvidenceError('INVOCATION_RESULT_UNKNOWN', 409);
    }
    return { status: 202, run: await view() };
  }
  if (run.state === 'interrupted') throw new EvidenceError('INVOCATION_RESULT_UNKNOWN', 409);
  if (run.state === 'generated') {
    await store.finalize(owner, run.id);
    return { status: 200, run: await view() };
  }
  if (run.state !== 'reserved') return { status: 200, run: await view() };
  resolved ??= await resolveModel();
  if (evidenceDigest(evidenceModelIdentity(resolved)) !== evidenceDigest(run.modelIdentity))
    throw new EvidenceError('MODEL_CONFIG_CHANGED', 409);
  const claim = await store.claim(owner, run.id);
  if (!claim) return { status: 202, run: await view() };

  let reply: EvidenceCapturedReply;
  try {
    const result = await callLLM(
      {
        model: resolved.model,
        system: run.prompt.system,
        prompt: run.context.text,
        maxOutputTokens: EVIDENCE_LIMITS.maxOutputTokens,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(EVIDENCE_LIMITS.timeoutMs),
      },
      'quiz-evidence',
      { retries: 0 },
      resolved.thinkingConfig ??
        (process.env.LLM_THINKING_DISABLED === 'true'
          ? { mode: 'disabled', enabled: false }
          : { mode: 'default' }),
      { enabled: false, serverManaged: resolved.serverManaged },
    );
    reply = {
      text: result.text,
      finishReason: result.finishReason,
      usage: result.usage,
      receivedAt: new Date().toISOString(),
      modelIdentity: run.modelIdentity,
    };
  } catch {
    // Provider exception messages can contain private prompts and endpoint credentials.
    reply = {
      text: '',
      finishReason: 'error',
      usage: null,
      receivedAt: new Date().toISOString(),
      modelIdentity: run.modelIdentity,
    };
  }
  let canonicalOwner = owner;
  for (let retry = 0; ; retry++) {
    try {
      canonicalOwner = await store.capture(owner, claim, reply);
      break;
    } catch (error) {
      if (error instanceof EvidenceError || retry >= 2) throw error;
      // Retry only the same bytes/token; never the model invocation.
    }
  }
  await store.finalize(canonicalOwner, run.id);
  if (canonicalOwner !== owner) throw new EvidenceError('OWNER_CHANGED', 409);
  return { status: created ? 201 : 200, run: await view() };
}
