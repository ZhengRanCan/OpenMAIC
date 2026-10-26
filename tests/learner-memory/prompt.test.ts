import { describe, expect, it } from 'vitest';
import { DEFAULT_BUDGETS, emptySnapshot, versionSource } from '@/lib/learner-memory/contracts';
import { buildMemoryPrompt, checkModelCapacity } from '@/lib/learner-memory/prompt';
import { source } from './fixtures';

describe('Memory prompt', () => {
  it('isolates an explicit System candidate while keeping user data and the default unchanged', () => {
    const s = versionSource(source());
    const baseline = buildMemoryPrompt(emptySnapshot(), [s], DEFAULT_BUDGETS, []);
    const candidate = buildMemoryPrompt(emptySnapshot(), [s], DEFAULT_BUDGETS, [], 'candidate');
    expect(candidate.prompt.user).toBe(baseline.prompt.user);
    expect(candidate.aliases).toEqual(baseline.aliases);
    expect(candidate.prompt.system).toBe('candidate');
    expect(candidate.prompt.digest).not.toBe(baseline.prompt.digest);
    expect(candidate.prompt.inputBytes).toBe(Buffer.byteLength('candidate' + baseline.prompt.user));
    expect(buildMemoryPrompt(emptySnapshot(), [s], DEFAULT_BUDGETS, [])).toEqual(baseline);
  });
  it('sends all four bounded views, source conditions and only model-facing source fields', () => {
    const s = versionSource(source());
    const { prompt, aliases } = buildMemoryPrompt(emptySnapshot(), [s], DEFAULT_BUDGETS, []);
    for (const section of ['background', 'goals', 'teaching_requirements', 'learning_experiences'])
      expect(prompt.user).toContain(`## ${section}`);
    expect(prompt.version).toBe('memory.v2');
    expect(prompt.user.indexOf('# 本次任务')).toBe(0);
    expect(prompt.user).toContain('not personal');
    expect(prompt.user).not.toContain('fixture.json');
    expect(aliases.e1.version).toBe(s.version);
  });
  it('renders structured source conditions without double encoding or leaking reference labels', () => {
    const original = {
      ...source(),
      conditions: [JSON.stringify({ hint: '题内提示', actor: 'synthetic' })],
    };
    const s = versionSource(original);
    const { prompt, aliases } = buildMemoryPrompt(emptySnapshot(), [s], DEFAULT_BUDGETS, []);
    expect(prompt.user).toContain('"hint": "题内提示"');
    expect(prompt.user).not.toContain('\\"hint\\"');
    expect(aliases.e1.conditions).toEqual(original.conditions);
    expect(prompt.user).not.toMatch(/rubric|sourceDecisions|referenceMemory/);
    expect(prompt.system).toContain('不要返回 conditions 字段');
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
