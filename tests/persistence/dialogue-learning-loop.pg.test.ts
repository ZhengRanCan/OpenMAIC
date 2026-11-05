import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { dialogueLoopFixture } from './dialogue-learning-loop-fixture';
import {
  activateDialogueLoop,
  noteDialogueSessionCreatedIn,
} from '@/lib/server/dialogue-learning-loop/registration';
import { enqueueClosedDialogueIn } from '@/lib/server/dialogue-learning-loop/enqueue';
import { DIALOGUE_PROMPT_VERSION } from '@/lib/dialogue/evidence-contracts';
import { digest } from '@/lib/learner-memory/contracts';
const url = process.env.PG_CONTRACT_URL;
if (!url && process.env.STORAGE_PG_CONTRACT_REQUIRED === '1')
  throw Error('F75 requires PG_CONTRACT_URL');
describe.skipIf(!url)('persistent dialogue closure versions', () => {
  let f: Awaited<ReturnType<typeof dialogueLoopFixture>>;
  beforeEach(async () => {
    f = await dialogueLoopFixture(url!);
  });
  afterEach(async () => {
    await f?.close();
  });
  it('baselines existing logical Sessions and does not promote them on restart or runtime replacement', async () => {
    await activateDialogueLoop(f.provider, f.config);
    await f.provider.withTransaction((tx) =>
      noteDialogueSessionCreatedIn(tx, 'owner', 'stage', 'chat', f.config),
    );
    const r = await f.db.query(
      "SELECT is_new FROM dialogue_loop_sessions WHERE chat_session_id='chat'",
    );
    expect(r.rows[0].is_new).toBe(false);
    await expect(
      activateDialogueLoop(f.provider, { ...f.config, conditions: ['changed'] }),
    ).rejects.toThrow('CONFIG_CHANGED');
  });
  it('freezes a source once, deduplicates concurrent close events and ignores technical time', async () => {
    const { chat, job } = await f.create();
    expect(job.state).toBe('queued');
    expect(job.binding?.student).toBe('A');
    const copies = await Promise.all(
      [1, 2].map(() =>
        f.provider.withTransaction((tx) =>
          enqueueClosedDialogueIn(
            tx,
            'owner',
            { stageId: 'stage', chatSessionId: chat.id },
            f.config,
          ),
        ),
      ),
    );
    expect(copies.map((j) => j!.id)).toEqual([job.id, job.id]);
    const changed = structuredClone(chat);
    changed.updatedAt = 30;
    changed.messages.push({
      id: 'new-message',
      role: 'user',
      parts: [{ type: 'text', text: '再问一个问题' }],
    });
    changed.learningClosure.id = 'close-2';
    await f.save(changed, 1);
    const next = await f.provider.withTransaction((tx) =>
      enqueueClosedDialogueIn(tx, 'owner', { stageId: 'stage', chatSessionId: chat.id }, f.config),
    );
    expect(next!.id).not.toBe(job.id);
    expect((await f.jobs.read('owner', job.id)).snapshot!.messages).toHaveLength(2);
    const { model } = await import('./dialogue-evidence-fixture');
    const evidence = await f.store.prepareSnapshot(
      'owner',
      { operationId: 'frozen-prepare', stageId: 'stage', chatSessionId: chat.id },
      job.snapshot!,
      f.settings,
      model,
    );
    expect(evidence.snapshot!.messages).toHaveLength(2);
    expect(evidence.snapshot!.contentDigest).toBe(job.snapshot!.contentDigest);
  });
  it('never invents a closure or trusts an unregistered/foreign run', async () => {
    const chat = { ...structuredClone(f.chat), id: 'unqualified' };
    await f.save(chat);
    expect(
      await f.provider.withTransaction((tx) =>
        enqueueClosedDialogueIn(
          tx,
          'owner',
          { stageId: 'stage', chatSessionId: chat.id },
          f.config,
        ),
      ),
    ).toBeNull();
    const { job } = await f.create('qualified');
    await expect(f.jobs.read('foreign', job.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('keeps an existing job on its original Prompt when the same closure is rescanned', async () => {
    const { job } = await f.create();
    expect(job.evidencePromptVersion).toBe(DIALOGUE_PROMPT_VERSION);
    expect(job.key).toBe(
      digest({
        owner: job.ownerId,
        stageId: job.stageId,
        chatSessionId: job.chatSessionId,
        content: job.snapshot!.contentDigest,
        prompt: 'dialogue-prompt.v1',
        config: f.config,
      }),
    );
    await f.db.query(
      "UPDATE dialogue_loop_jobs SET data=data-'evidencePromptVersion' WHERE id=$1",
      [job.id],
    );
    const existing = await f.provider.withTransaction((tx) =>
      enqueueClosedDialogueIn(
        tx,
        'owner',
        { stageId: job.stageId, chatSessionId: job.chatSessionId },
        f.config,
      ),
    );
    expect(existing?.id).toBe(job.id);
    expect(existing?.evidencePromptVersion).toBeUndefined();
    expect((await f.db.query('SELECT id FROM dialogue_loop_jobs')).rows).toHaveLength(1);
  });
  it('claims once across workers and never automatically reclaims an expired invocation', async () => {
    const { job } = await f.create();
    const claims = await Promise.all([f.jobs.claim(), f.jobs.claim()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await f.db.query(
      "UPDATE dialogue_loop_jobs SET data=jsonb_set(data,'{leaseExpiresAt}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=$1",
      [job.id],
    );
    expect(await f.jobs.claim()).toBeNull();
    expect((await f.jobs.read('owner', job.id)).state).toBe('unknown');
  });
});
