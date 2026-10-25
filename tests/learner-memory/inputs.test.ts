import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMemoryCases } from '@/eval/learner-memory/inputs';
import { buildMemoryPrompt } from '@/lib/learner-memory/prompt';
import { DEFAULT_BUDGETS, emptySnapshot } from '@/lib/learner-memory/contracts';

describe('Frozen F64 Memory input adapter', () => {
  it('reads twelve isolated positive examples, preserves refs and excludes assessment fields', () => {
    const cases = loadMemoryCases(path.resolve('..'), 'manual');
    expect(cases).toHaveLength(12);
    expect(cases.flatMap((c) => c.sources)).toHaveLength(18);
    for (const c of cases) {
      const { prompt } = buildMemoryPrompt(emptySnapshot(), c.sources, DEFAULT_BUDGETS, []);
      expect(prompt.user).not.toMatch(
        /coreFindings|coreCoverage|proposedVerdict|forbiddenInferences/,
      );
      expect(
        c.sources.every(
          (s) =>
            s.refs.length &&
            s.occurredAt === null &&
            s.conditions.some((c) => c.includes('personalLearnerEvidence')),
        ),
      ).toBe(true);
    }
  });
  it('keeps four real output cases and thirteen unreviewed candidates separate', () => {
    const cases = loadMemoryCases(path.resolve('..'), 'real');
    expect(cases).toHaveLength(4);
    expect(cases.flatMap((c) => c.sources)).toHaveLength(13);
    expect(
      cases.every((c) =>
        c.sources.every((s) => s.conditions.some((c) => c.includes('unreviewed'))),
      ),
    ).toBe(true);
  });
});
