import { describe, expect, it } from 'vitest';
import { DEFAULT_BUDGETS, emptySnapshot, versionSource } from '@/lib/learner-memory/contracts';
import { buildMemoryPrompt, checkModelCapacity } from '@/lib/learner-memory/prompt';
import { source } from './fixtures';

describe('Memory prompt', () => {
  it('sends all four bounded views, source conditions and only model-facing source fields', () => {
    const s = versionSource(source());
    const { prompt, aliases } = buildMemoryPrompt(emptySnapshot(), [s], DEFAULT_BUDGETS, []);
    expect(Object.keys(JSON.parse(prompt.user).current.sections)).toHaveLength(4);
    expect(prompt.user).toContain('not personal');
    expect(prompt.user).not.toContain('fixture.json');
    expect(aliases.e1.version).toBe(s.version);
  });
  it('rejects capacity issues and unknown context before billing', () => {
    const { prompt } = buildMemoryPrompt(emptySnapshot(), [], DEFAULT_BUDGETS, []);
    expect(() => checkModelCapacity(prompt, undefined)).toThrow('MODEL_CONTEXT_CAPACITY');
    expect(() => checkModelCapacity(prompt, 100000, 1000)).toThrow('MODEL_OUTPUT_CAPACITY');
    expect(() =>
      buildMemoryPrompt(emptySnapshot(), [], { ...DEFAULT_BUDGETS, inputBytes: 1 }, []),
    ).toThrow('REQUEST_CAPACITY_EXCEEDED');
  });
});
