import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadStandardCorpus,
  normalizeStandardMemory,
  prepareStandardInput,
  replayStandardReference,
  verifyStandardOrigin,
  type StandardCorpus,
} from '@/eval/learner-memory/standard-replay';
import { memoryFixture } from './learner-memory-fixture';

const corpus = loadStandardCorpus(path.resolve('..'));
const negatives = loadStandardCorpus(
  path.resolve('..'),
  'docs/log/artifacts/F67/memory-v0.2-2026-10-25/negative-standard.json',
);

async function allReferences(selected: StandardCorpus, url?: string) {
  const fixture = await memoryFixture(url);
  const isolated = { ...fixture, isolatedDatabase: true as const };
  try {
    const reports = [];
    for (const test of selected.cases) {
      const report = await replayStandardReference(isolated, selected, test);
      expect(report.modelCalls).toBe(0);
      expect(report.repeatState, test.id).toBe('noop');
      if (test.id === 'U01') {
        expect(report.runState).toBe('noop');
        expect(report.patch).toBeNull();
        expect(report.saved.snapshot.revision).toBe(test.input.beforeMemory.revision);
      } else if (test.id === 'U07') {
        // Restriction and successful cleanup are separate revisions. Reference describes a view.
        expect(report.saved.snapshot.revision).toBe(test.input.beforeMemory.revision + 2);
        expect(report.failedMaintenanceState?.usable.pieces.some((p) => p.id === 'm-density')).toBe(
          false,
        );
        expect(report.failedMaintenanceState?.usable.restricted).toHaveLength(1);
        expect(report.restrictedBeforeReply.usable.pieces.some((p) => p.id === 'm-density')).toBe(
          false,
        );
        expect(report.saved.usable.pieces.some((p) => p.id === 'm-past')).toBe(true);
      }
      expect(
        report.saved.coverage.filter((source) => source.valid).every((source) => source.processed),
      ).toBe(true);
      reports.push(report);
    }
    expect(reports).toHaveLength(selected.cases.length);
    return reports;
  } finally {
    await fixture.close();
  }
}

describe('24 authored Memory reference fixtures (mechanical replay, no semantic acceptance)', () => {
  it('checks that registry text and refs match the cited JSON record, beyond file hash validity', () => {
    const source = corpus.sources['f64:N04:1'];
    const document = { facts: [{ evidence: source.text, refs: source.refs }] };
    expect(() => verifyStandardOrigin(source, document, '/facts/0')).not.toThrow();
    expect(() =>
      verifyStandardOrigin({ ...source, text: '未出现在原件中的解释' }, document, '/facts/0'),
    ).toThrow('STANDARD_SOURCE_TEXT');
    expect(() =>
      verifyStandardOrigin({ ...source, refs: ['foreign'] }, document, '/facts/0'),
    ).toThrow('STANDARD_SOURCE_REFS');
    expect(() => verifyStandardOrigin(source, document, '/facts/9')).toThrow(
      'STANDARD_SOURCE_POINTER',
    );
  });
  it('loads provenance, replays both tracks through actual prepare/capture/commit/read and deduplicates repeat', async () => {
    const reports = await allReferences(corpus);
    expect(reports).toHaveLength(24);
    expect(reports.filter((report) => report.caseId.startsWith('I'))).toHaveLength(12);
  }, 60000);

  it('records not_adopt for all three negative references while keeping every view empty', async () => {
    const reports = await allReferences(negatives);
    expect(reports).toHaveLength(3);
    for (const report of reports) {
      expect(report.saved.usable.pieces).toEqual([]);
      expect(report.saved.snapshot.revision).toBe(1);
      expect(report.saved.usable.sections).toEqual({
        background: [],
        goals: [],
        teaching_requirements: [],
        learning_experiences: [],
      });
      if (report.patch?.status !== 'ready') throw new Error('Expected ready manual fixture');
      expect(report.patch.decisions).toHaveLength(1);
      expect(report.patch.decisions[0].action).toBe('not_adopt');
    }
  });

  it('builds an identical model request when reference/rubric data are replaced', async () => {
    const test = corpus.cases.find((c) => c.id === 'U11')!;
    const fixtures = [await memoryFixture(), await memoryFixture()];
    try {
      const input = { id: test.id, scope: test.scope, input: test.input };
      const altered = {
        ...input,
        reference: { marker: 'GOLD_ONLY_SECRET_MARKER' },
        rubric: { core: ['RUBRIC_ONLY_MARKER'] },
      };
      const first = await prepareStandardInput(
        { ...fixtures[0], isolatedDatabase: true },
        corpus,
        input,
      );
      const second = await prepareStandardInput(
        { ...fixtures[1], isolatedDatabase: true },
        corpus,
        altered,
      );
      expect(first.prompt).toEqual(second.prompt);
      expect(first.prompt.version).toBe('memory.v2');
      expect(first.prompt.user).not.toContain('GOLD_ONLY_SECRET_MARKER');
      expect(first.prompt.user).not.toContain('RUBRIC_ONLY_MARKER');
      expect(first.prompt.user).not.toContain(
        test.reference.memory.pieces.find((p) => p.id === 'm-density')!.text,
      );
      expect(Object.keys(first.aliases).filter((alias) => alias.startsWith('e'))).toHaveLength(1);
    } finally {
      for (const fixture of fixtures) await fixture.close();
    }
  });

  it('normalizes generated IDs while preserving source versions, conditions and view placement', () => {
    const piece = {
      id: 'random-a',
      text: '示例正文',
      formation: 'synthesis' as const,
      supports: [corpus.sources['f64:N04:1']],
      conditions: ['条件'],
      restrictions: [],
    };
    const snapshot = {
      sections: {
        background: [],
        goals: [],
        teaching_requirements: [],
        learning_experiences: ['random-a'],
      },
      pieces: [piece],
    };
    const renamed = {
      ...snapshot,
      sections: { ...snapshot.sections, learning_experiences: ['random-b'] },
      pieces: [{ ...piece, id: 'random-b' }],
    };
    expect(normalizeStandardMemory(snapshot)).toEqual(normalizeStandardMemory(renamed));
    expect(normalizeStandardMemory(snapshot)).not.toEqual(
      normalizeStandardMemory({
        ...renamed,
        pieces: [
          { ...renamed.pieces[0], supports: [{ ...piece.supports[0], version: '0'.repeat(64) }] },
        ],
      }),
    );
    expect(normalizeStandardMemory(snapshot)).not.toEqual(
      normalizeStandardMemory({
        ...renamed,
        pieces: [{ ...renamed.pieces[0], conditions: [] }],
      }),
    );
  });
});

describe.skipIf(!process.env.PG_CONTRACT_URL)(
  '24 authored Memory references in isolated real PostgreSQL schema',
  () => {
    it('persists exact supports and conditions across JSONB and replays without duplicate revisions', async () => {
      await allReferences(corpus, process.env.PG_CONTRACT_URL);
    }, 60000);

    it('persists all three negative decisions without adding memory or duplicating repeat coverage', async () => {
      const reports = await allReferences(negatives, process.env.PG_CONTRACT_URL);
      expect(reports).toHaveLength(3);
      expect(reports.every((report) => report.saved.usable.pieces.length === 0)).toBe(true);
    }, 60000);
  },
);
