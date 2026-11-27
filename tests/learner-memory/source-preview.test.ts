import { describe, it, expect } from 'vitest';
import { sourcePreview } from '@/lib/learner-memory/source-preview';
import { buildMemoryPrompt } from '@/lib/learner-memory/prompt';
import { DEFAULT_BUDGETS, emptySnapshot } from '@/lib/learner-memory/contracts';

describe('structured source previews', () => {
  it('preserves outcome and locator headers after long content, with explicit clipping', () => {
    const value = {
      question: '😀'.repeat(700),
      options: ['A: ' + '甲'.repeat(400)],
      review: 'incorrect',
      answerAvailable: false,
      questionId: 'q12',
      recordedTime: '2020-01-01',
      ordinal: 12,
    };
    const text = sourcePreview(JSON.stringify(value));
    expect([...text].length).toBeLessThanOrEqual(512);
    expect(JSON.parse(text)).toMatchObject({
      review: 'incorrect',
      answerAvailable: false,
      questionId: 'q12',
      recordedTime: '2020-01-01',
      ordinal: 12,
      truncated: true,
    });
    expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
  it('preserves oversized metadata for explicit request-capacity handling instead of slicing it', () => {
    const text = sourcePreview(
      JSON.stringify({ question: 'x'.repeat(800), questionId: 'q'.repeat(600), review: 'correct' }),
    );
    expect(JSON.parse(text).questionId).toHaveLength(600);
    expect(JSON.parse(text).truncated).toBe(true);
    expect(sourcePreview('short')).toBe('short');
  });
  it('shows current code point consumption without changing the budget', () => {
    const snap = emptySnapshot();
    expect(buildMemoryPrompt(snap, [], DEFAULT_BUDGETS, []).prompt.user).toContain('当前已用码点');
  });
});
