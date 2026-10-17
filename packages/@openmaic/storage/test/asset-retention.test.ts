import { startAssetConformanceServer } from './asset-conformance-server.js';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  PgAssetStore,
  ensureAssetSchema,
  releaseRetentionsIn,
  type Queryable,
  type WithTransaction,
} from '../src/asset/pg.js';
import { PgAssetByteStore } from '../src/asset/pg-bytes.js';
import { AssetNotFoundError, AssetQuotaExceededError } from '../src/asset/types.js';
import { AssetRetainedError } from '../src/asset/retention.js';
import { AssetCollector } from '../src/asset/collector.js';
import { ensureDocumentSchema } from '../src/document/pg.js';
import {
  recordAssetReferenceTracking,
  removeDocumentAssetReferences,
} from '../src/asset/references.js';

const principal = { key: 'learner' };
const holder = { kind: 'scene-history', id: 'version-1' };
const text = (value: string) => new Blob([value], { type: 'text/plain' });
const decode = (value: Uint8Array | undefined) => value && new TextDecoder().decode(value);

describe('durable immutable asset retention', () => {
  let db: PGlite;
  let store: PgAssetStore;
  let withTransaction: WithTransaction;
  beforeEach(async () => {
    db = new PGlite();
    await ensureAssetSchema(db);
    withTransaction = (body) => db.transaction((tx: Queryable) => body(tx));
    store = new PgAssetStore(db, { withTransaction, byteStore: new PgAssetByteStore(db) });
  });
  afterEach(async () => {
    await db.close();
  });

  test('reuses physical bytes, preserves captured bytes after original replacement', async () => {
    const source = await store.put(principal, text('original'));
    const [retained] = await store.cloneRetained(principal, {
      sourcePrincipals: [principal.key],
      sourceIds: [source, source],
      holder,
    });
    expect(retained!.assetId).not.toBe(source);
    expect(retained!.sourceRevision).toBe(1);
    expect((await db.query('SELECT * FROM asset_blobs')).rows).toHaveLength(1);
    await store.replace(principal, source, text('replacement'));
    expect(decode((await store.resolve(principal, retained!.assetId))?.bytes)).toBe('original');
    expect(decode((await store.resolve(principal, source))?.bytes)).toBe('replacement');
  });

  test('retained entries reject replacement and removal but foreign IDs remain opaque', async () => {
    const source = await store.put(principal, text('original'));
    const [retained] = await store.cloneRetained(principal, {
      sourcePrincipals: [principal.key],
      sourceIds: [source],
      holder,
    });
    await db.query('INSERT INTO document_asset_refs VALUES ($1, $2, $3, $4)', [
      'course',
      'scene',
      'scene',
      retained!.assetId,
    ]);
    await withTransaction((tx) => removeDocumentAssetReferences(tx, { stageId: 'course' }));
    await expect(
      store.replace(principal, retained!.assetId, text('changed')),
    ).rejects.toBeInstanceOf(AssetRetainedError);
    await expect(store.remove(principal, retained!.assetId)).rejects.toBeInstanceOf(
      AssetRetainedError,
    );
    await expect(store.remove({ key: 'stranger' }, retained!.assetId)).resolves.toBeUndefined();
    await expect(
      store.replace({ key: 'stranger' }, retained!.assetId, text('changed')),
    ).rejects.toBeInstanceOf(AssetNotFoundError);
    expect(await store.releasePending(principal, retained!.assetId)).toBe(false);
  });

  test('batch failures roll back every clone and reject missing source bytes', async () => {
    const source = await store.put(principal, text('original'));
    await expect(
      store.cloneRetained(principal, {
        sourcePrincipals: [principal.key],
        sourceIds: [source, 'missing'],
        holder,
      }),
    ).rejects.toBeInstanceOf(AssetNotFoundError);
    expect((await db.query('SELECT * FROM asset_entries')).rows).toHaveLength(1);
    await db.query('UPDATE asset_blobs SET bytes = NULL');
    await expect(
      store.cloneRetained(principal, {
        sourcePrincipals: [principal.key],
        sourceIds: [source],
        holder,
      }),
    ).rejects.toBeInstanceOf(AssetNotFoundError);
    expect((await db.query('SELECT * FROM asset_retention_refs')).rows).toHaveLength(0);
  });

  test('same bytes incur logical quota for a new entry, not physical dedup discount', async () => {
    const limited = new PgAssetStore(db, {
      withTransaction,
      byteStore: new PgAssetByteStore(db),
      quotaBytes: 8,
    });
    const source = await limited.put(principal, text('12345'));
    await expect(
      limited.cloneRetained(principal, {
        sourcePrincipals: [principal.key],
        sourceIds: [source],
        holder,
      }),
    ).rejects.toBeInstanceOf(AssetQuotaExceededError);
    expect((await db.query('SELECT * FROM asset_entries')).rows).toHaveLength(1);
  });

  test('requires authorized source principal and supports explicit legacy source ownership', async () => {
    const source = await store.put({ key: 'legacy' }, text('original'));
    await expect(
      store.cloneRetained(principal, {
        sourcePrincipals: [principal.key],
        sourceIds: [source],
        holder,
      }),
    ).rejects.toBeInstanceOf(AssetNotFoundError);
    const [retained] = await store.cloneRetained(principal, {
      sourcePrincipals: ['legacy'],
      sourceIds: [source],
      holder,
    });
    expect(await store.resolve({ key: 'legacy' }, retained!.assetId)).toBeNull();
    expect(decode((await store.resolve(principal, retained!.assetId))?.bytes)).toBe('original');
  });

  test('collector and document withdrawal leave retained entry live until holder release', async () => {
    await ensureDocumentSchema(db);
    await recordAssetReferenceTracking(db);
    const source = await store.put(principal, text('original'));
    const [retained] = await store.cloneRetained(principal, {
      sourcePrincipals: [principal.key],
      sourceIds: [source],
      holder,
    });
    await store.remove(principal, source);
    const collector = new AssetCollector(db, new PgAssetByteStore(db), {
      withTransaction,
      documentReferences: true,
      graceMs: 0,
      now: () => new Date(Date.now() + 86400000),
    });
    await collector.collectPass();
    expect(decode((await store.resolve(principal, retained!.assetId))?.bytes)).toBe('original');
    expect(
      (
        await db.query<{ unreferenced_at: Date | null }>(
          'SELECT unreferenced_at FROM asset_entries WHERE id = $1',
          [retained!.assetId],
        )
      ).rows[0]!.unreferenced_at,
    ).toBeNull();
    await store.releaseRetention(holder);
    await store.releaseRetention(holder);
    await collector.collectPass();
    expect(await store.resolve(principal, retained!.assetId)).toBeNull();
  });

  test('release keeps entry referenced by another holder and owner reassignment preserves retention', async () => {
    const source = await store.put(principal, text('original'));
    const [retained] = await store.cloneRetained(principal, {
      sourcePrincipals: [principal.key],
      sourceIds: [source],
      holder,
    });
    await db.query('INSERT INTO asset_retention_refs VALUES ($1, $2, $3)', [
      'other',
      'shared',
      retained!.assetId,
    ]);
    await store.reassignPrincipal(principal.key, 'claimed');
    await store.releaseRetention(holder);
    await expect(store.remove({ key: 'claimed' }, retained!.assetId)).rejects.toBeInstanceOf(
      AssetRetainedError,
    );
    expect(await store.resolve(principal, retained!.assetId)).toBeNull();
    expect(decode((await store.resolve({ key: 'claimed' }, retained!.assetId))?.bytes)).toBe(
      'original',
    );
  });

  test('external byte storage must still contain the object when a retained version is prepared', async () => {
    const source = await store.put(principal, text('original'));
    const missingExternal = new PgAssetStore(db, {
      withTransaction,
      byteStore: {
        writesOutsideRegistryDatabase: true,
        async read() {
          return null;
        },
        async write() {},
        async delete() {},
      },
    });
    await expect(
      missingExternal.cloneRetained(principal, {
        sourcePrincipals: [principal.key],
        sourceIds: [source],
        holder,
      }),
    ).rejects.toBeInstanceOf(AssetNotFoundError);
    expect((await db.query('SELECT * FROM asset_retention_refs')).rows).toHaveLength(0);
  });

  test('host rollback undoes clones and holder release in its pinned transaction', async () => {
    const source = await store.put(principal, text('original'));
    await expect(
      withTransaction(async (tx) => {
        const pinned = new PgAssetStore(tx, {
          withTransaction: (body) => body(tx),
          byteStore: new PgAssetByteStore(tx),
        });
        await pinned.cloneRetained(principal, {
          sourcePrincipals: [principal.key],
          sourceIds: [source],
          holder,
        });
        throw new Error('host version write failed');
      }),
    ).rejects.toThrow('host version write failed');
    expect((await db.query('SELECT * FROM asset_entries')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM asset_retention_refs')).rows).toHaveLength(0);
  });

  test('public asset mutations report retained history as 409 without changing its bytes', async () => {
    const source = await store.put(principal, text('original'));
    const [copy] = await store.cloneRetained(principal, {
      sourcePrincipals: [principal.key],
      sourceIds: [source],
      holder,
    });
    const server = await startAssetConformanceServer({
      store: () => store,
      authenticate: async () => principal,
    });
    try {
      const response = await fetch(`${server.baseUrl}/assets/${copy!.assetId}`, {
        method: 'DELETE',
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: 'ASSET_RETAINED' } });
      const body = new FormData();
      body.append('bytes', text('replacement'), 'bytes');
      const replacing = await fetch(`${server.baseUrl}/assets/${copy!.assetId}/content`, {
        method: 'PUT',
        body,
      });
      expect(replacing.status).toBe(409);
      expect(decode((await store.resolve(principal, copy!.assetId))?.bytes)).toBe('original');
    } finally {
      await server.close();
    }
  });

  test('batch release covers multiple holders without releasing a still-shared asset', async () => {
    const source = await store.put(principal, text('original'));
    const second = { kind: 'scene-history', id: 'version-2' };
    const [a] = await store.cloneRetained(principal, {
      sourcePrincipals: [principal.key],
      sourceIds: [source],
      holder,
    });
    const [b] = await store.cloneRetained(principal, {
      sourcePrincipals: [principal.key],
      sourceIds: [source],
      holder: second,
    });
    await db.query('INSERT INTO asset_retention_refs VALUES ($1, $2, $3)', [
      'shared',
      'remaining',
      b!.assetId,
    ]);
    await withTransaction((tx) => releaseRetentionsIn(tx, [second, holder, second]));
    await expect(store.remove(principal, a!.assetId)).resolves.toBeUndefined();
    await expect(store.remove(principal, b!.assetId)).rejects.toBeInstanceOf(AssetRetainedError);
    expect((await db.query('SELECT * FROM asset_retention_refs')).rows).toHaveLength(1);
  });
});

test('optional unavailable background is omitted inside the normal clone lock order', async () => {
  const db = new PGlite();
  try {
    await ensureAssetSchema(db);
    const store = new PgAssetStore(db, {
      withTransaction: (body) => db.transaction((tx) => body(tx)),
      byteStore: new PgAssetByteStore(db),
    });
    const source = await store.put(principal, text('available'));
    const refs = await store.cloneRetained(principal, {
      sourcePrincipals: [principal.key],
      sourceIds: [source, 'missing'],
      holder: { kind: 'background-test', id: 'v' },
      skipUnavailable: true,
    });
    expect(refs.map((r) => r.sourceId)).toEqual([source]);
    await expect(
      store.cloneRetained(principal, {
        sourcePrincipals: [principal.key],
        sourceIds: ['missing'],
        holder: { kind: 'background-test', id: 'strict' },
      }),
    ).rejects.toBeInstanceOf(AssetNotFoundError);
  } finally {
    await db.close();
  }
});
