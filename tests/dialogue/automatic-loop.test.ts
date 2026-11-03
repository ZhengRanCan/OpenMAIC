import { describe, it, expect } from 'vitest';
import { stageOutcome } from '@/lib/server/dialogue-learning-loop/process';
describe('two independent automatic stages', () => {
  it('distinguishes legal empty, defer, invalid and invocation unknown', () => {
    expect(stageOutcome('empty')).toBe('completed');
    expect(stageOutcome('deferred')).toBe('waiting');
    expect(stageOutcome('unknown')).toBe('unknown');
    expect(stageOutcome('invalid')).toBe('failed');
    expect(stageOutcome('revoked')).toBe('revoked');
  });
});
