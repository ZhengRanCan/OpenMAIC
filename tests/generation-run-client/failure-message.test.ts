import { describe, expect, it } from 'vitest';

import { applyRunEvent, viewFromSnapshot } from '@/lib/generation-run-client/reducer';
import { runFailureText } from '@/lib/generation-run-client/failure-message';

import { event, snapshot } from './fixtures';

describe('what a paused run says', () => {
  const at = (step: string, extra: Record<string, unknown> = {}) =>
    runFailureText({ step, message: 'raw message', ...extra });

  it.each([
    ['LEARNER_MEMORY_UNAVAILABLE', 'learnerMemoryUnavailable'],
    ['LEARNER_MEMORY_RECHECK_REQUIRED', 'learnerMemoryRecheckRequired'],
    ['LEARNER_MEMORY_SOURCE_INVALID', 'learnerMemorySourceInvalid'],
    ['LEARNER_CONTEXT_INVALID', 'learnerContextInvalid'],
    ['LEARNER_CONTEXT_SELECTION_INVALID', 'learnerContextInvalid'],
    ['LEARNER_CONTEXT_INPUT_CAPACITY_EXCEEDED', 'learnerContextInvalid'],
    ['LEARNER_CONTEXT_SELECTION_FAILED', 'learnerContextInvalid'],
    ['LEARNER_CONTEXT_CALL_UNKNOWN', 'learnerContextCallUnknown'],
  ])('explains %s with a recovery message at selection or outline recheck', (errorCode, key) => {
    for (const step of ['learner-context', 'outline']) {
      expect(at(step, { errorCode })).toEqual({ key: `generation.${key}` });
    }
  });

  it('says a scene failure the way the classic preview did', () => {
    expect(at('scene:0:content', { errorCode: 'UPSTREAM_ERROR', statusCode: 503 })).toEqual({
      key: 'generation.sceneGenerateProviderUnavailable',
    });
    expect(at('scene:0:actions', { errorCode: 'RATE_LIMITED', statusCode: 429 })).toEqual({
      key: 'generation.sceneGenerateRateLimited',
    });
    expect(at('scene:0:content', { errorCode: 'UPSTREAM_ERROR', statusCode: 401 })).toEqual({
      key: 'generation.sceneGenerateAuthFailed',
    });
    expect(at('scene:0:content', { errorCode: 'MISSING_API_KEY' })).toEqual({
      key: 'generation.sceneGenerateAuthFailed',
    });
    expect(at('scene:2:actions', { errorCode: 'GENERATION_FAILED' })).toEqual({
      key: 'generation.sceneGenerateInvalidResponse',
    });
    expect(at('scene:0:content', { errorCode: 'INTERNAL_ERROR' })).toEqual({
      key: 'generation.sceneGenerateFailed',
    });
    // An unknown code (or none) says the run's own message.
    expect(at('scene:0:content', { errorCode: 'SOMETHING_NEW', statusCode: 400 })).toEqual({
      text: 'raw message',
    });
    expect(at('scene:0:content')).toEqual({ text: 'raw message' });
  });

  it('says the other steps as their own screens did', () => {
    expect(at('scene:0:narration')).toEqual({ key: 'generation.speechFailed' });
    expect(at('material-analysis')).toEqual({ key: 'generation.courseMaterialParseFailed' });
    expect(at('outline')).toEqual({ text: 'raw message' });
    expect(runFailureText({ step: 'outline', message: '' })).toEqual({
      key: 'generation.outlineGenerateFailed',
    });
    expect(runFailureText({ step: 'research', message: '' })).toEqual({
      key: 'generation.webSearchFailed',
    });
  });

  it('keeps the code of the failure the run paused at', () => {
    let view = viewFromSnapshot(snapshot({ state: 'generating', seq: 1 }));
    view = applyRunEvent(
      view,
      event(2, 'step_failed', {
        step: 'scene:0:content',
        message: 'x',
        errorCode: 'UPSTREAM_ERROR',
        statusCode: 502,
      }),
    );
    expect(view.error).toEqual({
      step: 'scene:0:content',
      message: 'x',
      errorCode: 'UPSTREAM_ERROR',
      statusCode: 502,
    });
  });
});
