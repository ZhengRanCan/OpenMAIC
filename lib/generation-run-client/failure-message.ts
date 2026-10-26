/**
 * What the preview says about the step a run paused at: the sentences the
 * browser showed when it called the generation routes itself, chosen by the
 * step and the error code the run recorded for it. The run's own message is
 * the fallback, as the route's message was.
 */
import type { GenerationRunFailure } from '@/lib/server/generation/run/types';

export type FailureText = { key: string } | { text: string };

/** The classic mapping of a scene step's failure (content, actions) to a sentence. */
export function sceneFailureText(failure: {
  message?: string;
  errorCode?: string;
  statusCode?: number;
}): FailureText {
  const { errorCode, statusCode } = failure;
  if (errorCode === 'MISSING_API_KEY' || statusCode === 401 || statusCode === 403) {
    return { key: 'generation.sceneGenerateAuthFailed' };
  }
  if (errorCode === 'RATE_LIMITED' || statusCode === 429) {
    return { key: 'generation.sceneGenerateRateLimited' };
  }
  if (errorCode === 'UPSTREAM_ERROR' && statusCode && statusCode >= 500) {
    return { key: 'generation.sceneGenerateProviderUnavailable' };
  }
  if (errorCode === 'INTERNAL_ERROR') return { key: 'generation.sceneGenerateFailed' };
  if (errorCode === 'GENERATION_FAILED') return { key: 'generation.sceneGenerateInvalidResponse' };
  return failure.message ? { text: failure.message } : { key: 'generation.sceneGenerateFailed' };
}

export function runFailureText(
  failure: Pick<GenerationRunFailure, 'step' | 'message' | 'errorCode' | 'statusCode'>,
): FailureText {
  const step = failure.step ?? '';
  const learnerFailureKeys: Record<string, string> = {
    LEARNER_MEMORY_UNAVAILABLE: 'generation.learnerMemoryUnavailable',
    LEARNER_MEMORY_RECHECK_REQUIRED: 'generation.learnerMemoryRecheckRequired',
    LEARNER_MEMORY_SOURCE_INVALID: 'generation.learnerMemorySourceInvalid',
    LEARNER_CONTEXT_INVALID: 'generation.learnerContextInvalid',
    LEARNER_CONTEXT_SELECTION_INVALID: 'generation.learnerContextInvalid',
    LEARNER_CONTEXT_INPUT_CAPACITY_EXCEEDED: 'generation.learnerContextInvalid',
    LEARNER_CONTEXT_SELECTION_FAILED: 'generation.learnerContextInvalid',
    LEARNER_CONTEXT_CALL_UNKNOWN: 'generation.learnerContextCallUnknown',
  };
  const learnerKey =
    failure.errorCode && Object.hasOwn(learnerFailureKeys, failure.errorCode)
      ? learnerFailureKeys[failure.errorCode]
      : undefined;
  if (learnerKey) return { key: learnerKey };
  if (step === 'learner-context') {
    return failure.message
      ? { text: failure.message }
      : { key: 'generation.learnerContextInvalid' };
  }
  if (step === 'material-analysis') return { key: 'generation.courseMaterialParseFailed' };
  if (step === 'research') {
    return failure.message ? { text: failure.message } : { key: 'generation.webSearchFailed' };
  }
  if (step === 'outline') {
    return failure.message
      ? { text: failure.message }
      : { key: 'generation.outlineGenerateFailed' };
  }
  if (/^scene:\d+:narration$/.test(step)) return { key: 'generation.speechFailed' };
  if (/^scene:\d+:(content|actions)$/.test(step)) return sceneFailureText(failure);
  return failure.message ? { text: failure.message } : { key: 'generation.sceneGenerateFailed' };
}
