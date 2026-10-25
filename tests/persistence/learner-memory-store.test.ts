import { describe, expect, it } from 'vitest';
import { memoryFixture } from './learner-memory-fixture';
import { DEFAULT_BUDGETS, versionSource } from '@/lib/learner-memory/contracts';
import { response, source } from '../learner-memory/fixtures';

describe('Memory persistent transactions', () => {
  it('adopts once, reads support snapshots, and skips identical versions', async () => {
    const f = await memoryFixture();
    try {
      expect((await f.adopt()).state).toBe('completed');
      const view = await f.store.read(f.scope);
      expect(view.usable.pieces).toHaveLength(1);
      expect(view.coverage[0].processed).toBe(true);
      await f.store.ingest(f.scope, [f.input]);
      expect((await f.store.prepare(f.scope, 'repeat')).state).toBe('noop');
      expect((await f.store.read({ ...f.scope, learnerKey: 'other' })).usable.pieces).toEqual([]);
      expect((await f.store.commit(f.scope, 'op')).state).toBe('completed');
    } finally {
      await f.close();
    }
  });
  it('rolls back content, coverage and receipt together, then commits the same capture', async () => {
    const f = await memoryFixture();
    try {
      f.injectCommitFailure(true);
      await expect(f.adopt()).rejects.toThrow('injected');
      expect((await f.store.read(f.scope)).snapshot.revision).toBe(0);
      expect((await f.store.read(f.scope)).coverage[0].processed).toBe(false);
      expect((await f.store.getRun(f.scope, 'op')).state).toBe('captured');
      f.injectCommitFailure(false);
      expect((await f.store.commit(f.scope, 'op')).state).toBe('completed');
    } finally {
      await f.close();
    }
  });
  it('processes a batch prefix without skipping pending or deferred items', async () => {
    const f = await memoryFixture();
    try {
      await f.store.ingest(f.scope, [f.input, versionSource({ ...source(), id: 'evidence-2' })]);
      const run = await f.store.prepare(f.scope, 'one', { ...DEFAULT_BUDGETS, batchSize: 1 });
      expect(run.batch).toHaveLength(1);
      await f.store.capture(f.scope, 'one', {
        text: JSON.stringify({
          status: 'ready',
          sections: [],
          pieces: [],
          retired: [],
          decisions: [
            { source: 'e1', action: 'not_adopt', pieceIds: [], reason: '无新增接续价值' },
          ],
        }),
        finishReason: 'stop',
        model: 'manual',
        usage: null,
        origin: 'manual',
      });
      await f.store.commit(f.scope, 'one');
      const next = await f.store.prepare(f.scope, 'two');
      expect(next.batch).toHaveLength(1);
      expect(next.batch[0].id).not.toBe(run.batch[0].id);
    } finally {
      await f.close();
    }
  });
  it('restricts invalid support before regeneration, persists failure and detects stale output', async () => {
    const f = await memoryFixture();
    try {
      await f.adopt();
      await f.store.ingest(f.scope, [versionSource({ ...source(), id: 'new' })]);
      await f.store.prepare(f.scope, 'pending');
      await f.store.restrictSource(f.scope, f.input.id, '旧解释已撤回');
      expect((await f.store.read(f.scope)).usable.pieces).toEqual([]);
      await f.store.capture(f.scope, 'pending', {
        text: JSON.stringify(response()),
        finishReason: 'stop',
        model: 'manual',
        usage: null,
        origin: 'manual',
      });
      expect((await f.store.commit(f.scope, 'pending')).state).toBe('conflict');
      const correction = await f.store.prepare(f.scope, 'repair');
      expect(Object.values(correction.aliases).some((s) => s.id === f.input.id)).toBe(false);
      await f.store.capture(f.scope, 'repair', {
        text: '',
        finishReason: 'error',
        model: 'manual',
        usage: null,
        origin: 'manual',
      });
      expect((await f.store.commit(f.scope, 'repair')).state).toBe('failed');
      expect((await f.store.read(f.scope)).usable.restricted).toHaveLength(1);
      await expect(f.store.ingest(f.scope, [f.input])).rejects.toThrow('SOURCE_WITHDRAWN');
    } finally {
      await f.close();
    }
  });
  it('treats same-ID content changes as a new version but not an independent attempt', async () => {
    const f = await memoryFixture();
    try {
      await f.adopt();
      const revised = versionSource({ ...source(), text: '修订后的有限解释' });
      await f.store.ingest(f.scope, [revised]);
      const next = await f.store.prepare(f.scope, 'revision');
      expect(next.batch[0].id).toBe(f.input.id);
      expect(next.batch[0].version).not.toBe(f.input.version);
      expect(next.snapshot.pieces).toHaveLength(1);
      await f.store.deleteExperiment(f.scope);
      expect((await f.db.query('SELECT * FROM learner_memory_runs')).rows).toEqual([]);
      expect((await f.db.query('SELECT * FROM learner_memory_sources')).rows).toEqual([]);
    } finally {
      await f.close();
    }
  });
  it('does not mark capacity, truncated or invalid replies as processed', async () => {
    for (const [text, finishReason] of [
      ['{"status":"capacity_exceeded","reason":"放不下"}', 'stop'],
      ['{"facts":[]}', 'stop'],
      [JSON.stringify(response()), 'length'],
    ]) {
      const f = await memoryFixture();
      try {
        await f.store.ingest(f.scope, [f.input]);
        await f.store.prepare(f.scope, 'bad');
        await f.store.capture(f.scope, 'bad', {
          text,
          finishReason,
          model: 'manual',
          usage: null,
          origin: 'manual',
        });
        expect((await f.store.commit(f.scope, 'bad')).state).toBe('failed');
        expect((await f.store.read(f.scope)).coverage[0].processed).toBe(false);
      } finally {
        await f.close();
      }
    }
  });
});
