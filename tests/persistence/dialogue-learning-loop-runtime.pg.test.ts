import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { dialogueLoopFixture } from './dialogue-learning-loop-fixture';
import { dialogueLoopRuntime } from '@/lib/persistence/dialogue-learning-loop-runtime';
import { runtimeSessionId, statePayload, buildChatRecordInit } from '@/lib/utils/chat-storage-core';
const url = process.env.PG_CONTRACT_URL;
if (!url && process.env.STORAGE_PG_CONTRACT_REQUIRED === '1')
  throw Error('F75 requires PG_CONTRACT_URL');
describe.skipIf(!url)('runtime closure transaction', () => {
  let f: Awaited<ReturnType<typeof dialogueLoopFixture>>;
  beforeEach(async () => {
    f = await dialogueLoopFixture(url!);
  });
  afterEach(async () => {
    await f?.close();
  });
  it('queues only after the final status commit and freezes the precise source', async () => {
    const runtime = dialogueLoopRuntime(f.runtime, f.provider, () => f.config);
    const chat = {
      ...structuredClone(f.chat),
      id: 'runtime-chat',
      learningRunId: 'run',
      learningClosure: { id: 'close-1', source: 'manual_stop' as const },
    };
    const id = runtimeSessionId('stage', 'owner', chat.id);
    await runtime.createSession({
      id,
      stageId: 'stage',
      learnerKey: 'owner',
      kind: 'chat',
      status: 'active',
      createdAt: new Date(1).toISOString(),
      updatedAt: new Date(2).toISOString(),
    });
    for (const m of chat.messages)
      await runtime.appendRecord(
        buildChatRecordInit(
          id,
          {
            kind: 'chat_message',
            payloadVersion: 1,
            role: m.role,
            content: m.parts
              .filter((p) => p.type === 'text')
              .map((p) => p.text)
              .join(''),
            message: m,
            sessionUpdatedAt: chat.updatedAt,
          },
          chat,
          'message:' + m.id,
        ),
      );
    await runtime.appendRecord(buildChatRecordInit(id, statePayload(chat), chat, 'state'));
    expect((await f.db.query('SELECT id FROM dialogue_loop_jobs')).rows).toHaveLength(0);
    await f.db.query(
      "CREATE FUNCTION reject_queue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected queue failure'; END $$",
    );
    await f.db.query(
      'CREATE TRIGGER reject_queue BEFORE INSERT ON dialogue_loop_jobs FOR EACH ROW EXECUTE FUNCTION reject_queue()',
    );
    await expect(
      runtime.setSessionStatus(id, 'completed', new Date(2).toISOString()),
    ).rejects.toThrow('injected queue failure');
    expect((await runtime.getSession(id))!.status).toBe('active');
    expect((await f.db.query('SELECT id FROM dialogue_loop_jobs')).rows).toHaveLength(0);
    await f.db.query('DROP TRIGGER reject_queue ON dialogue_loop_jobs');
    await runtime.setSessionStatus(id, 'completed', new Date(2).toISOString());
    const jobs = await f.db.query('SELECT data FROM dialogue_loop_jobs');
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0].data.state).toBe('queued');
    await runtime.setSessionStatus(id, 'completed', new Date(2).toISOString());
    expect((await f.db.query('SELECT id FROM dialogue_loop_jobs')).rows).toHaveLength(1);
  });
  it('does not queue a partial source or a restored completion without a closure', async () => {
    const runtime = dialogueLoopRuntime(f.runtime, f.provider, () => f.config);
    const chat = { ...structuredClone(f.chat), id: 'partial', learningRunId: 'run' };
    const id = runtimeSessionId('stage', 'owner', chat.id);
    await runtime.createSession({
      id,
      stageId: 'stage',
      learnerKey: 'owner',
      kind: 'chat',
      status: 'active',
      createdAt: new Date(1).toISOString(),
      updatedAt: new Date(2).toISOString(),
    });
    await runtime.appendRecord(buildChatRecordInit(id, statePayload(chat), chat, 'state'));
    await runtime.setSessionStatus(id, 'completed', new Date(2).toISOString());
    expect((await f.db.query('SELECT id FROM dialogue_loop_jobs')).rows).toHaveLength(0);
  });
});
