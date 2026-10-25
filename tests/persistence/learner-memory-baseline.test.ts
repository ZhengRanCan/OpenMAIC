import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMemoryCases } from '@/eval/learner-memory/inputs';
import { memoryFixture } from './learner-memory-fixture';
import { versionSource } from '@/lib/learner-memory/contracts';
import { source } from '../learner-memory/fixtures';

describe('Memory fixed-source mechanism verification (manual fixtures, not LLM output)', () => {
  for (const mode of ['manual', 'real'] as const)
    it(`persists and replays all ${mode} sources in independent scopes`, async () => {
      const f = await memoryFixture();
      try {
        const cases = loadMemoryCases(path.resolve('..'), mode);
        for (const c of cases) {
          const scope = { namespace: 'f67-test:' + mode, learnerKey: c.caseId };
          await f.store.ingest(scope, c.sources);
          const r = await f.store.prepare(scope, 'first');
          const aliases = Object.keys(r.aliases).filter((x) => x.startsWith('e'));
          // Deterministic echo is a persistence fixture, not a proposed quality benchmark.
          const output = {
            status: 'ready',
            sections: [
              {
                section: 'learning_experiences',
                pieceIds: aliases.map((_, i) => 'new:' + (i + 1)),
              },
            ],
            pieces: aliases.map((a, i) => ({
              id: 'new:' + (i + 1),
              text: r.aliases[a].text,
              formation: 'synthesis',
              supports: [a],
              conditions: [],
            })),
            retired: [],
            decisions: aliases.map((a, i) => ({
              source: a,
              action: 'adopt',
              pieceIds: ['new:' + (i + 1)],
              reason: '人工回读机制fixture；未评价记忆价值',
            })),
          };
          await f.store.capture(scope, 'first', {
            text: JSON.stringify(output),
            finishReason: 'stop',
            model: 'manual-fixture',
            usage: null,
            origin: 'manual',
          });
          expect((await f.store.commit(scope, 'first')).state, c.caseId).toBe('completed');
          const saved = await f.store.read(scope);
          expect(saved.usable.pieces).toHaveLength(c.sources.length);
          expect(saved.coverage.every((c) => c.processed)).toBe(true);
          expect(saved.usable.sections.goals).toEqual([]);
          expect(
            saved.usable.pieces.every((p) => p.supports.every((s) => s.occurredAt === null)),
          ).toBe(true);
          await f.store.ingest(scope, c.sources);
          expect((await f.store.prepare(scope, 'repeat')).state).toBe('noop');
        }
      } finally {
        await f.close();
      }
    });
  it('maintains explicit synthetic declarations across the other three views and updates a goal in place', async () => {
    const f = await memoryFixture();
    try {
      const sections = ['background', 'goals', 'teaching_requirements'] as const;
      const inputs = [
        '我目前在读初二。',
        '我想准备本学期数学期末考试。',
        '讲数学时请先给一个具体例子。',
      ].map((text, i) =>
        versionSource({
          ...source(),
          id: 'declaration-' + i,
          kind: 'declaration',
          text,
          refs: ['declaration:' + i],
          conditions: ['明确标记的合成声明fixture'],
        }),
      );
      await f.store.ingest(f.scope, inputs);
      const r = await f.store.prepare(f.scope, 'declarations');
      const aliases = Object.keys(r.aliases).filter((a) => a.startsWith('e'));
      const output = {
        status: 'ready',
        sections: sections.map((section, i) => ({ section, pieceIds: ['new:' + (i + 1)] })),
        pieces: aliases.map((a, i) => ({
          id: 'new:' + (i + 1),
          text: r.aliases[a].text,
          formation: 'declaration',
          supports: [a],
          conditions: [],
        })),
        retired: [],
        decisions: aliases.map((a, i) => ({
          source: a,
          action: 'adopt',
          pieceIds: ['new:' + (i + 1)],
          reason: '明确持续声明fixture',
        })),
      };
      await f.store.capture(f.scope, r.id, {
        text: JSON.stringify(output),
        finishReason: 'stop',
        model: 'manual-fixture',
        usage: null,
        origin: 'manual',
      });
      expect((await f.store.commit(f.scope, r.id)).state).toBe('completed');
      const before = (await f.store.read(f.scope)).snapshot;
      const revised = versionSource({
        ...source(),
        id: inputs[1].id,
        kind: 'declaration',
        text: '期末考试已结束，接下来准备新学期数学预习。',
        refs: ['declaration:1'],
        conditions: ['明确标记的合成声明fixture'],
      });
      await f.store.ingest(f.scope, [revised]);
      const change = await f.store.prepare(f.scope, 'goal-change');
      const id = before.sections.goals[0];
      await f.store.capture(f.scope, change.id, {
        text: JSON.stringify({
          status: 'ready',
          sections: [{ section: 'goals', pieceIds: [id] }],
          pieces: [
            { id, text: revised.text, formation: 'declaration', supports: ['e1'], conditions: [] },
          ],
          retired: [],
          decisions: [{ source: 'e1', action: 'adopt', pieceIds: [id], reason: '明确替换旧目标' }],
        }),
        finishReason: 'stop',
        model: 'manual-fixture',
        usage: null,
        origin: 'manual',
      });
      expect((await f.store.commit(f.scope, change.id)).state).toBe('completed');
      const after = (await f.store.read(f.scope)).snapshot;
      expect(after.sections.goals).toEqual([id]);
      expect(after.sections.background).toEqual(before.sections.background);
      expect(after.pieces.find((p) => p.id === id)?.text).toBe(revised.text);
    } finally {
      await f.close();
    }
  });
});
