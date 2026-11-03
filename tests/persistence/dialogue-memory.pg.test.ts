import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import {
  dialogueMemoryFixture,
  memoryModel,
  controlledMemoryReply,
} from './dialogue-memory-fixture';
const url = process.env.PG_CONTRACT_URL;
if (!url && process.env.STORAGE_PG_CONTRACT_REQUIRED === '1')
  throw Error('F74 requires PG_CONTRACT_URL');
describe.skipIf(!url)('F74 real PostgreSQL shared Memory handoff', () => {
  let f: Awaited<ReturnType<typeof dialogueMemoryFixture>>;
  beforeEach(async () => {
    f = await dialogueMemoryFixture(url!);
  });
  afterEach(async () => {
    await f?.close();
  });
  const prepare = () => f.service.prepare('owner', f.request(), memoryModel);
  it('prepares concurrently once, adopts with actual sources and never invokes duplicate delivery', async () => {
    const [a, b] = await Promise.all([prepare(), prepare()]);
    expect(a.delivery.id).toBe(b.delivery.id);
    let calls = 0;
    const invoke = async (run: Parameters<typeof controlledMemoryReply>[0]) => {
      calls++;
      return controlledMemoryReply(run);
    };
    await Promise.all([
      f.service.update('owner', a.delivery.id, memoryModel, invoke),
      f.service.update('owner', a.delivery.id, memoryModel, invoke),
    ]);
    const view = await f.service.read('owner', a.delivery.id);
    expect(view.delivery.state).toBe('completed');
    expect(calls).toBe(1);
    expect(
      view.memory!.sections.learning_experiences.some((p) =>
        p.supports.some((s) => s.kind === 'dialogue_evidence'),
      ),
    ).toBe(true);
    await f.service.update('owner', a.delivery.id, memoryModel, invoke);
    expect(calls).toBe(1);
    await expect(f.service.read('foreign', a.delivery.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it.each(['not_adopt', 'defer', 'already_represented'] as const)(
    'retains the old Memory and records %s',
    async (action) => {
      if (action === 'already_represented') {
        const { versionSource } = await import('@/lib/learner-memory/contracts');
        await f.memory.ingest('A', [
          versionSource({
            id: 'sim:A:quiz-overlap',
            kind: 'quiz_evidence',
            text: f.evidence.facts[0].evidence,
            refs: ['synthetic:quiz-overlap'],
            conditions: ['controlled overlapping source'],
            sourceNature: 'synthetic',
            occurredAt: null,
            provenance: { file: 'controlled-fixture', sha256: 'a'.repeat(64), pointer: '/0' },
          }),
        ]);
        await f.memory.update('A', 'seed-overlap', async (run) => controlledMemoryReply(run));
      }
      const a = await prepare(),
        before = await f.memory.read('A');
      const result = await f.service.update('owner', a.delivery.id, memoryModel, async (run) =>
        controlledMemoryReply(run, action),
      );
      expect(result.delivery.state).toBe(action === 'defer' ? 'deferred' : 'completed');
      expect(result.memory!.snapshot.sections).toEqual(before.snapshot.sections);
      expect(result.memoryRun!.decisions![0].action).toBe(action);
    },
  );
  it('rejects real environment mismatch and target reset', async () => {
    await f.memoryDb.query("UPDATE f68_memory_environment SET id='other'");
    await expect(prepare()).rejects.toMatchObject({ code: 'MEMORY_ENVIRONMENT_MISMATCH' });
  });
  it('reuses the original source across a new saved window without another Memory call', async () => {
    const first = await prepare();
    let calls = 0;
    await f.service.update('owner', first.delivery.id, memoryModel, async (run) => {
      calls++;
      return controlledMemoryReply(run);
    });
    const changed = structuredClone(f.chat);
    changed.updatedAt = 30;
    changed.messages.push({ id: 'new', role: 'user', parts: [{ type: 'text', text: '谢谢' }] });
    await f.save(changed, 1);
    await f.register();
    const { model, reply } = await import('./dialogue-evidence-fixture');
    const e = await f.store.prepare(
      'owner',
      { operationId: 'next-evidence', stageId: 'stage', chatSessionId: 'chat' },
      f.settings,
      model,
    );
    await f.store.capture(
      'owner',
      (await f.store.claim('owner', e.id, f.settings))!,
      reply,
      f.settings,
    );
    await f.store.finalize('owner', e.id);
    const next = await f.service.prepare(
      'owner',
      { operationId: 'next-memory', evidenceRunId: e.id },
      memoryModel,
    );
    expect(next.delivery.sources).toEqual(first.delivery.sources);
    const done = await f.service.update('owner', next.delivery.id, memoryModel, async (run) => {
      calls++;
      return controlledMemoryReply(run);
    });
    expect(done.delivery.reason).toBe('already_delivered');
    expect(calls).toBe(1);
  });
  it('captures before commit and recovers the same result with zero repeat model calls', async () => {
    const a = await prepare();
    let calls = 0;
    const capture = f.memory.store.capture.bind(f.memory.store);
    f.memory.store.capture = async () => {
      throw Error('capture unavailable');
    };
    const result = await f.service.update('owner', a.delivery.id, memoryModel, async (run) => {
      calls++;
      return controlledMemoryReply(run);
    });
    expect(result.delivery.reply).not.toBeNull();
    expect(calls).toBe(1);
    await expect(
      f.service.recover('owner', a.delivery.id, {
        action: 'confirm_paid_retry',
        operationId: 'wrong-retry',
        acknowledgeAdditionalCall: true,
        acknowledgeUnknownCost: true,
      }),
    ).rejects.toMatchObject({ code: 'SAVED_REPLY_AVAILABLE' });
    f.memory.store.capture = capture;
    const restored = await f.service.recover('owner', a.delivery.id, {
      action: 'finalize_saved_reply',
      operationId: 'restore',
    });
    expect(restored.delivery.state).toBe('completed');
    expect(calls).toBe(1);
  });
  it.each(['unknown', 'deferred', 'prepared'] as const)(
    'a new Evidence window cannot bypass the existing %s source delivery',
    async (state) => {
      const first = await prepare();
      let calls = 0;
      if (state !== 'prepared')
        await f.service.update('owner', first.delivery.id, memoryModel, async (run) => {
          calls++;
          if (state === 'unknown') throw Error('provider result unknown');
          return controlledMemoryReply(run, 'defer');
        });
      const changed = structuredClone(f.chat);
      changed.updatedAt = 30;
      changed.messages.push({ id: 'new', role: 'user', parts: [{ type: 'text', text: '谢谢' }] });
      await f.save(changed, 1);
      await f.register();
      const { model, reply } = await import('./dialogue-evidence-fixture');
      const evidence = await f.store.prepare(
        'owner',
        { operationId: 'next-evidence', stageId: 'stage', chatSessionId: 'chat' },
        f.settings,
        model,
      );
      await f.store.capture(
        'owner',
        (await f.store.claim('owner', evidence.id, f.settings))!,
        reply,
        f.settings,
      );
      await f.store.finalize('owner', evidence.id);
      const nextRequest = { operationId: 'next-memory', evidenceRunId: evidence.id };
      await expect(f.service.prepare('owner', nextRequest, memoryModel)).rejects.toMatchObject({
        code: 'SOURCE_DELIVERY_PENDING',
      });
      const target =
        state === 'prepared'
          ? first
          : await f.service.recover(
              'owner',
              first.delivery.id,
              state === 'deferred'
                ? { action: 'retry_deferred', operationId: 'explicit-retry' }
                : {
                    action: 'confirm_paid_retry',
                    operationId: 'explicit-retry',
                    acknowledgeAdditionalCall: true,
                    acknowledgeUnknownCost: true,
                  },
            );
      await f.service.update('owner', target.delivery.id, memoryModel, async (run) => {
        calls++;
        return controlledMemoryReply(run);
      });
      const next = await f.service.prepare('owner', nextRequest, memoryModel);
      const result = await f.service.update('owner', next.delivery.id, memoryModel, async (run) => {
        calls++;
        return controlledMemoryReply(run);
      });
      expect(result.delivery.reason).toBe('already_delivered');
      expect(calls).toBe(state === 'prepared' ? 1 : 2);
    },
  );
  it('marks provider uncertainty separately and requires explicit paid-retry confirmation', async () => {
    const a = await prepare();
    let calls = 0;
    const result = await f.service.update('owner', a.delivery.id, memoryModel, async () => {
      calls++;
      throw Error('provider exception');
    });
    expect(result.delivery.state).toBe('unknown');
    await f.service.update('owner', a.delivery.id, memoryModel, async (run) => {
      calls++;
      return controlledMemoryReply(run);
    });
    expect(calls).toBe(1);
    await expect(
      f.service.recover('owner', a.delivery.id, {
        action: 'confirm_paid_retry',
        operationId: 'retry',
        acknowledgeAdditionalCall: true,
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_COST_CONFIRMATION_REQUIRED' });
    const next = await f.service.recover('owner', a.delivery.id, {
      action: 'confirm_paid_retry',
      operationId: 'retry',
      acknowledgeAdditionalCall: true,
      acknowledgeUnknownCost: true,
    });
    expect(next.delivery.retryOf).toBe(a.delivery.id);
  });
});
