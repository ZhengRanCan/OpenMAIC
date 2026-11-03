import { describe, expect, it } from 'vitest';
import { memoryFixture } from './learner-memory-fixture';
import { buildMemoryPrompt } from '@/lib/learner-memory/prompt';
import { DEFAULT_BUDGETS, emptySnapshot, versionSource } from '@/lib/learner-memory/contracts';
import { LearnerMemoryStore } from '@/lib/persistence/learner-memory-store';
import { source, response } from '../learner-memory/fixtures';
import { DIALOGUE_MEMORY_SYSTEM } from '@/lib/learner-memory/dialogue-prompt';

describe.skipIf(!process.env.PG_CONTRACT_URL)('Memory real PostgreSQL contracts', () => {
  it('reviews only the incorrect synthesis, preserves processed evidence and repairs in a new maintenance run', async () => {
    const f = await memoryFixture(process.env.PG_CONTRACT_URL);
    const original = new LearnerMemoryStore({
      ...f.store.provider,
      systemPrompt: 'Frozen dialogue-memory.v1 control prompt',
      sourceAuthority: async () => null,
    });
    const store = new LearnerMemoryStore({
      ...original.provider,
      systemPrompt: DIALOGUE_MEMORY_SYSTEM,
    });
    try {
      const inputs = [
        versionSource({
          ...source(),
          id: 'review:1',
          kind: 'dialogue_evidence',
          text: '教师先给0.6kg=600g、体积30cm³；学生算600÷30=20，并自报不能独立换算。',
        }),
        versionSource({
          ...source(),
          id: 'review:2',
          kind: 'dialogue_evidence',
          text: '教师随后讲1kg=1000g、右移三位并让试算；没有后续学生回复。',
        }),
        versionSource({
          ...source(),
          id: 'review:3',
          kind: 'declaration',
          text: '学习者明确声明背景。',
        }),
      ];
      await original.ingest(f.scope, inputs);
      await original.prepare(f.scope, 'original');
      await original.capture(f.scope, 'original', {
        text: JSON.stringify({
          status: 'ready',
          sections: [
            { section: 'learning_experiences', pieceIds: ['new:1'] },
            { section: 'background', pieceIds: ['new:2'] },
          ],
          pieces: [
            {
              id: 'new:1',
              text: '教师讲右移三位后，学生换算0.6kg=600g并算出20。',
              formation: 'synthesis',
              supports: ['e1', 'e2'],
            },
            {
              id: 'new:2',
              text: '学习者明确声明背景。',
              formation: 'declaration',
              supports: ['e3'],
            },
          ],
          retired: [],
          decisions: [
            { source: 'e1', action: 'adopt', pieceIds: ['new:1'], reason: '手写错误控制输出' },
            { source: 'e2', action: 'adopt', pieceIds: ['new:1'], reason: '手写错误控制输出' },
            { source: 'e3', action: 'adopt', pieceIds: ['new:2'], reason: '独立背景' },
          ],
        }),
        finishReason: 'stop',
        model: 'manual-control',
        origin: 'manual',
        usage: null,
      });
      await original.commit(f.scope, 'original');
      const oldRun = structuredClone(await original.getRun(f.scope, 'original'));
      const before = await store.read(f.scope);
      const target = before.snapshot.pieces.find((p) => p.formation === 'synthesis')!;
      const unrelated = before.snapshot.pieces.find((p) => p.formation === 'declaration')!;
      const reason = '合并倒置时序，并把教师给定换算结果写成学生产出；核对有效旧依据。';
      await expect(
        store.restrictPieceForReview(f.scope, target.id, before.snapshot.revision, ' '),
      ).rejects.toMatchObject({ code: 'RESTRICTION_REASON' });
      await expect(
        store.restrictPieceForReview(f.scope, 'missing', before.snapshot.revision, reason),
      ).rejects.toMatchObject({ code: 'MEMORY_PIECE_NOT_FOUND' });
      await expect(
        store.restrictPieceForReview(f.scope, unrelated.id, before.snapshot.revision, reason),
      ).rejects.toMatchObject({ code: 'MEMORY_PIECE_NOT_SYNTHESIS' });
      await store.restrictPieceForReview(f.scope, target.id, before.snapshot.revision, reason);
      await store.restrictPieceForReview(f.scope, target.id, before.snapshot.revision, reason);
      await expect(
        store.restrictPieceForReview(f.scope, target.id, before.snapshot.revision, '另一理由'),
      ).rejects.toMatchObject({ code: 'MEMORY_VERSION_CONFLICT' });
      const restricted = await store.read(f.scope);
      expect(restricted.snapshot.revision).toBe(before.snapshot.revision + 1);
      expect(restricted.coverage).toEqual(before.coverage);
      expect(restricted.coverage.every((s) => s.valid && s.current && s.processed)).toBe(true);
      expect(restricted.maintenancePending).toBe(true);
      expect(restricted.usable.pieces).toEqual([unrelated]);
      expect(restricted.snapshot.pieces.find((p) => p.id === target.id)?.restrictions).toEqual([
        reason,
      ]);
      // Historical s supports are not a new batch: their decisions must be rejected,
      // even when the proposed replacement text is otherwise correct.
      const invalid = await store.prepare(f.scope, 'review-invalid-s-decisions');
      expect(invalid.batch).toEqual([]);
      const oldSupports = Object.entries(invalid.aliases)
        .filter(([, s]) => s.kind === 'dialogue_evidence')
        .map(([alias]) => alias);
      const invalidReply = {
        text: JSON.stringify({
          status: 'ready',
          sections: [{ section: 'learning_experiences', pieceIds: [target.id] }],
          pieces: [
            {
              id: target.id,
              text: '教师先给600g，学生仅计算600÷30；教师后续让试算但未见回复。',
              formation: 'synthesis',
              supports: oldSupports,
            },
          ],
          retired: [],
          decisions: oldSupports.map((alias) => ({
            source: alias,
            action: 'adopt',
            pieceIds: [target.id],
            reason: '历史依据被误记为新增量',
          })),
        }),
        finishReason: 'stop',
        model: 'manual-control',
        origin: 'manual' as const,
        usage: null,
      };
      await store.capture(f.scope, invalid.id, invalidReply);
      expect(await store.commit(f.scope, invalid.id)).toMatchObject({
        state: 'failed',
        errorCode: 'BATCH_COVERAGE',
        reply: invalidReply,
      });
      expect(await store.read(f.scope)).toEqual(restricted);
      expect(await store.getRun(f.scope, 'original')).toEqual(oldRun);
      const run = await store.prepare(f.scope, 'review-maintenance');
      expect(run.state).toBe('prepared');
      expect(run.batch).toEqual([]);
      expect(Object.keys(run.aliases)).toEqual(['s1', 's2', 's3']);
      expect(run.prompt.system).toBe(DIALOGUE_MEMORY_SYSTEM);
      const supports = Object.entries(run.aliases)
        .filter(([, s]) => s.kind === 'dialogue_evidence')
        .map(([alias]) => alias);
      const correctedText =
        '教师先给600g，学生仅算600÷30=20并自报不能独立换算；教师随后让试算，未见学生回复。';
      await store.capture(f.scope, run.id, {
        text: JSON.stringify({
          status: 'ready',
          sections: [{ section: 'learning_experiences', pieceIds: [target.id] }],
          pieces: [{ id: target.id, text: correctedText, formation: 'synthesis', supports }],
          retired: [],
          decisions: [],
        }),
        finishReason: 'stop',
        model: 'manual-control',
        origin: 'manual',
        usage: null,
      });
      expect((await store.commit(f.scope, run.id)).state).toBe('completed');
      const corrected = await store.read(f.scope);
      expect(corrected.usable.pieces.find((p) => p.id === target.id)?.text).toBe(correctedText);
      expect(corrected.usable.pieces.find((p) => p.id === unrelated.id)).toEqual(unrelated);
      expect(corrected.snapshot.revision).toBe(before.snapshot.revision + 2);
      expect(corrected.maintenancePending).toBe(false);
      expect(corrected.coverage).toEqual(before.coverage);
      expect(await store.getRun(f.scope, 'original')).toEqual(oldRun);
      expect((await store.prepare(f.scope, 'nothing-more')).state).toBe('noop');
    } finally {
      await f.close();
    }
  });
  it('does not bypass Dialogue source authority during review or restore withdrawn evidence', async () => {
    const f = await memoryFixture(process.env.PG_CONTRACT_URL);
    let authority: 'valid' | 'unavailable' | 'withdrawn' = 'valid';
    const store = new LearnerMemoryStore({
      ...f.store.provider,
      sourceAuthority: async () => {
        if (authority === 'unavailable') throw Error('authority unavailable');
        return authority === 'withdrawn' ? 'dialogue_source_revoked' : null;
      },
    });
    try {
      const input = versionSource({ ...source(), kind: 'dialogue_evidence' });
      await store.ingest(f.scope, [input]);
      await store.prepare(f.scope, 'initial');
      await store.capture(f.scope, 'initial', {
        text: JSON.stringify(response()),
        finishReason: 'stop',
        model: 'control',
        origin: 'manual',
        usage: null,
      });
      await store.commit(f.scope, 'initial');
      const before = await store.read(f.scope),
        piece = before.snapshot.pieces[0];
      authority = 'unavailable';
      await expect(
        store.restrictPieceForReview(f.scope, piece.id, before.snapshot.revision, 'review'),
      ).rejects.toThrow('authority unavailable');
      authority = 'valid';
      expect((await store.read(f.scope)).snapshot).toEqual(before.snapshot);
      authority = 'withdrawn';
      const withdrawn = await store.read(f.scope);
      await store.restrictPieceForReview(f.scope, piece.id, withdrawn.snapshot.revision, 'review');
      const run = await store.prepare(f.scope, 'withdrawn-review');
      expect(run.batch).toEqual([]);
      expect(run.aliases).toEqual({});
      const view = await store.read(f.scope);
      expect(view.coverage[0]).toMatchObject({ valid: false, processed: true });
      expect(view.usable.pieces).toEqual([]);
      await expect(store.ingest(f.scope, [input])).rejects.toMatchObject({
        code: 'DIALOGUE_SOURCE_RESTRICTED',
      });
    } finally {
      await f.close();
    }
  });
  it('rolls back all persistent effects on commit failure and resumes the same captured reply', async () => {
    const f = await memoryFixture(process.env.PG_CONTRACT_URL);
    try {
      f.injectCommitFailure(true);
      await expect(f.adopt()).rejects.toThrow('injected');
      expect((await f.store.read(f.scope)).coverage[0].processed).toBe(false);
      expect((await f.store.read(f.scope)).snapshot.revision).toBe(0);
      expect((await f.store.getRun(f.scope, 'op')).state).toBe('captured');
      f.injectCommitFailure(false);
      expect((await f.store.commit(f.scope, 'op')).state).toBe('completed');
    } finally {
      await f.close();
    }
  });
  it('allows exactly one claim on independent connections and round-trips the committed adoption', async () => {
    const f = await memoryFixture(process.env.PG_CONTRACT_URL);
    try {
      await f.store.ingest(f.scope, [f.input]);
      const prepared = await f.store.prepare(f.scope, 'claim');
      expect(prepared.prompt.digest).toBe(
        buildMemoryPrompt(emptySnapshot(), [f.input], DEFAULT_BUDGETS, []).prompt.digest,
      );
      const results = await Promise.all([
        f.store.claim(f.scope, 'claim'),
        f.store.claim(f.scope, 'claim'),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      await f.store.abandon(f.scope, 'claim');
      expect((await f.adopt('roundtrip')).state).toBe('completed');
      expect((await f.store.read(f.scope)).coverage[0].processed).toBe(true);
    } finally {
      await f.close();
    }
  });
});
