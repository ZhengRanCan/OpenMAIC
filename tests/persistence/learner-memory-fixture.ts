import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import type { Queryable, WithTransaction } from '@openmaic/storage/document/pg';
import {
  nodePostgresTransaction,
  type ConnectableQueryable,
} from '@openmaic/storage/server/reference';
import { LearnerMemoryStore } from '@/lib/persistence/learner-memory-store';
import { ensureMemorySchema } from '@/lib/persistence/learner-memory-schema';
import { versionSource } from '@/lib/learner-memory/contracts';
import { source, response } from '../learner-memory/fixtures';

export async function memoryFixture(url?: string) {
  let db: Queryable, withTransaction: WithTransaction, close: () => Promise<void>;
  if (url) {
    const schema = 'f67_test_' + randomUUID().replaceAll('-', '');
    const admin = new Pool({ connectionString: url });
    await admin.query('CREATE SCHEMA ' + schema);
    const pool = new Pool({ connectionString: url, options: '-c search_path=' + schema, max: 6 });
    db = pool;
    withTransaction = nodePostgresTransaction(pool as unknown as ConnectableQueryable);
    close = async () => {
      await pool.end();
      await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
      await admin.end();
    };
  } else {
    const local = new PGlite();
    db = local;
    withTransaction = (body) => local.transaction((tx) => body(tx));
    close = () => local.close();
  }
  await ensureMemorySchema(db);
  let failCommit = false;
  const store = new LearnerMemoryStore({
    withTransaction: (body) =>
      withTransaction((tx) =>
        body({
          query: async (sql, args) => {
            if (
              failCommit &&
              sql.startsWith('UPDATE learner_memory_runs') &&
              args?.[3] === 'completed'
            )
              throw new Error('injected commit failure');
            return tx.query(sql, args);
          },
        }),
      ),
  });
  const scope = { namespace: 'f67-test:fixture', learnerKey: 'N04' };
  const input = versionSource(source());
  const adopt = async (id = 'op') => {
    await store.ingest(scope, [input]);
    await store.prepare(scope, id);
    await store.capture(scope, id, {
      text: JSON.stringify(response()),
      finishReason: 'stop',
      model: 'manual-fixture',
      usage: null,
      origin: 'manual',
    });
    return store.commit(scope, id);
  };
  return {
    db,
    store,
    scope,
    input,
    close,
    adopt,
    injectCommitFailure: (flag: boolean) => {
      failCommit = flag;
    },
  };
}
