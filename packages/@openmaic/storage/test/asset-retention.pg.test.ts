import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  PgAssetStore,
  ensureAssetSchema,
  type Queryable,
  type WithTransaction,
} from '../src/asset/pg.js';
import { PgAssetByteStore } from '../src/asset/pg-bytes.js';
import { AssetRetainedError } from '../src/asset/retention.js';
import { AssetQuotaExceededError } from '../src/asset/types.js';

const url = process.env.PG_CONTRACT_URL;
if (process.env.STORAGE_PG_CONTRACT_REQUIRED === '1' && !url) {
  throw new Error('STORAGE_PG_CONTRACT_REQUIRED=1 requires PG_CONTRACT_URL');
}

describe.skipIf(!url)('asset retention with independent PostgreSQL connections', () => {
  const schema = `asset_retention_contract_${randomUUID().replaceAll('-', '')}`;
  let admin: Pool;
  let pool: Pool;
  let store: PgAssetStore;
  const principal = { key: 'learner' };
  const transaction: WithTransaction = async (body) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await body(client as Queryable);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      max: 5,
      options: `-c search_path=${schema},public`,
      application_name: schema,
    });
    await ensureAssetSchema(pool as Queryable);
    store = new PgAssetStore(pool as Queryable, {
      withTransaction: transaction,
      byteStore: new PgAssetByteStore(pool as Queryable),
    });
  });
  afterAll(async () => {
    await pool?.end();
    // Only this suite's generated schema can be dropped, never a supplied path/database.
    if (admin && /^asset_retention_contract_[0-9a-f]{32}$/.test(schema)) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  test('freeze and replace race produces one consistent captured revision', async () => {
    const source = await store.put(principal, new Blob(['before']));
    const [retained] = await Promise.all([
      store.cloneRetained(principal, {
        sourcePrincipals: [principal.key],
        sourceIds: [source],
        holder: { kind: 'version', id: randomUUID() },
      }),
      store.replace(principal, source, new Blob(['after'])),
    ]);
    const capture = retained[0]!;
    const bytes = (await store.resolve(principal, capture.assetId))!.bytes;
    expect(new TextDecoder().decode(bytes)).toBe(capture.sourceRevision === 1 ? 'before' : 'after');
    await expect(store.remove(principal, capture.assetId)).rejects.toBeInstanceOf(
      AssetRetainedError,
    );
  });

  test('removal waits for an insert-only holder and checks references in a fresh snapshot', async () => {
    const source = await store.put(principal, new Blob(['protected']));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO asset_retention_refs VALUES ($1, $2, $3)', [
        'race',
        randomUUID(),
        source,
      ]);
      // Start removal while the foreign key's KEY SHARE remains held. Its
      // outcome is observed only after COMMIT and must see that new holder.
      const removing = store.remove(principal, source).then(
        () => 'removed',
        (error: unknown) => error,
      );
      let blocked = false;
      for (let retry = 0; retry < 100 && !blocked; retry += 1) {
        const waiters = await pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
          [schema],
        );
        blocked = waiters.rows.length > 0;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await client.query('COMMIT');
      expect(await removing).toBeInstanceOf(AssetRetainedError);
      expect(await store.resolve(principal, source)).not.toBeNull();
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  test('release and replacement of a protected clone cannot mutate a still-held version', async () => {
    const source = await store.put(principal, new Blob(['original']));
    const holder = { kind: 'version', id: randomUUID() };
    const [copy] = await store.cloneRetained(principal, {
      sourcePrincipals: [principal.key],
      sourceIds: [source],
      holder,
    });
    await pool.query('INSERT INTO asset_retention_refs VALUES ($1, $2, $3)', [
      'shared',
      randomUUID(),
      copy!.assetId,
    ]);
    const outcomes = await Promise.allSettled([
      store.releaseRetention(holder),
      store.replace(principal, copy!.assetId, new Blob(['changed'])),
    ]);
    expect(outcomes[0]!.status).toBe('fulfilled');
    expect(outcomes[1]!.status).toBe('rejected');
    expect(new TextDecoder().decode((await store.resolve(principal, copy!.assetId))!.bytes)).toBe(
      'original',
    );
  });

  test('concurrent retained copies serialize logical quota checks', async () => {
    const owner = { key: 'quota-learner' };
    const limited = new PgAssetStore(pool as Queryable, {
      withTransaction: transaction,
      byteStore: new PgAssetByteStore(pool as Queryable),
      quotaBytes: 10,
    });
    const source = await limited.put(owner, new Blob(['12345']));
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        limited.cloneRetained(owner, {
          sourcePrincipals: [owner.key],
          sourceIds: [source],
          holder: { kind: 'quota', id: randomUUID() },
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((result) => result.status === 'rejected');
    expect(failed?.status === 'rejected' && failed.reason).toBeInstanceOf(AssetQuotaExceededError);
    const usage = await pool.query(
      'SELECT count(*)::int AS count FROM asset_entries WHERE principal = $1',
      [owner.key],
    );
    expect(usage.rows[0].count).toBe(2);
  });
});
