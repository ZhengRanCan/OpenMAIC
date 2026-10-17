import { describe, it, expect } from 'vitest';
import { canonical, decideSubmission, validateAnswers } from '@/lib/quiz/trace-validation';
import type { QuizSubmission } from '@/lib/quiz/trace-types';
describe('unique formal submission', () => {
  const existing: QuizSubmission = {
    id: 's1',
    attemptId: 'a',
    versionId: 'v',
    answers: { q: 'A' },
    recordId: 'r',
    seq: 1,
    savedAt: 'now',
  };
  it('reuses identical submission only', () => {
    expect(
      decideSubmission(existing, { operationId: 'o', submissionId: 's1', answers: { q: 'A' } }),
    ).toBe('reuse');
    expect(
      decideSubmission(existing, { operationId: 'o', submissionId: 's1', answers: { q: 'B' } }),
    ).toBe('conflict');
    expect(
      decideSubmission(existing, { operationId: 'o', submissionId: 's2', answers: { q: 'A' } }),
    ).toBe('conflict');
  });
  it('canonical JSON ignores object order but rejects non finite', () => {
    expect(canonical({ b: 2, a: 1 })).toBe(canonical({ a: 1, b: 2 }));
    expect(() => canonical(NaN)).toThrow();
  });
  it('rejects arbitrary option values and unknown questions', () => {
    const qs = [
      { id: 'q', type: 'single' as const, question: '?', options: [{ value: 'A', label: 'Yes' }] },
    ];
    expect(() => validateAnswers({ q: 'Yes' }, qs)).toThrow();
    expect(() => validateAnswers({ other: 'A' }, qs)).toThrow();
  });
});
