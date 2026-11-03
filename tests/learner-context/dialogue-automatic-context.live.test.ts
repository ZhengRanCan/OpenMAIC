import { it, expect, vi } from 'vitest';
import {
  buildPreclassLearnerContext,
  assertPreclassContextCurrent,
} from '@/lib/server/preclass-learner-context';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { dialogueLoopFixture } from '../persistence/dialogue-learning-loop-fixture';
import { processDialogueJob } from '@/lib/server/dialogue-learning-loop/process';
import { model, reply } from '../persistence/dialogue-evidence-fixture';
import { memoryModel, controlledMemoryReply } from '../persistence/dialogue-memory-fixture';
import { readDialogueEvidenceRun } from '@/lib/persistence/dialogue-evidence-read';
import { ensureMemorySchema } from '@/lib/persistence/learner-memory-schema';
import { invokeMemorySelectionModel } from '@/lib/server/learner-memory-selection-model';
import { resolveModel } from '@/lib/server/resolve-model';
import { readSimulatedLearnerMemory } from '@/lib/server/simulated-learner-memory';
import { PreclassLearnerContextError } from '@/lib/learner-context/contracts';
const authority = vi.hoisted(() => ({
  current: undefined as
    | import('@/lib/learner-memory/dialogue-contracts').DialogueSourceAuthority
    | undefined,
}));
vi.mock('@/lib/server/dialogue-memory-authority', async (original) => {
  const actual = await original<typeof import('@/lib/server/dialogue-memory-authority')>();
  return {
    ...actual,
    createDialogueMemoryAuthority: (
      ...args: Parameters<typeof actual.createDialogueMemoryAuthority>
    ) =>
      args[0] || !authority.current
        ? actual.createDialogueMemoryAuthority(...args)
        : authority.current,
  };
});

it.skipIf(process.env.F75_CONTEXT_CHECKPOINT !== '1')(
  'F75 live-002 formal preclass selection input checkpoint; no model invocation',
  async () => {
    if (
      process.env.F75_BATCH_ID !== '002' ||
      !process.env.DATABASE_URL?.endsWith('/f75_app002') ||
      !process.env.MEMORY_DATABASE_URL?.endsWith('/f75_memory002')
    )
      throw Error('F75_LIVE002_ISOLATION_REQUIRED');
    const dir = path.resolve(process.env.F75_ARTIFACT_DIR ?? '');
    if (!dir.replaceAll('\\', '/').endsWith('/docs/log/artifacts/F75/live-002'))
      throw Error('F75_ARTIFACT_DIR_REQUIRED');
    const batch = JSON.parse(await readFile(path.join(dir, 'batch.json'), 'utf8'));
    process.env.OPENMAIC_SIMULATED_LEARNING_LOOP = JSON.stringify({
      sourceNature: 'proxy',
      conditions: [
        'F75 isolated synthetic classroom; operator knows reference answers; not real learner evidence',
      ],
      memoryEnvironmentId: batch.environmentId,
    });
    process.env.OPENMAIC_DIALOGUE_EVIDENCE_BINDINGS_FILE = '';
    const provider = await getServerPersistenceProvider(process.env.DATABASE_URL!);
    try {
      const formal = await readSimulatedLearnerMemory('A');
      expect(formal.usable.revision).toBeGreaterThan(0);
      expect(formal.coverage.some((s) => s.source_id.includes(':dialogue:') && s.valid)).toBe(true);
      const resolved = await resolveModel({
        stage: 'scene-outlines-stream',
        workspaceId: batch.owner,
        modelString: batch.model,
      });
      let selectedInput: unknown = null,
        checkpoint = false;
      await expect(
        buildPreclassLearnerContext(
          { student: 'A', task: batch.inputs.nextClass, content: {} },
          {
            select: async (prompt) => {
              selectedInput = JSON.parse(prompt.user);
              return invokeMemorySelectionModel({
                resolvedModel: resolved,
                usageLabel: 'f75-live002-read-checkpoint',
                prompt,
                beforeSelect: async () => {
                  checkpoint = true;
                  throw new PreclassLearnerContextError('F75_READ_CHECKPOINT_REACHED');
                },
              });
            },
          },
        ),
      ).rejects.toMatchObject({ code: 'F75_READ_CHECKPOINT_REACHED' });
      expect(checkpoint).toBe(true);
      expect((await readSimulatedLearnerMemory('A')).usable.revision).toBe(formal.usable.revision);
      const input = selectedInput as { memory: { sources: { kind: string }[] }[] };
      expect(input.memory.some((p) => p.sources.some((s) => s.kind === 'dialogue_evidence'))).toBe(
        true,
      );
      await writeFile(
        path.join(dir, 'formal-selection-checkpoint.json'),
        JSON.stringify(
          {
            checkpoint: true,
            formalMemoryRevision: formal.usable.revision,
            formalCoverage: formal.coverage,
            selectedInput,
            modelCalls: 0,
            selectionResultProduced: false,
            nextClassCreated: false,
            fullCourseGenerated: false,
            limitation:
              'Stopped at the production selector beforeSelect hook; no actual model selection result or new generation run.',
          },
          null,
          2,
        ) + '\n',
        { flag: 'wx' },
      );
    } finally {
      await provider.pool.end();
    }
  },
);
const contractUrl = process.env.PG_CONTRACT_URL;
if (!contractUrl && process.env.STORAGE_PG_CONTRACT_REQUIRED === '1')
  throw Error('F75 requires PG_CONTRACT_URL');
it.skipIf(!contractUrl)(
  'automatically adopted Dialogue reaches formal next-class selection with scheduling off; revoked support invalidates it',
  async () => {
    if (new URL(contractUrl!).pathname !== '/f75_contract')
      throw Error('F75 dedicated contract DB required');
    const f = await dialogueLoopFixture(contractUrl!),
      admin = new Pool({ connectionString: contractUrl });
    const oldUrl = process.env.MEMORY_DATABASE_URL,
      oldEnabled = process.env.OPENMAIC_AUTOMATIC_DIALOGUE_LOOP;
    let fixed: Pool | undefined,
      created = false;
    try {
      await f.create();
      const job = (await f.jobs.claim())!;
      await processDialogueJob(job, {
        jobs: f.jobs,
        evidence: f.store,
        memory: f.service,
        config: f.config,
        settings: async () => f.settings,
        evidenceModel: model,
        memoryModel,
        readEvidence: (o, id) => readDialogueEvidenceRun(f.provider, o, id),
        invokeEvidence: async () => reply,
        invokeMemory: async (r) => controlledMemoryReply(r),
        checkEvidence: () => {},
        checkMemory: () => {},
      });
      expect((await f.jobs.read('owner', job.id)).state).toBe('completed');
      await admin.query('CREATE SCHEMA f67_simulated_memory');
      created = true;
      fixed = new Pool({
        connectionString: contractUrl,
        options: '-c search_path=f67_simulated_memory',
      });
      await ensureMemorySchema(fixed);
      await fixed.query(
        'CREATE TABLE f68_memory_environment(singleton BOOLEAN PRIMARY KEY,id TEXT)',
      );
      await fixed.query('INSERT INTO f68_memory_environment VALUES(true,$1)', [
        f.settings.memoryEnvironmentId,
      ]);
      for (const row of (await f.memoryDb.query('SELECT * FROM learner_memory_states')).rows)
        await fixed.query('INSERT INTO learner_memory_states VALUES($1,$2,$3,$4)', [
          row.namespace,
          row.learner_key,
          row.snapshot,
          row.maintenance,
        ]);
      for (const r of (await f.memoryDb.query('SELECT * FROM learner_memory_sources')).rows)
        await fixed.query(
          'INSERT INTO learner_memory_sources(namespace,learner_key,source_id,version,data,valid,current,processed)VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            r.namespace,
            r.learner_key,
            r.source_id,
            r.version,
            r.data,
            r.valid,
            r.current,
            r.processed,
          ],
        );
      authority.current = f.memory.provider.sourceAuthority;
      process.env.MEMORY_DATABASE_URL = contractUrl;
      process.env.OPENMAIC_AUTOMATIC_DIALOGUE_LOOP = 'false';
      let selectedCalls = 0;
      const context = await buildPreclassLearnerContext(
        { student: 'A', task: '下一课堂复习提示后的密度计算', content: {} },
        {
          select: async (prompt) => {
            selectedCalls++;
            const input = JSON.parse(prompt.user);
            const p = input.memory.find((p: { sources: { kind: string }[] }) =>
              p.sources.some((s) => s.kind === 'dialogue_evidence'),
            );
            expect(p).toBeDefined();
            return JSON.stringify({
              selected: [{ pieceId: p.pieceId, reason: '手写控制选择，不是真实模型' }],
            });
          },
        },
      );
      expect(selectedCalls).toBe(1);
      expect(context.memoryRevision).toBeGreaterThan(0);
      expect(context.selected[0].supports[0].kind).toBe('dialogue_evidence');
      await assertPreclassContextCurrent(context);
      await f.store.delete('owner', job.evidenceRunId!);
      await expect(assertPreclassContextCurrent(context)).rejects.toMatchObject({
        code: 'LEARNER_MEMORY_RECHECK_REQUIRED',
      });
    } finally {
      authority.current = undefined;
      if (oldUrl === undefined) delete process.env.MEMORY_DATABASE_URL;
      else process.env.MEMORY_DATABASE_URL = oldUrl;
      if (oldEnabled === undefined) delete process.env.OPENMAIC_AUTOMATIC_DIALOGUE_LOOP;
      else process.env.OPENMAIC_AUTOMATIC_DIALOGUE_LOOP = oldEnabled;
      await fixed?.end();
      if (created) await admin.query('DROP SCHEMA f67_simulated_memory CASCADE');
      await admin.end();
      await f.close();
    }
  },
);

/** Explicit readback only: real formal reader/selector protocol, hand-authored selection, zero model calls. */
it.skipIf(process.env.F75_CONTEXT_READBACK !== '1')(
  'F75 next-class formal context readback without paid selection',
  async () => {
    const batchId = process.env.F75_BATCH_ID ?? '001';
    const suffix = batchId === '001' ? '' : batchId;
    if (
      !['001', '002', '003'].includes(batchId) ||
      !process.env.DATABASE_URL?.endsWith('/f75_app' + suffix) ||
      !process.env.MEMORY_DATABASE_URL?.endsWith('/f75_memory' + suffix)
    )
      throw Error('F75_ISOLATED_DATABASES_REQUIRED');
    const dir = path.resolve(process.env.F75_ARTIFACT_DIR ?? '');
    if (!dir.replaceAll('\\', '/').endsWith('/docs/log/artifacts/F75/live-' + batchId))
      throw Error('F75_ARTIFACT_DIR_REQUIRED');
    const batch = JSON.parse(await readFile(path.join(dir, 'batch.json'), 'utf8'));
    process.env.OPENMAIC_SIMULATED_LEARNING_LOOP = JSON.stringify({
      sourceNature: 'proxy',
      conditions: [
        'F75 isolated synthetic classroom; operator knows reference answers; not real learner evidence',
      ],
      memoryEnvironmentId: batch.environmentId,
    });
    process.env.OPENMAIC_DIALOGUE_EVIDENCE_BINDINGS_FILE = '';
    const provider = await getServerPersistenceProvider(process.env.DATABASE_URL!);
    let selectorCalls = 0;
    let selectedInput: unknown = null;
    try {
      const context = await buildPreclassLearnerContext(
        { student: 'A', task: batch.inputs.nextClass, content: {} },
        {
          select: async (prompt) => {
            selectorCalls++;
            selectedInput = JSON.parse(prompt.user);
            const candidates = (
              selectedInput as { memory: { pieceId: string; sources: { kind: string }[] }[] }
            ).memory;
            return JSON.stringify({
              selected: candidates
                .filter((p) => p.sources.some((s) => s.kind === 'dialogue_evidence'))
                .map((p) => ({
                  pieceId: p.pieceId,
                  reason: '手写零付费读取演练：下一课堂检查Dialogue支持；不是模型选择结果。',
                })),
            });
          },
        },
      );
      const completed = await provider.pool.query(
        "SELECT id FROM dialogue_loop_jobs WHERE state='completed' AND data->>'memoryState'='completed'",
      );
      if (completed.rows.length) {
        expect(context.memoryRevision).toBeGreaterThan(0);
        expect(
          context.selected.some((p) => p.supports.some((s) => s.kind === 'dialogue_evidence')),
        ).toBe(true);
      } else {
        // The 503-stopped batch did not reach Memory. This must remain visibly incomplete.
        expect(
          context.selected.filter((p) => p.supports.some((s) => s.kind === 'dialogue_evidence')),
        ).toEqual([]);
      }
      await writeFile(
        path.join(dir, 'formal-context-control.json'),
        JSON.stringify(
          {
            control: true,
            modelCalls: 0,
            selectorCalls,
            selectedInput,
            context,
            automaticLoopCompleted: completed.rows.length > 0,
            actualNextClassGeneration: false,
          },
          null,
          2,
        ) + '\n',
        { flag: 'wx' },
      );
    } finally {
      await provider.pool.end();
    }
  },
);

function assertCompletedGatewayRecords(records: { state: string; usage: unknown }[]) {
  if (
    !records.length ||
    records.some((r) => {
      if (r.state !== 'completed' || !r.usage || typeof r.usage !== 'object') return true;
      const u = r.usage as Record<string, unknown>;
      return ['prompt_tokens', 'completion_tokens', 'total_tokens'].some(
        (k) => typeof u[k] !== 'number' || !Number.isFinite(u[k]) || (u[k] as number) < 0,
      );
    })
  )
    throw Error('F75_GATEWAY_FAILED_OR_UNKNOWN_NO_RETRY');
}
it.each([
  null,
  {},
  { prompt_tokens: 1, completion_tokens: 1 },
  { prompt_tokens: 1, completion_tokens: 1, total_tokens: NaN },
])('rejects incomplete usage at the final outline checkpoint: %j', (usage) => {
  expect(() => assertCompletedGatewayRecords([{ state: 'completed', usage }])).toThrow(
    'F75_GATEWAY_FAILED_OR_UNKNOWN_NO_RETRY',
  );
});
it('accepts fully accounted terminal calls and rejects unknown state', () => {
  const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
  expect(() => assertCompletedGatewayRecords([{ state: 'completed', usage }])).not.toThrow();
  expect(() => assertCompletedGatewayRecords([{ state: 'unknown', usage }])).toThrow(
    'F75_GATEWAY_FAILED_OR_UNKNOWN_NO_RETRY',
  );
});
/** Paid only when explicitly enabled: the server performs the selector and outline steps. */
it.skipIf(process.env.F75_NEXT_CLASS_START !== '1')(
  'F75 live-003 creates a formal next-class run and stops at outline confirmation',
  async () => {
    if (
      process.env.F75_BATCH_ID !== '003' ||
      !process.env.DATABASE_URL?.endsWith('/f75_app003') ||
      !process.env.MEMORY_DATABASE_URL?.endsWith('/f75_memory003')
    )
      throw Error('F75_LIVE003_ISOLATION_REQUIRED');
    const dir = path.resolve(process.env.F75_ARTIFACT_DIR ?? '');
    if (!dir.replaceAll('\\', '/').endsWith('/docs/log/artifacts/F75/live-003'))
      throw Error('F75_ARTIFACT_DIR_REQUIRED');
    const batch = JSON.parse(await readFile(path.join(dir, 'batch.json'), 'utf8'));
    expect(batch.owner).toBe('f75-controlled-003');
    expect(batch.environmentId).toBe('00000000-0000-4000-8000-000000000077');
    expect(batch.applicationDatabase).toBe('f75_app003');
    expect(batch.memoryDatabase).toBe('f75_memory003');
    expect(batch.appPort).toBe(3095);
    expect(batch.gatewayPort).toBe(3096);
    process.env.OPENMAIC_SIMULATED_LEARNING_LOOP = JSON.stringify({
      sourceNature: 'proxy',
      conditions: [
        'F75 isolated synthetic classroom; operator knows reference answers; not real learner evidence',
      ],
      memoryEnvironmentId: batch.environmentId,
    });
    process.env.OPENMAIC_DIALOGUE_EVIDENCE_BINDINGS_FILE = '';
    const base = 'http://127.0.0.1:3095';
    const gateway = 'http://127.0.0.1:3096';
    const write = (name: string, value: unknown) =>
      writeFile(path.join(dir, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    const getBudget = async () => {
      const response = await fetch(gateway + '/__f75/status', {
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
      expect(response.ok).toBe(true);
      return (await response.json()) as {
        stopped: boolean;
        calls: number;
        counts: { evidence: number; memory: number; other: number };
        records: { state: string; usage: unknown }[];
      };
    };
    const readRun = async (id: string) => {
      const response = await fetch(base + '/api/generation-runs/' + encodeURIComponent(id), {
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
      expect(response.ok).toBe(true);
      const body = await response.json();
      expect(body.success).toBe(true);
      return body.run as import('@/lib/server/generation/run/types').GenerationRunSnapshot;
    };
    const provider = await getServerPersistenceProvider(process.env.DATABASE_URL!);
    let intentWritten = false;
    try {
      const jobs = await provider.pool.query(
        'SELECT data FROM dialogue_loop_jobs WHERE owner_id=$1',
        [batch.owner],
      );
      expect(jobs.rows).toHaveLength(1);
      expect(jobs.rows[0].data).toMatchObject({
        state: 'completed',
        memoryState: 'completed',
        snapshot: { type: 'discussion', status: 'completed' },
      });
      const formal = await readSimulatedLearnerMemory('A');
      expect(formal.usable.revision).toBeGreaterThan(0);
      expect(formal.coverage.some((s) => s.valid && s.source_id.includes(':dialogue:'))).toBe(true);
      const before = await getBudget();
      expect(before.stopped).toBe(false);
      assertCompletedGatewayRecords(before.records);
      expect(before.counts.evidence).toBe(1);
      expect(before.counts.memory).toBe(1);
      // Reserve at least a selector and an outline call; the gateway remains the final authority.
      expect(before.counts.other).toBeLessThanOrEqual(batch.limits.otherCalls - 2);
      const existing = await provider.pool.query(
        'SELECT id FROM generation_runs WHERE owner_id=$1 AND id<>$2',
        [batch.owner, batch.generationRunId],
      );
      expect(existing.rows).toHaveLength(0);
      const input = {
        requirement: batch.inputs.nextClass,
        simulatedLearner: 'A',
        materialIds: [],
        interactive: false,
        taskEngine: false,
        agents: { mode: 'preset', agentIds: ['default-1'] },
        outlineReview: 'wait',
      };
      // Written before POST. A timeout/unknown response never permits a second paid start.
      await write('next-class-intent.json', {
        input,
        expectedMemoryRevision: formal.usable.revision,
        formalCoverage: formal.coverage,
        gatewayBefore: before,
      });
      intentWritten = true;
      const started = await fetch(base + '/api/generation-runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
      const startBody = await started.json();
      await write('next-class-start.json', { status: started.status, body: startBody });
      expect(started.status).toBe(202);
      expect(startBody.success).toBe(true);
      const id = startBody.run.id as string;
      expect(id).toMatch(/^run-[\w-]{16}$/);
      expect(id).not.toBe(batch.generationRunId);
      let run = await readRun(id);
      const deadline = Date.now() + 240_000;
      while (run.state !== 'awaiting_outline_confirmation') {
        const status = await getBudget();
        if (status.records.some((r) => ['failed', 'unknown'].includes(r.state)))
          throw Error('F75_GATEWAY_FAILED_OR_UNKNOWN_NO_RETRY');
        if (!['preparing', 'outlining'].includes(run.state)) {
          await write('next-class-terminal.json', { run, gateway: status });
          throw Error('F75_NEXT_CLASS_DID_NOT_REACH_OUTLINE_WAIT');
        }
        if (Date.now() >= deadline) throw Error('F75_NEXT_CLASS_POLL_TIMEOUT_NO_RETRY');
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        run = await readRun(id);
      }
      const checkpoints = await provider.pool.query(
        'SELECT step_id,output FROM generation_run_steps WHERE run_id=$1 ORDER BY step_id',
        [id],
      );
      const context = run.outline?.learnerContext;
      // Persist the actual result even if a semantic assertion fails; never fabricate a selection.
      const gatewayAfter = await getBudget();
      await write('next-class-outline-wait.json', {
        run,
        checkpoints: checkpoints.rows,
        expectedMemoryRevision: formal.usable.revision,
        gatewayAfter,
        fullCourseGenerated: false,
      });
      assertCompletedGatewayRecords(gatewayAfter.records);
      expect(run.input).toMatchObject(input);
      expect(run.outlineAutoConfirmAt).toBeUndefined();
      expect(run.progress.scenesCompleted).toBe(0);
      expect(context?.memoryRevision).toBe(formal.usable.revision);
      expect(context?.student).toBe('A');
      expect(context?.status).toBe('ready');
      expect(
        context?.selected.some((p) => p.supports.some((s) => s.kind === 'dialogue_evidence')),
      ).toBe(true);
      expect(checkpoints.rows.find((r) => r.step_id === 'learner-context')?.output).toEqual(
        context,
      );
      expect(checkpoints.rows.some((r) => r.step_id.startsWith('scene:'))).toBe(false);
      await write('next-class-verification.json', {
        passed: true,
        runId: id,
        memoryRevision: context!.memoryRevision,
        selected: context!.selected,
        state: run.state,
        formalGenerationEntry: true,
        fullCourseGenerated: false,
      });
    } catch (error) {
      if (intentWritten) {
        // Any failed/unknown paid path closes the global gateway; no recovery or automatic retry.
        await fetch(gateway + '/__f75/shutdown', {
          method: 'POST',
          signal: AbortSignal.timeout(5_000),
          redirect: 'error',
        }).catch(() => {});
      }
      throw error;
    } finally {
      await provider.pool.end();
    }
  },
  300_000,
);
