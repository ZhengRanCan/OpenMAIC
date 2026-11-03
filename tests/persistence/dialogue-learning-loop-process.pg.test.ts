import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { dialogueLoopFixture } from './dialogue-learning-loop-fixture';
import { model, reply } from './dialogue-evidence-fixture';
import { memoryModel, controlledMemoryReply } from './dialogue-memory-fixture';
import { readDialogueEvidenceRun } from '@/lib/persistence/dialogue-evidence-read';
import {
  processDialogueJob,
  type DialogueLoopDeps,
} from '@/lib/server/dialogue-learning-loop/process';
import { recoverDialogueJob } from '@/lib/server/dialogue-learning-loop/recovery';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { enqueueClosedDialogueIn } from '@/lib/server/dialogue-learning-loop/enqueue';
import { DialogueLoopError } from '@/lib/dialogue/learning-loop-contracts';
import { discoverClosedDialogues } from '@/lib/server/dialogue-learning-loop/discovery';
const url = process.env.PG_CONTRACT_URL;
if (!url && process.env.STORAGE_PG_CONTRACT_REQUIRED === '1')
  throw Error('F75 requires PG_CONTRACT_URL');
describe.skipIf(!url)('real PG two-stage automatic coordination', () => {
  let f: Awaited<ReturnType<typeof dialogueLoopFixture>>,
    calls: { evidence: number; memory: number },
    deps: DialogueLoopDeps;
  beforeEach(async () => {
    f = await dialogueLoopFixture(url!);
    calls = { evidence: 0, memory: 0 };
    deps = {
      jobs: f.jobs,
      evidence: f.store,
      memory: f.service,
      config: f.config,
      settings: async () => f.settings,
      readEvidence: (owner, id) => readDialogueEvidenceRun(f.provider, owner, id),
      evidenceModel: model,
      memoryModel,
      checkEvidence: () => {},
      checkMemory: () => {},
      invokeEvidence: async () => {
        calls.evidence++;
        return reply;
      },
      invokeMemory: async (run) => {
        calls.memory++;
        return controlledMemoryReply(run);
      },
    };
  });
  afterEach(async () => {
    await f?.close();
  });
  async function run() {
    const j = await f.jobs.claim();
    expect(j).not.toBeNull();
    await processDialogueJob(j!, deps);
    return f.jobs.read('owner', j!.id);
  }
  it('automatically preserves evidence and shared Memory, with no duplicate processing', async () => {
    await f.create();
    const done = await run();
    expect(done.state).toBe('completed');
    expect(calls).toEqual({ evidence: 1, memory: 1 });
    expect(await f.jobs.claim()).toBeNull();
    expect((await f.memory.read('A')).sections.learning_experiences[0].supports[0].kind).toBe(
      'dialogue_evidence',
    );
  });
  it('uses actual separate Node workers and preserves a claim after its process exits', async () => {
    const { job } = await f.create();
    const schema = (await f.db.query('SELECT current_schema() AS name')).rows[0].name as string;
    const worker = (capture = false) =>
      new Promise<{ claimed: boolean; id: string | null }>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [path.resolve('tests/dialogue/fixtures/automatic-claim-worker.mjs')],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              F75_TEST_SCHEMA: schema,
              F75_WORKER_CAPTURE: capture ? '1' : '0',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
          },
        );
        let out = '',
          err = '';
        child.stdout.on('data', (b) => {
          out += b.toString();
        });
        child.stderr.on('data', (b) => {
          err += b.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => {
          if (code !== 0) reject(Error(err || 'worker failed'));
          else
            try {
              resolve(JSON.parse(out));
            } catch (e) {
              reject(e);
            }
        });
      });
    const result = await Promise.all([worker(), worker()]);
    expect(result.filter((r) => r.claimed)).toHaveLength(1);
    expect(result.find((r) => r.claimed)!.id).toBe(job.id);
    expect(await f.jobs.claim()).toBeNull();
    await f.db.query(
      "UPDATE dialogue_loop_jobs SET data=jsonb_set(data,'{leaseExpiresAt}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=$1",
      [job.id],
    );
    expect(await f.jobs.claim()).toBeNull();
    expect((await f.jobs.read('owner', job.id)).state).toBe('unknown');
    expect(calls).toEqual({ evidence: 0, memory: 0 });
    await recoverDialogueJob(
      'owner',
      job.id,
      { action: 'resume_saved', operationId: 'process-continue' },
      deps,
    );
    expect((await worker(true)).claimed).toBe(true);
    // The independent process captured Evidence, but died before its outer checkpoint.
    expect((await f.jobs.read('owner', job.id)).evidenceRunId).toBeNull();
    await f.db.query(
      "UPDATE dialogue_loop_jobs SET data=jsonb_set(data,'{leaseExpiresAt}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=$1",
      [job.id],
    );
    await f.jobs.claim();
    await recoverDialogueJob(
      'owner',
      job.id,
      { action: 'resume_saved', operationId: 'process-captured' },
      deps,
    );
    expect((await run()).state).toBe('completed');
    expect(calls).toEqual({ evidence: 0, memory: 1 });
  }, 60_000);
  it('legal empty finishes without a Memory update', async () => {
    deps.invokeEvidence = async () => {
      calls.evidence++;
      return { ...reply, text: '{"facts":[]}' };
    };
    await f.create();
    const done = await run();
    expect(done.state).toBe('completed');
    expect(done.memoryState).toBe('empty');
    expect(calls).toEqual({ evidence: 1, memory: 0 });
  });
  it('stopping before a new paid phase retains completed Evidence', async () => {
    deps.checkMemory = () => {
      throw new DialogueLoopError('AUTOMATIC_DISABLED');
    };
    await f.create();
    const result = await run();
    expect(result).toMatchObject({
      state: 'blocked',
      evidenceState: 'completed',
      reason: 'AUTOMATIC_DISABLED',
    });
    expect(calls).toEqual({ evidence: 1, memory: 0 });
  });
  it('a new window follows the unresolved canonical delivery instead of bypassing its unknown confirmation', async () => {
    deps.invokeMemory = async () => {
      calls.memory++;
      throw Error('unknown provider');
    };
    const first = await f.create();
    await run();
    const next = structuredClone(first.chat);
    next.updatedAt = 30;
    next.learningClosure.id = 'close-2';
    next.messages.push({ id: 'extra', role: 'user', parts: [{ type: 'text', text: '谢谢' }] });
    await f.save(next, 1);
    const second = await f.provider.withTransaction((tx) =>
      enqueueClosedDialogueIn(tx, 'owner', { stageId: 'stage', chatSessionId: next.id }, f.config),
    );
    const blocked = await run();
    expect(blocked.state).toBe('unknown');
    expect(blocked.blockingDeliveryId).not.toBeNull();
    expect(calls).toEqual({ evidence: 2, memory: 1 });
    await recoverDialogueJob(
      'owner',
      second!.id,
      {
        action: 'retry_memory',
        operationId: 'dependent-retry',
        acknowledgeAdditionalCall: true,
        acknowledgeUnknownCost: true,
      },
      deps,
    );
    deps.invokeMemory = async (r) => {
      calls.memory++;
      return controlledMemoryReply(r);
    };
    expect((await run()).state).toBe('completed');
    expect(calls).toEqual({ evidence: 2, memory: 2 });
  });
  it('unknown requires confirmation and a recovery never reextracts completed Evidence', async () => {
    deps.invokeMemory = async () => {
      calls.memory++;
      throw Error('provider unknown');
    };
    const { job } = await f.create();
    const unknown = await run();
    expect(unknown.state).toBe('unknown');
    expect(await f.jobs.claim()).toBeNull();
    await expect(
      recoverDialogueJob(
        'owner',
        job.id,
        { action: 'retry_memory', operationId: 'no-confirm', acknowledgeAdditionalCall: true },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'UNKNOWN_COST_CONFIRMATION_REQUIRED' });
    await recoverDialogueJob(
      'owner',
      job.id,
      {
        action: 'retry_memory',
        operationId: 'retry',
        acknowledgeAdditionalCall: true,
        acknowledgeUnknownCost: true,
      },
      deps,
    );
    deps.invokeMemory = async (run) => {
      calls.memory++;
      return controlledMemoryReply(run);
    };
    expect((await run()).state).toBe('completed');
    expect(calls).toEqual({ evidence: 1, memory: 2 });
    await recoverDialogueJob(
      'owner',
      job.id,
      {
        action: 'retry_memory',
        operationId: 'retry',
        acknowledgeAdditionalCall: true,
        acknowledgeUnknownCost: true,
      },
      deps,
    );
    expect(await f.jobs.claim()).toBeNull();
  });
  it('exposes the actual unknown phase after a crash before the outer checkpoint', async () => {
    const { job } = await f.create();
    const claimed = (await f.jobs.claim())!;
    const e = await f.store.prepareSnapshot(
      'owner',
      { operationId: 'crash-phase', stageId: 'stage', chatSessionId: job.chatSessionId },
      claimed.snapshot!,
      f.settings,
      model,
    );
    claimed.evidenceRunId = e.id;
    claimed.evidenceState = 'prepared';
    await f.jobs.checkpoint(claimed);
    await f.store.claim('owner', e.id, f.settings);
    await f.db.query(
      "UPDATE dialogue_evidence_runs SET data=jsonb_set(data,'{leaseExpiresAt}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=$1",
      [e.id],
    );
    await f.db.query(
      "UPDATE dialogue_loop_jobs SET data=jsonb_set(data,'{leaseExpiresAt}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=$1",
      [job.id],
    );
    expect(await f.jobs.claim()).toBeNull();
    expect(await f.jobs.read('owner', job.id)).toMatchObject({
      state: 'unknown',
      evidenceState: 'unknown',
      memoryState: 'pending',
    });
    expect(calls).toEqual({ evidence: 0, memory: 0 });
  });
  it('a dependent window automatically follows a retry completed from the original job', async () => {
    deps.invokeMemory = async () => {
      calls.memory++;
      throw Error('unknown');
    };
    const first = await f.create();
    await run();
    const chat = structuredClone(first.chat);
    chat.learningClosure.id = 'later';
    chat.messages.push({ id: 'later', role: 'user', parts: [{ type: 'text', text: '请继续' }] });
    await f.save(chat, 1);
    const second = await f.provider.withTransaction((tx) =>
      enqueueClosedDialogueIn(tx, 'owner', { stageId: 'stage', chatSessionId: chat.id }, f.config),
    );
    expect((await run()).state).toBe('unknown');
    await recoverDialogueJob(
      'owner',
      first.job.id,
      {
        action: 'retry_memory',
        operationId: 'original-retry',
        acknowledgeAdditionalCall: true,
        acknowledgeUnknownCost: true,
      },
      deps,
    );
    deps.invokeMemory = async (r) => {
      calls.memory++;
      return controlledMemoryReply(r);
    };
    await run();
    await discoverClosedDialogues(f.provider, f.config);
    expect((await run()).id).toBe(second!.id);
    expect((await f.jobs.read('owner', second!.id)).state).toBe('completed');
    expect(calls).toEqual({ evidence: 2, memory: 2 });
  });
  it('freezes both model identities before Evidence so a cross-phase change cannot call Memory', async () => {
    deps.checkMemory = () => {
      throw new DialogueLoopError('AUTOMATIC_DISABLED');
    };
    const { job } = await f.create();
    await run();
    // Reproduce the gap before Memory prepare, rather than relying on its own model guard.
    const data = await f.jobs.read('owner', job.id);
    data.memoryDeliveryId = null;
    await f.db.query('UPDATE dialogue_loop_jobs SET data=$2::jsonb WHERE id=$1', [
      job.id,
      JSON.stringify(data),
    ]);
    deps.memoryModel = { ...memoryModel, model: 'changed-model' };
    await expect(
      recoverDialogueJob('owner', job.id, { action: 'resume_saved', operationId: 'changed' }, deps),
    ).rejects.toMatchObject({ code: 'CONFIG_CHANGED' });
    expect(calls).toEqual({ evidence: 1, memory: 0 });
  });
  it('finalizes a saved Evidence reply after the capture response and outer checkpoint are lost', async () => {
    const { job } = await f.create();
    const claimed = (await f.jobs.claim())!;
    const e = await f.store.prepareSnapshot(
      'owner',
      { operationId: 'f75:e:' + job.id, stageId: 'stage', chatSessionId: job.chatSessionId },
      claimed.snapshot!,
      f.settings,
      model,
    );
    const eclaim = (await f.store.claim('owner', e.id, f.settings))!;
    // A separate worker saved the reply, then died before receiving its capture response or saving the run ID.
    await f.store.capture('owner', eclaim, reply, f.settings);
    await f.db.query(
      "UPDATE dialogue_loop_jobs SET data=jsonb_set(data,'{leaseExpiresAt}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=$1",
      [job.id],
    );
    await f.jobs.claim();
    await recoverDialogueJob(
      'owner',
      job.id,
      { action: 'resume_saved', operationId: 'saved-reply' },
      deps,
    );
    expect((await run()).state).toBe('completed');
    expect(calls).toEqual({ evidence: 0, memory: 1 });
  });
  it.each(['defer', 'not_adopt'] as const)(
    'preserves %s without automatic paid replay',
    async (action) => {
      deps.invokeMemory = async (r) => {
        calls.memory++;
        return controlledMemoryReply(r, action);
      };
      const { job } = await f.create();
      const done = await run();
      expect(done.state).toBe(action === 'defer' ? 'waiting' : 'completed');
      await discoverClosedDialogues(f.provider, f.config);
      expect(await f.jobs.claim()).toBeNull();
      expect(calls).toEqual({ evidence: 1, memory: 1 });
      if (action === 'defer')
        expect((await f.jobs.read('owner', job.id)).memoryState).toBe('deferred');
    },
  );
});
