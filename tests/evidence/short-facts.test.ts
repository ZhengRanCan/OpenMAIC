import { describe, expect, it } from 'vitest';
import { assertSource } from '@/lib/learner-memory/contracts';
import { shortFactSources, validateShortFacts } from '@/lib/evidence/short-facts';

const refs = {
  q1: {
    questionIdentity: 'question-1',
    traceRef: 'stage/s1/version/v1/submission/a1/question/q1',
    conditions: ['已提供公式', '代理作答'],
  },
  q1again: {
    questionIdentity: 'question-1',
    traceRef: 'stage/s1/version/v1/submission/a2/question/q1',
    conditions: ['代理作答'],
  },
  q2: {
    questionIdentity: 'question-2',
    traceRef: 'stage/s1/version/v1/submission/a1/question/q2',
    conditions: ['代理作答'],
  },
};
const fact = { type: 'error_pattern', evidence: '两题均漏乘常数项', refs: ['q1', 'q2'] };

describe('F64 short facts handoff', () => {
  it('separates empty, invalid and partial replies; enforces distinct questions', () => {
    expect(validateShortFacts('{"facts":[]}', refs).status).toBe('complete');
    expect(validateShortFacts('not json', refs).status).toBe('invalid');
    const result = validateShortFacts(
      JSON.stringify({ facts: [fact, { ...fact, refs: ['q1', 'q1again'] }] }),
      refs,
    );
    expect(result.status).toBe('partial');
    expect(result.rejected[0].codes).toContain('TWO_DISTINCT_QUESTIONS_REQUIRED');
  });
  it('rejects fabricated refs and overlong Unicode content', () => {
    const result = validateShortFacts(
      JSON.stringify({ facts: [{ ...fact, refs: ['q1', 'unknown'], evidence: '😀'.repeat(241) }] }),
      refs,
    );
    expect(result.rejected[0].codes).toEqual(
      expect.arrayContaining(['UNKNOWN_REF', 'EVIDENCE_LENGTH']),
    );
  });
  it('produces reproducible versioned sources retaining all cited conditions', () => {
    const reply = JSON.stringify({ facts: [fact] });
    const input = {
      student: 'B' as const,
      runId: 'run-1',
      snapshotFile: 'f68/run-1.json',
      snapshotBytes: Buffer.from(
        JSON.stringify({
          facts: [fact],
          refs,
          student: 'B',
          runId: 'run-1',
          sourceNature: 'proxy',
          occurredAt: '2026-10-27T00:00:00.000Z',
        }),
      ),
      reply,
      refs,
      sourceNature: 'proxy' as const,
      occurredAt: '2026-10-27T00:00:00.000Z',
    };
    const first = shortFactSources(input).sources[0];
    expect(assertSource(first)).toEqual(first);
    expect(first.refs).toEqual([refs.q1.traceRef, refs.q2.traceRef]);
    expect(first.conditions).toEqual(['已提供公式', '代理作答']);
    expect(first).toEqual(shortFactSources(input).sources[0]);
    expect(() => shortFactSources({ ...input, student: 'C' })).toThrow('SNAPSHOT_BINDING_MISMATCH');
  });
});
