import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { dialogueLoopFixture } from './dialogue-learning-loop-fixture';
import {
  restrictDialogueLoopIn,
  rekeyDialogueLoopIn,
} from '@/lib/persistence/dialogue-learning-loop-lifecycle';
import { dialogueLoopRuntime } from '@/lib/persistence/dialogue-learning-loop-runtime';
import { deletionMarkerPrefix, CHAT_DELETION_KIND } from '@/lib/utils/chat-storage-core';
import { runtimeSessionId } from '@/lib/utils/chat-storage-core';
import { enqueueClosedDialogueIn } from '@/lib/server/dialogue-learning-loop/enqueue';
const url = process.env.PG_CONTRACT_URL;
if (!url && process.env.STORAGE_PG_CONTRACT_REQUIRED === '1')
  throw Error('F75 requires PG_CONTRACT_URL');
describe.skipIf(!url)('automatic source lifecycle', () => {
  let f: Awaited<ReturnType<typeof dialogueLoopFixture>>;
  beforeEach(async () => {
    f = await dialogueLoopFixture(url!);
  });
  afterEach(async () => {
    await f?.close();
  });
  it('revokes and redacts closed work; old workers cannot checkpoint after Stage deletion', async () => {
    await f.create();
    const claimed = await f.jobs.claim();
    await f.provider.withTransaction((tx) =>
      restrictDialogueLoopIn(tx, 'owner', { stageId: 'stage' }),
    );
    expect((await f.jobs.read('owner', claimed!.id)).snapshot).toBeNull();
    await expect(f.jobs.checkpoint(claimed!)).rejects.toMatchObject({ code: 'JOB_CLAIM_EXPIRED' });
    expect(await f.jobs.claim()).toBeNull();
  });
  it('redacts and revokes under owner rekey instead of rebinding the student', async () => {
    const { job } = await f.create();
    await f.provider.withTransaction((tx) => rekeyDialogueLoopIn(tx, 'owner', 'new-owner'));
    await expect(f.jobs.read('owner', job.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await f.jobs.read('new-owner', job.id)).toMatchObject({
      state: 'revoked',
      snapshot: null,
      binding: null,
      token: null,
    });
  });
  it('a chat tombstone revokes existing jobs even when automatic scheduling has been switched off', async () => {
    const { job, chat } = await f.create();
    const runtime = dialogueLoopRuntime(f.runtime, f.provider, () => null);
    const now = new Date().toISOString();
    await runtime.createSession({
      id: deletionMarkerPrefix('stage') + encodeURIComponent(chat.id) + ':owner',
      kind: CHAT_DELETION_KIND,
      stageId: 'stage',
      learnerKey: 'owner',
      status: 'completed',
      createdAt: now,
      updatedAt: now,
    });
    expect(await f.jobs.read('owner', job.id)).toMatchObject({ state: 'revoked', snapshot: null });
  });
  it.each(['session', 'learner', 'stage', 'all'] as const)(
    'Runtime %s deletion redacts frozen work even with automatic processing off',
    async (mode) => {
      const { job, chat } = await f.create();
      const runtime = dialogueLoopRuntime(f.runtime, f.provider, () => null);
      if (mode === 'session')
        await runtime.deleteSession(runtimeSessionId('stage', 'owner', chat.id));
      if (mode === 'learner') await runtime.deleteLearnerRuntime('stage', 'owner');
      if (mode === 'stage') await runtime.deleteStageRuntime('stage');
      if (mode === 'all') await runtime.deleteAllRuntime();
      expect(await f.jobs.read('owner', job.id)).toMatchObject({
        state: 'revoked',
        snapshot: null,
        binding: null,
      });
    },
  );
  it('retiring an older saved Runtime generation preserves the current logical Session and its work', async () => {
    const { job, chat } = await f.create();
    chat.messages.push({ id: 'new', role: 'user', parts: [{ type: 'text', text: '新的求助' }] });
    chat.updatedAt = 10;
    chat.learningClosure.id = 'new-close';
    await f.save(chat, 1);
    const next = await f.provider.withTransaction((tx) =>
      enqueueClosedDialogueIn(tx, 'owner', { stageId: 'stage', chatSessionId: chat.id }, f.config),
    );
    expect(next!.id).not.toBe(job.id);
    const runtime = dialogueLoopRuntime(f.runtime, f.provider, () => null);
    await runtime.deleteSession(runtimeSessionId('stage', 'owner', chat.id));
    expect(await f.jobs.read('owner', job.id)).toMatchObject({ state: 'queued' });
    expect(await f.jobs.read('owner', next!.id)).toMatchObject({ state: 'queued' });
    const row = await f.db.query(
      'SELECT revoked FROM dialogue_loop_sessions WHERE chat_session_id=$1',
      [chat.id],
    );
    expect(row.rows[0].revoked).toBe(false);
  });
});
