import { Pool } from 'pg';
import { PgRuntimeStore, ensureSchema } from '@openmaic/storage/runtime/pg';
import {
  nodePostgresTransaction,
  type ConnectableQueryable,
} from '@openmaic/storage/server/reference';
import { runtimeSessionId, buildChatRecordInit, statePayload } from '@/lib/utils/chat-storage-core';
import type { ChatSession } from '@/lib/types/chat';

export async function dialogueFixture(url: string) {
  const schema = 'f72_test_' + crypto.randomUUID().replaceAll('-', '');
  if (!/^f72_test_[a-f0-9]{32}$/.test(schema)) throw Error('Invalid isolated schema');
  const admin = new Pool({ connectionString: url });
  await admin.query('CREATE SCHEMA ' + schema);
  const db = new Pool({ connectionString: url, options: '-c search_path=' + schema, max: 4 });
  const withTransaction = nodePostgresTransaction(db as unknown as ConnectableQueryable);
  const store = new PgRuntimeStore(db, { withTransaction });
  const close = async () => {
    await db.end();
    await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
    await admin.end();
  };
  try {
    await ensureSchema(db);
    await db.query(
      'CREATE TABLE stage_meta(stage_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,deleted_at TIMESTAMPTZ)',
    );
    await db.query("INSERT INTO stage_meta VALUES('stage','owner',NULL)");
  } catch (error) {
    await close();
    throw error;
  }
  async function save(chat: ChatSession, runtimeId = runtimeSessionId('stage', 'owner', chat.id)) {
    await store.createSession({
      id: runtimeId,
      kind: 'chat',
      stageId: 'stage',
      learnerKey: 'owner',
      status: 'active',
      createdAt: new Date(chat.createdAt).toISOString(),
      updatedAt: new Date(chat.updatedAt).toISOString(),
    });
    for (const message of chat.messages) {
      await store.appendRecord(
        buildChatRecordInit(
          runtimeId,
          {
            kind: 'chat_message',
            payloadVersion: 1,
            role: message.role,
            content: message.parts
              .filter((p) => p.type === 'text')
              .map((p) => p.text)
              .join(''),
            message,
            sessionUpdatedAt: chat.updatedAt,
          },
          chat,
          'message:' + message.id,
        ),
      );
    }
    await store.appendRecord(buildChatRecordInit(runtimeId, statePayload(chat), chat, 'state'));
    return runtimeId;
  }
  async function dump() {
    const tables = ['runtime_sessions', 'runtime_records', 'stage_meta'];
    return Promise.all(
      tables.map(
        async (t) =>
          (await db.query('SELECT to_jsonb(t) AS row FROM ' + t + ' t ORDER BY to_jsonb(t)::text'))
            .rows,
      ),
    );
  }
  return { db, store, provider: { withTransaction }, close, save, dump };
}
