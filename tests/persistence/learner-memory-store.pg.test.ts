import { describe, expect, it } from 'vitest';
import { memoryFixture } from './learner-memory-fixture';
import { buildMemoryPrompt } from '@/lib/learner-memory/prompt';
import { DEFAULT_BUDGETS, emptySnapshot } from '@/lib/learner-memory/contracts';

describe.skipIf(!process.env.PG_CONTRACT_URL)('Memory real PostgreSQL contracts', () => {
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
