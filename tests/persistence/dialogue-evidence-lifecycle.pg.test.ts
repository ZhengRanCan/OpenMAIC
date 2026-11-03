import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { dialogueEvidenceFixture, model, reply } from './dialogue-evidence-fixture';
import { readDialogueEvidenceRun } from '@/lib/persistence/dialogue-evidence-read';
import {
  deleteDialogueEvidenceIn,
  rekeyDialogueEvidenceIn,
} from '@/lib/persistence/dialogue-evidence-lifecycle';
const url = process.env.PG_CONTRACT_URL;
if (!url && process.env.STORAGE_PG_CONTRACT_REQUIRED === '1')
  throw Error('F73 requires PG_CONTRACT_URL');
describe.skipIf(!url)('F73 source lifecycle PostgreSQL', () => {
  let f: Awaited<ReturnType<typeof dialogueEvidenceFixture>>;
  beforeEach(async () => {
    f = await dialogueEvidenceFixture(url!);
  });
  afterEach(async () => {
    await f?.close();
  });
  const prepare = () => f.store.prepare('owner', f.request(), f.settings, model);
  it('deletes Evidence without allowing a new operation or late result to resurrect it', async () => {
    const run = await prepare(),
      claim = await f.store.claim('owner', run.id, f.settings);
    await f.store.delete('owner', run.id);
    await expect(prepare()).rejects.toMatchObject({ code: 'EVIDENCE_DELETED' });
    await expect(f.store.capture('owner', claim!, reply, f.settings)).rejects.toMatchObject({
      code: 'INVOCATION_EXPIRED',
    });
    const read = await readDialogueEvidenceRun(f.provider, 'owner', run.id);
    expect(read).toMatchObject({ state: 'revoked', snapshot: null, facts: [], reply: null });
  });
  it('refuses deleted saved Session at read and capture, while retaining unknown paid cost', async () => {
    const run = await prepare(),
      claim = await f.store.claim('owner', run.id, f.settings);
    const { deletionMarkerId } = await import('@/lib/utils/chat-storage-core');
    await f.runtime.createSession({
      id: deletionMarkerId('stage', 'owner', 'chat'),
      stageId: 'stage',
      learnerKey: 'owner',
      kind: 'chat-deletion',
      status: 'completed',
      createdAt: new Date(100).toISOString(),
      updatedAt: new Date(100).toISOString(),
    });
    const read = await readDialogueEvidenceRun(f.provider, 'owner', run.id);
    expect(read.snapshot).toBeNull();
    expect(read.state).toBe('revoked');
    await expect(f.store.capture('owner', claim!, reply, f.settings)).rejects.toMatchObject({
      code: 'SOURCE_REVOKED',
    });
  });
  it('checks environment and binding revocation again before claim or capture', async () => {
    const run = await prepare();
    expect(await f.store.claim('owner', run.id, { ...f.settings, bindings: [] })).toBeNull();
    expect((await readDialogueEvidenceRun(f.provider, 'owner', run.id)).reason).toBe(
      'not_eligible',
    );
  });
  it('resumes only never-called work and keeps a received reply through temporary binding withdrawal', async () => {
    const run = await prepare();
    await f.store.claim('owner', run.id, { ...f.settings, bindings: [] });
    await f.store.recover(
      'owner',
      run.id,
      { action: 'resume_prepared', operationId: 'resume' },
      f.settings,
    );
    const claim = await f.store.claim('owner', run.id, f.settings);
    expect(claim).not.toBeNull();
    await expect(
      f.store.capture('owner', claim!, reply, { ...f.settings, bindings: [] }),
    ).rejects.toMatchObject({ code: 'NOT_ELIGIBLE' });
    const blocked = await readDialogueEvidenceRun(f.provider, 'owner', run.id);
    expect(blocked.reply).toEqual(reply);
    expect(blocked.state).toBe('blocked');
    await expect(
      f.store.recover(
        'owner',
        run.id,
        { action: 'resume_prepared', operationId: 'resume2' },
        f.settings,
      ),
    ).rejects.toMatchObject({ code: 'RESUME_NOT_ALLOWED' });
    const recovered = await f.store.recover(
      'owner',
      run.id,
      { action: 'finalize_saved_reply', operationId: 'capture-recovery' },
      f.settings,
    );
    expect(recovered.state).toBe('completed');
    expect(recovered.reply).toEqual(reply);
  });
  it('cleans the Stage in its deletion transaction', async () => {
    await prepare();
    await f.provider.withTransaction(async (tx) => {
      await deleteDialogueEvidenceIn(tx, 'owner', 'stage');
      await tx.query("UPDATE stage_meta SET deleted_at=now() WHERE stage_id='stage'");
    });
    expect((await f.db.query('SELECT id FROM dialogue_evidence_runs')).rows).toHaveLength(0);
    expect(
      (await f.db.query('SELECT operation_id FROM dialogue_evidence_requests')).rows,
    ).toHaveLength(0);
  });
  it('moves access on owner merge, preserving historical identity and blocking unfinished execution', async () => {
    const run = await prepare();
    await f.provider.withTransaction(async (tx) => {
      await tx.query("UPDATE stage_meta SET owner_id='account' WHERE owner_id='owner'");
      await tx.query(
        "UPDATE runtime_sessions SET learner_key='account',data=jsonb_set(data,'{learnerKey}','\"account\"') WHERE learner_key='owner'",
      );
      await rekeyDialogueEvidenceIn(tx, 'owner', 'account');
    });
    await expect(readDialogueEvidenceRun(f.provider, 'owner', run.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const read = await readDialogueEvidenceRun(f.provider, 'account', run.id);
    expect(read.state).toBe('blocked');
    expect(read.reason).toBe('OWNER_CHANGED');
    expect(read.snapshot!.ownerId).toBe('owner');
    expect(await f.store.claim('account', run.id, f.settings)).toBeNull();
  });
});
