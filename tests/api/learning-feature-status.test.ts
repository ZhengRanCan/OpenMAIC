import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/learning-feature-status/route';

const flags = [
  'OPENMAIC_AUTOMATIC_MASTERY',
  'OPENMAIC_QUIZ_FEEDBACK',
  'OPENMAIC_QUIZ_PRACTICE',
  'OPENMAIC_DIALOGUE_LEARNER_CONTEXT',
] as const;
const disabled = {
  automaticMastery: 'disabled',
  quizFeedback: 'disabled',
  quizPractice: 'disabled',
  dialogueLearnerContext: 'disabled',
};

beforeEach(() => {
  for (const flag of flags) vi.stubEnv(flag, undefined);
  vi.stubEnv('NEXT_PUBLIC_PI_CHAT_ENABLED', undefined);
});

afterEach(() => vi.unstubAllEnvs());

describe('learning feature status', () => {
  it('returns only the four configuration statuses and disallows caching', async () => {
    const response = GET();
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual(disabled);
  });

  it('uses the existing exact true semantics', async () => {
    for (const [index, value] of ['1', 'TRUE', 'true ', 'false'].entries()) {
      vi.stubEnv(flags[index], value);
    }
    expect(await GET().json()).toEqual(disabled);
  });

  it('shows each enabled flag from the current process configuration', async () => {
    for (const flag of flags) vi.stubEnv(flag, 'true');
    expect(await GET().json()).toEqual({
      automaticMastery: 'enabled',
      quizFeedback: 'enabled',
      quizPractice: 'enabled',
      dialogueLearnerContext: 'enabled',
    });
  });

  it('explains prerequisites and reflects their state on the next read', async () => {
    vi.stubEnv('OPENMAIC_QUIZ_PRACTICE', 'true');
    vi.stubEnv('OPENMAIC_DIALOGUE_LEARNER_CONTEXT', 'true');
    vi.stubEnv('NEXT_PUBLIC_PI_CHAT_ENABLED', 'false');
    expect(await GET().json()).toEqual({
      ...disabled,
      quizPractice: 'requiresFeedback',
      dialogueLearnerContext: 'requiresPi',
    });

    vi.stubEnv('OPENMAIC_QUIZ_FEEDBACK', 'true');
    vi.stubEnv('NEXT_PUBLIC_PI_CHAT_ENABLED', 'true');
    expect(await GET().json()).toEqual({
      ...disabled,
      quizFeedback: 'enabled',
      quizPractice: 'enabled',
      dialogueLearnerContext: 'enabled',
    });
  });
});
