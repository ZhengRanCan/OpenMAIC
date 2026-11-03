import { describe, it, expect, vi } from 'vitest';
import { Pool } from 'pg';
import {
  dialogueMemoryFixture,
  memoryModel,
  controlledMemoryReply,
} from '../persistence/dialogue-memory-fixture';
import { ensureMemorySchema } from '@/lib/persistence/learner-memory-schema';
const m = vi.hoisted(() => ({
  authority: undefined as
    | import('@/lib/learner-memory/dialogue-contracts').DialogueSourceAuthority
    | undefined,
}));
vi.mock('@/lib/server/dialogue-memory-authority', async (original) => {
  const actual = await original<typeof import('@/lib/server/dialogue-memory-authority')>();
  return {
    ...actual,
    createDialogueMemoryAuthority: (
      provider?: Parameters<typeof actual.createDialogueMemoryAuthority>[0],
      settings?: Parameters<typeof actual.createDialogueMemoryAuthority>[1],
    ) => (provider ? actual.createDialogueMemoryAuthority(provider, settings) : m.authority!),
  };
});
import { readSimulatedLearnerMemory } from '@/lib/server/simulated-learner-memory';
const url = process.env.PG_CONTRACT_URL;
if (!url && process.env.STORAGE_PG_CONTRACT_REQUIRED === '1')
  throw Error('F74 requires PG_CONTRACT_URL');
describe.skipIf(!url)('F74 existing formal consumer read', () => {
  it('returns adopted Dialogue through the real reader and blocks withdrawn supports', async () => {
    if (new URL(url!).pathname !== '/f74_contract')
      throw Error('F74 dedicated consumer test DB required');
    const f = await dialogueMemoryFixture(url!),
      admin = new Pool({ connectionString: url });
    const old = process.env.MEMORY_DATABASE_URL;
    let fixed: Pool | undefined,
      created = false;
    try {
      const d = await f.service.prepare('owner', f.request(), memoryModel);
      await f.service.update('owner', d.delivery.id, memoryModel, async (run) =>
        controlledMemoryReply(run),
      );
      await admin.query('CREATE SCHEMA f67_simulated_memory');
      created = true;
      fixed = new Pool({ connectionString: url, options: '-c search_path=f67_simulated_memory' });
      await ensureMemorySchema(fixed);
      await fixed.query(
        'CREATE TABLE f68_memory_environment(singleton BOOLEAN PRIMARY KEY,id TEXT)',
      );
      await fixed.query('INSERT INTO f68_memory_environment VALUES(true,$1)', [
        f.settings.memoryEnvironmentId,
      ]);
      const states = await f.memoryDb.query('SELECT * FROM learner_memory_states');
      for (const r of states.rows)
        await fixed.query('INSERT INTO learner_memory_states VALUES($1,$2,$3,$4)', [
          r.namespace,
          r.learner_key,
          r.snapshot,
          r.maintenance,
        ]);
      const sources = await f.memoryDb.query('SELECT * FROM learner_memory_sources');
      for (const r of sources.rows)
        await fixed.query(
          'INSERT INTO learner_memory_sources(namespace,learner_key,source_id,version,data,valid,current,processed) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            r.namespace,
            r.learner_key,
            r.source_id,
            r.version,
            r.data,
            r.valid,
            r.current,
            r.processed,
          ],
        );
      process.env.MEMORY_DATABASE_URL = url;
      m.authority = f.memory.provider.sourceAuthority;
      const before = await readSimulatedLearnerMemory('A');
      expect(before.sections.learning_experiences).toHaveLength(1);
      expect(before.sections.learning_experiences[0].supports[0].kind).toBe('dialogue_evidence');
      await f.store.delete('owner', f.evidence.id);
      const after = await readSimulatedLearnerMemory('A');
      expect(after.sections.learning_experiences).toHaveLength(0);
      expect(after.maintenancePending).toBe(true);
    } finally {
      process.env.MEMORY_DATABASE_URL = old;
      await fixed?.end();
      if (created) await admin.query('DROP SCHEMA f67_simulated_memory CASCADE');
      await admin.end();
      await f.close();
    }
  });
});
