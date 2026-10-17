import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { PgRuntimeStore, ensureSchema } from '@openmaic/storage/runtime/pg';
import { PgAssetStore, ensureAssetSchema } from '@openmaic/storage/asset/pg';
import { PgAssetByteStore } from '@openmaic/storage/asset/pg-bytes';
import type { Queryable, WithTransaction } from '@openmaic/storage/document/pg';
import {
  nodePostgresTransaction,
  type ConnectableQueryable,
} from '@openmaic/storage/server/reference';
import { ensureOwnerMergeSchema } from '@/lib/persistence/owner-merges';
import { ensureQuizTraceSchema } from '@/lib/persistence/quiz-trace-schema';
import { QuizTraceService } from '@/lib/persistence/quiz-trace';
import type { ServerPersistenceProvider } from '@/lib/persistence/server-provider';
import type { Scene } from '@/lib/types/stage';

export const testScene: Scene = {
  id: 'scene',
  stageId: 'stage',
  title: 'Synthetic quiz',
  order: 0,
  type: 'quiz',
  content: {
    type: 'quiz',
    questions: [
      {
        id: 'q',
        type: 'single',
        question: 'Synthetic question V1',
        options: [
          { value: 'A', label: 'Yes' },
          { value: 'B', label: 'No' },
        ],
        answer: ['A'],
        points: 2,
      },
    ],
  },
};
export async function traceFixture(pgUrl?: string) {
  let db: Queryable, withTransaction: WithTransaction, close: () => Promise<void>;
  if (pgUrl) {
    const schema = 'f62_test_' + crypto.randomUUID().replaceAll('-', '');
    const admin = new Pool({ connectionString: pgUrl });
    await admin.query('CREATE SCHEMA ' + schema);
    const pool = new Pool({ connectionString: pgUrl, options: '-c search_path=' + schema, max: 8 });
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
  await ensureSchema(db);
  await ensureOwnerMergeSchema(db);
  await ensureAssetSchema(db);
  await db.query(
    'CREATE TABLE stage_meta(stage_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,deleted_at TIMESTAMPTZ)',
  );
  await db.query('CREATE TABLE document_scenes(stage_id TEXT,id TEXT,data JSONB)');
  await ensureQuizTraceSchema(db);
  await db.query("INSERT INTO stage_meta VALUES('stage','learner',NULL)");
  await db.query("INSERT INTO document_scenes VALUES('stage','scene',$1::jsonb)", [
    JSON.stringify(testScene),
  ]);
  const assets = (tx: Queryable, body: WithTransaction) =>
    new PgAssetStore(tx, { withTransaction: body, byteStore: new PgAssetByteStore(db) });
  const provider = {
    pool: db,
    withTransaction,
    runtimeStore: new PgRuntimeStore(db, { withTransaction }),
    assetStore: assets(db, withTransaction),
    assetStoreIn: (tx: Queryable) => assets(tx, (body) => body(tx)),
  } as ServerPersistenceProvider;
  const service = new QuizTraceService(provider);
  const prepare = (operationId = 'start') =>
    service.prepare('learner', {
      operationId,
      mode: 'start',
      stageId: 'stage',
      sceneId: 'scene',
      scene: structuredClone(testScene),
    });
  return { db, provider, service, prepare, close };
}
