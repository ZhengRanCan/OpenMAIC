import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import {
  nodePostgresTransaction,
  type ConnectableQueryable,
} from '@openmaic/storage/server/reference';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dialogueFixture } from './dialogue-trace-fixture';
import { readDialogueSource } from '@/lib/persistence/dialogue-trace-read';
import {
  generationRuntimeSessionId,
  runtimeSessionId,
  restoreMarkerPrefix,
  deletionMarkerId,
  buildChatRecordInit,
  statePayload,
} from '@/lib/utils/chat-storage-core';
import type { ChatSession } from '@/lib/types/chat';

const url = process.env.PG_CONTRACT_URL;

// Optional, explicit readback of the real browser test's isolated DB. No seeding.
describe.skipIf(!process.env.F72_PAGE_ARTIFACT_NAME)('F72 actual browser source readback', () => {
  it('exports only actually saved synthetic page sources through the formal reader', async () => {
    const name = process.env.F72_PAGE_ARTIFACT_NAME!;
    if (!/^[a-z0-9-]+\.json$/.test(name) || !url)
      throw Error('Invalid explicit page artifact invocation');
    const pool = new Pool({ connectionString: url });
    try {
      const stages = await pool.query(
        "SELECT stage_id,owner_id FROM stage_meta WHERE stage_id LIKE 'f72-synthetic-page-%' ORDER BY stage_id",
      );
      const output = [];
      for (const stage of stages.rows) {
        const ids = await pool.query(
          "SELECT DISTINCT r.data->'payload'->>'chatSessionId' AS id FROM runtime_records r JOIN runtime_sessions s ON s.id=r.session_id WHERE s.stage_id=$1 AND s.learner_key=$2 AND r.data->'payload'->>'kind'='chat_session_state' AND r.data->'payload'->>'type' IN ('qa','discussion') ORDER BY id",
          [stage.stage_id, stage.owner_id],
        );
        for (const { id } of ids.rows) {
          const result = await readDialogueSource(
            { withTransaction: nodePostgresTransaction(pool as unknown as ConnectableQueryable) },
            stage.owner_id,
            { stageId: stage.stage_id, chatSessionId: id },
          );
          expect(result.status).toBe('available');
          output.push(result);
        }
      }
      expect(output.length).toBeGreaterThan(0);
      await writeFile(
        path.resolve('../docs/log/artifacts/F72/page-001', name),
        JSON.stringify(output, null, 2) + '\n',
      );
    } finally {
      await pool.end();
    }
  });
});
if (process.env.STORAGE_PG_CONTRACT_REQUIRED === '1' && !url)
  throw Error('F72 requires PG_CONTRACT_URL; refusing to skip real PostgreSQL');
function chat(type: 'qa' | 'discussion' = 'qa', count = 1): ChatSession {
  return {
    id: 'c',
    type,
    title: 'Synthetic discussion',
    status: 'completed',
    messages: Array.from({ length: count }, (_, i) => ({
      id: 'm' + i,
      role: i % 2 ? 'assistant' : 'user',
      parts: [{ type: 'text', text: ` original ${i}\n` }],
      metadata: {
        createdAt: i,
        originalRole: i % 2 ? 'agent' : 'user',
        ...(i % 2 ? { agentId: 'tutor', interrupted: true } : {}),
      },
    })),
    config: { agentIds: ['tutor'] },
    toolCalls: [],
    pendingToolCalls: [],
    createdAt: 1,
    updatedAt: 2,
    initialContext: {
      stageId: 'stage',
      stageTitle: 'Original title',
      sceneId: 'scene',
      sceneTitle: 'Original scene',
    },
  };
}
describe.skipIf(!url)('F72 real PostgreSQL strict dialogue source', () => {
  let f: Awaited<ReturnType<typeof dialogueFixture>>;
  beforeEach(async () => {
    f = await dialogueFixture(url!);
  });
  afterEach(async () => {
    await f?.close();
  });
  const read = () =>
    readDialogueSource(f.provider, 'owner', { stageId: 'stage', chatSessionId: 'c' });
  it.each(['qa', 'discussion'] as const)(
    'reads saved %s exactly and leaves all tables unchanged',
    async (type) => {
      await f.save(chat(type, 200));
      const before = await f.dump();
      const result = await read();
      expect(result).toMatchObject({
        status: 'available',
        source: {
          type,
          status: 'completed',
          initialContext: { stageTitle: 'Original title' },
          window: { maxMessages: 200, historyCompleteness: 'window-only' },
        },
      });
      if (result.status !== 'available') throw Error('Expected source');
      expect(result.source.messages).toHaveLength(200);
      expect(result.source.messages[199]).toMatchObject({
        text: ' original 199\n',
        message: { id: 'm199', metadata: { agentId: 'tutor', interrupted: true } },
      });
      expect(await f.dump()).toEqual(before);
    },
  );
  it('distinguishes own empty, missing, another owner and deleted stage', async () => {
    await f.save(chat('qa', 0));
    expect(await read()).toMatchObject({ status: 'available', source: { messages: [] } });
    expect(
      await readDialogueSource(f.provider, 'other', { stageId: 'stage', chatSessionId: 'c' }),
    ).toEqual({ status: 'missing' });
    expect(
      await readDialogueSource(f.provider, 'owner', { stageId: 'stage', chatSessionId: 'missing' }),
    ).toEqual({ status: 'missing' });
    await f.db.query("UPDATE stage_meta SET deleted_at=NOW() WHERE stage_id='stage'");
    const before = await f.dump();
    expect(await read()).toEqual({ status: 'deleted' });
    expect(await f.dump()).toEqual(before);
  });
  it('keeps legacy background absent and follows same-ID message revisions without counting new messages', async () => {
    const source = chat();
    delete source.initialContext;
    const id = await f.save(source);
    expect(await read()).toMatchObject({ status: 'available', source: { initialContext: null } });
    source.messages[0].parts = [{ type: 'text', text: 'revised' }];
    source.updatedAt = 3;
    await f.store.appendRecord(
      buildChatRecordInit(
        id,
        {
          kind: 'chat_message',
          payloadVersion: 1,
          role: 'user',
          content: 'revised',
          message: source.messages[0],
          sessionUpdatedAt: 3,
        },
        source,
        'message:m0',
      ),
    );
    expect(await read()).toEqual({ status: 'unreadable', reason: 'incomplete_save' });
    await f.store.appendRecord(buildChatRecordInit(id, statePayload(source), source, 'state'));
    const result = await read();
    expect(result).toMatchObject({
      status: 'available',
      source: { messages: [{ text: 'revised' }] },
    });
    if (result.status === 'available') expect(result.source.messages).toHaveLength(1);
  });
  it('selects generation on equal clocks and excludes committed restore targets before cleanup', async () => {
    const base = runtimeSessionId('stage', 'owner', 'c');
    const old = await f.save(chat(), base),
      newest = await f.save(chat(), generationRuntimeSessionId(base, 2));
    const result = await read();
    expect(result).toMatchObject({
      status: 'available',
      source: { runtimeSessionId: newest, generation: 2 },
    });
    const now = new Date().toISOString();
    const marker = await f.store.createSession({
      id: restoreMarkerPrefix('stage') + 'owner:op',
      kind: 'chat',
      stageId: 'stage',
      learnerKey: 'owner',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    await f.store.appendRecord({
      id: 'targets',
      sessionId: marker.id,
      createdAt: marker.createdAt,
      payload: {
        kind: 'chat_restore_marker',
        role: 'system',
        content: '',
        runtimeSessionIds: [old, newest],
      },
    });
    expect(await read()).toMatchObject({ status: 'available' });
    await f.store.setSessionStatus(marker.id, 'completed', now);
    const before = await f.dump();
    expect(await read()).toEqual({ status: 'missing' });
    expect(await f.dump()).toEqual(before);
  });
  it('honors deletion intent before physical generation cleanup', async () => {
    await f.save(chat());
    const now = new Date().toISOString();
    await f.store.createSession({
      id: deletionMarkerId('stage', 'owner', 'c'),
      kind: 'chat-deletion',
      stageId: 'stage',
      learnerKey: 'owner',
      status: 'completed',
      createdAt: now,
      updatedAt: now,
    });
    const before = await f.dump();
    expect(await read()).toEqual({ status: 'deleted' });
    expect(await f.dump()).toEqual(before);
  });

  it.each(['latest-generation', 'deletion-marker'] as const)(
    'reports a damaged SQL kind for %s instead of hiding the row',
    async (kind) => {
      const base = await f.save(chat());
      let damagedId: string;
      if (kind === 'latest-generation') {
        damagedId = await f.save(chat(), generationRuntimeSessionId(base, 2));
      } else {
        damagedId = deletionMarkerId('stage', 'owner', 'c');
        const now = new Date().toISOString();
        await f.store.createSession({
          id: damagedId,
          kind: 'chat-deletion',
          stageId: 'stage',
          learnerKey: 'owner',
          status: 'completed',
          createdAt: now,
          updatedAt: now,
        });
      }
      await f.db.query('UPDATE runtime_sessions SET kind=$1 WHERE id=$2', [
        'quizAttempt',
        damagedId,
      ]);
      const before = await f.dump();
      expect(await read()).toEqual({ status: 'unreadable', reason: 'session_index_mismatch' });
      expect(await f.dump()).toEqual(before);
    },
  );
  it.each(['future', 'bad-state', 'missing-message', 'index'] as const)(
    'does not migrate or silently repair %s',
    async (damage) => {
      const id = await f.save(chat());
      if (damage === 'future')
        await f.db.query(
          "UPDATE runtime_sessions SET data=jsonb_set(data,'{runtimeDslVersion}','\"9.0.0\"') WHERE id=$1",
          [id],
        );
      if (damage === 'bad-state')
        await f.db.query(
          "UPDATE runtime_records SET data=jsonb_set(data,'{payload,messageIds}','[\"missing\"]') WHERE data->'payload'->>'kind'='chat_session_state'",
        );
      if (damage === 'missing-message')
        await f.db.query(
          "DELETE FROM runtime_records WHERE data->'payload'->>'kind'='chat_message'",
        );
      if (damage === 'index')
        await f.db.query(
          "UPDATE runtime_sessions SET data=jsonb_set(data,'{learnerKey}','\"other\"') WHERE id=$1",
          [id],
        );
      const before = await f.dump();
      expect((await read()).status).toBe(damage === 'future' ? 'unsupported' : 'unreadable');
      expect(await f.dump()).toEqual(before);
    },
  );
});
