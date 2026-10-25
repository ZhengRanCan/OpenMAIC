import { describe, expect, it } from 'vitest';
import { scopeSchema, versionSource, DEFAULT_BUDGETS } from '@/lib/learner-memory/contracts';
import { source } from './fixtures';

describe('Memory experiment boundary', () => {
  it('requires an explicit test namespace and refuses personal evidence', () => {
    expect(() => scopeSchema.parse({ namespace: 'personal', learnerKey: 'a' })).toThrow();
    expect(scopeSchema.parse({ namespace: 'f67-test:batch', learnerKey: 'N04' })).toBeTruthy();
    expect(() => versionSource({ ...source(), sourceNature: 'personal' })).toThrow();
  });
  it('versions semantic content and conditions, with no organization timestamp', () => {
    expect(versionSource(source()).version).toBe(versionSource(source()).version);
    expect(versionSource({ ...source(), conditions: ['hint'] }).version).not.toBe(
      versionSource(source()).version,
    );
    expect(DEFAULT_BUDGETS.sections.learning_experiences).toBe(1000);
  });
});
