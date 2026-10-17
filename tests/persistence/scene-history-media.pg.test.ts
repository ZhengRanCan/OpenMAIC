import { it, describe, expect } from 'vitest';
import { traceFixture, testScene } from './quiz-trace-fixture';
import { assetPrincipalForOwner } from '@/lib/persistence/owner-assets';
import { deleteQuizTraceIn } from '@/lib/persistence/quiz-trace-lifecycle';
describe.skipIf(!process.env.PG_CONTRACT_URL)('Scene historical media (real PostgreSQL)', () => {
  it('keeps original narration bytes after replace, protects retained copy and releases on explicit delete', async () => {
    const f = await traceFixture(process.env.PG_CONTRACT_URL);
    try {
      const principal = assetPrincipalForOwner('learner'),
        store = f.provider.assetStore;
      const source = await store.put(principal, new Blob(['before'], { type: 'audio/mpeg' }));
      const scene = {
        ...structuredClone(testScene),
        actions: [{ id: 'speech', type: 'speech' as const, text: 'Narration', audioId: source }],
      };
      const a = await f.service.prepare('learner', {
        operationId: 'start',
        mode: 'start',
        stageId: 'stage',
        sceneId: 'scene',
        scene,
      });
      const copy = a.version.resources[0].assetId as typeof source;
      await store.replace(principal, source, new Blob(['after'], { type: 'audio/mpeg' }));
      const bytes = await store.resolve(principal, copy);
      expect(new TextDecoder().decode(bytes?.bytes)).toBe('before');
      await expect(store.remove(principal, copy)).rejects.toMatchObject({ code: 'ASSET_RETAINED' });
      await f.provider.withTransaction((tx) =>
        deleteQuizTraceIn(tx, 'learner', { stageId: 'stage' }),
      );
      expect((await f.db.query('SELECT * FROM asset_retention_refs')).rows).toHaveLength(0);
      await expect(store.remove(principal, copy)).resolves.toBeUndefined();
    } finally {
      await f.close();
    }
  });
});
