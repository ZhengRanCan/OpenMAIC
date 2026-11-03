import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dialogueEvidenceFixture, model, reply } from './dialogue-evidence-fixture';
import { readDialogueEvidenceRun } from '@/lib/persistence/dialogue-evidence-read';
const url = process.env.PG_CONTRACT_URL;
if (!url && process.env.STORAGE_PG_CONTRACT_REQUIRED === '1')
  throw Error('F73 requires PG_CONTRACT_URL');
describe.skipIf(!url)('F73 real PostgreSQL Evidence', () => {
  let f: Awaited<ReturnType<typeof dialogueEvidenceFixture>>;
  beforeEach(async () => {
    f = await dialogueEvidenceFixture(url!);
  });
  afterEach(async () => {
    await f?.close();
  });
  const prepare = () => f.store.prepare('owner', f.request(), f.settings, model);
  it('freezes source, deduplicates concurrent prepare and claim, captures exactly once and reads after restart', async () => {
    const runs = await Promise.all([prepare(), prepare()]);
    expect(runs[0].id).toBe(runs[1].id);
    const claims = await Promise.all([
      f.store.claim('owner', runs[0].id, f.settings),
      f.store.claim('owner', runs[0].id, f.settings),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await f.store.capture('owner', claims.find(Boolean)!, reply, f.settings);
    await f.store.capture('owner', claims.find(Boolean)!, reply, f.settings);
    const run = await f.store.finalize('owner', runs[0].id);
    expect(run.state).toBe('completed');
    expect(run.facts[0].refs).toEqual(['t', 's']);
    expect((await readDialogueEvidenceRun(f.provider, 'owner', run.id)).snapshot).toEqual(
      run.snapshot,
    );
    await expect(readDialogueEvidenceRun(f.provider, 'foreign', run.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('blocks missing or mismatched bindings and generation proof without claiming', async () => {
    for (const settings of [
      { ...f.settings, bindings: [] },
      { ...f.settings, memoryEnvironmentId: 'wrong' },
    ]) {
      const run = await f.store.prepare('owner', f.request(), settings, model);
      expect(run.state).toBe('blocked');
      expect(run.reason).toBe('not_eligible');
    }
    await f.db.query("UPDATE generation_runs SET input='{" + '"simulatedLearner":"B"' + "}'");
    expect((await prepare()).state).toBe('blocked');
  });
  it('accepts new content but keeps old source and shared message versions', async () => {
    const first = await prepare();
    const changed = structuredClone(f.chat);
    changed.updatedAt = 20;
    changed.messages.push({ id: 's2', role: 'user', parts: [{ type: 'text', text: '再问一下' }] });
    await f.save(changed, 1);
    await f.register();
    const second = await prepare();
    expect(second.id).not.toBe(first.id);
    const old = await readDialogueEvidenceRun(f.provider, 'owner', first.id);
    expect(old.snapshot!.messages).toHaveLength(2);
    expect(old.context!.messageVersions.s).toBe(second.context!.messageVersions.s);
  });
  it('expires to unknown, refuses automatic retry, and makes explicit confirmation idempotent', async () => {
    const run = await prepare();
    const claim = await f.store.claim('owner', run.id, f.settings);
    await f.db.query(
      `UPDATE dialogue_evidence_runs SET data=jsonb_set(data,'{leaseExpiresAt}','"2000-01-01T00:00:00Z"') WHERE id=$1`,
      [run.id],
    );
    const expiredRead = await readDialogueEvidenceRun(f.provider, 'owner', run.id);
    expect(expiredRead.state).toBe('unknown');
    expect(expiredRead.token).toBeNull();
    expect(await f.store.claim('owner', run.id, f.settings)).toBeNull();
    expect((await readDialogueEvidenceRun(f.provider, 'owner', run.id)).state).toBe('unknown');
    const recovery = {
      action: 'confirm_paid_retry' as const,
      operationId: 'recovery',
      acknowledgeUnknownCost: true as const,
    };
    const retry = await f.store.recover('owner', run.id, recovery, f.settings);
    expect((await f.store.recover('owner', run.id, recovery, f.settings)).id).toBe(retry.id);
    expect(retry.retryOf).toBe(run.id);
    await expect(f.store.capture('owner', claim!, reply, f.settings)).rejects.toMatchObject({
      code: 'INVOCATION_EXPIRED',
    });
  });
  it('distinguishes empty, invalid, truncated and unknown from success', async () => {
    const run = await prepare();
    const claim = await f.store.claim('owner', run.id, f.settings);
    await f.store.capture('owner', claim!, { ...reply, text: '{"facts":[]}' }, f.settings);
    expect((await f.store.finalize('owner', run.id)).state).toBe('empty');
    expect((await prepare()).id).toBe(run.id);
  });
  it.each([
    ['invalid', 'stop', '{"facts":[{"type":"question_help","evidence":"问","refs":["t"]}]}'],
    ['truncated', 'length', '{"facts":[]}'],
    ['unknown', 'unknown', ''],
  ])(
    'persists %s with the original bytes rather than a legal empty',
    async (state, finishReason, text) => {
      const run = await prepare(),
        claim = await f.store.claim('owner', run.id, f.settings);
      await f.store.capture('owner', claim!, { ...reply, text, finishReason }, f.settings);
      const saved = await f.store.finalize('owner', run.id);
      expect(saved.state).toBe(state);
      expect(saved.reply!.text).toBe(text);
      expect(saved.facts).toEqual([]);
    },
  );
  it('blocks oversized input with no claim and accepts legacy absent background with exact registration', async () => {
    const legacy = structuredClone(f.chat);
    delete legacy.initialContext;
    legacy.updatedAt = 30;
    await f.save(legacy, 1);
    await f.register();
    const prepared = await prepare();
    expect(prepared.state).toBe('prepared');
    expect(prepared.snapshot!.initialContext).toBeNull();
    const large = structuredClone(legacy);
    large.updatedAt = 40;
    large.messages[1].parts = [{ type: 'text', text: '字'.repeat(50000) }];
    await f.save(large, 2);
    await f.register();
    const blocked = await prepare();
    expect(blocked.reason).toBe('input_too_large');
    expect(await f.store.claim('owner', blocked.id, f.settings)).toBeNull();
    expect(blocked.context!.text).toContain('字'.repeat(50000));
  });
  it('preserves immutable support after a 200-message rotation and detects revisions of the same message', async () => {
    const first = await prepare();
    const revised = structuredClone(f.chat);
    revised.updatedAt = 20;
    revised.messages[1].parts = [{ type: 'text', text: '5' }];
    await f.save(revised, 1);
    await f.register();
    const second = await prepare();
    expect(first.context!.messageVersions.s).not.toBe(second.context!.messageVersions.s);
    const rotated = structuredClone(f.chat);
    rotated.updatedAt = 30;
    rotated.messages = Array.from({ length: 200 }, (_, i) => ({
      id: 'new-' + i,
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: '后续' }],
    }));
    await f.save(rotated, 2);
    await f.register();
    const third = await prepare();
    expect(third.snapshot!.messages).toHaveLength(200);
    expect(
      (await readDialogueEvidenceRun(f.provider, 'owner', first.id)).snapshot!.messages[1].text,
    ).toBe('4');
  });
  it('does not reinvoke on a lost capture COMMIT response or simultaneous extraction', async () => {
    const { extractDialogueEvidence } = await import('@/lib/server/dialogue-evidence');
    const run = await prepare();
    let calls = 0,
      captureAttempts = 0;
    const store = {
      claim: f.store.claim.bind(f.store),
      finalize: f.store.finalize.bind(f.store),
      capture: async (...args: Parameters<typeof f.store.capture>) => {
        await f.store.capture(...args);
        if (++captureAttempts === 1) throw Error('lost COMMIT response');
      },
    };
    const extract = () =>
      extractDialogueEvidence(
        'owner',
        run.id,
        model,
        store,
        () => readDialogueEvidenceRun(f.provider, 'owner', run.id),
        async () => {
          calls++;
          return reply;
        },
        async () => f.settings,
      );
    await Promise.all([extract(), extract()]);
    expect(calls).toBe(1);
    expect(captureAttempts).toBe(2);
    expect((await readDialogueEvidenceRun(f.provider, 'owner', run.id)).state).toBe('completed');
  });
});
