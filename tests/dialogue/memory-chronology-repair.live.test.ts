import { it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { openSimulatedMemory } from '@/lib/server/simulated-memory';
import { SimulatedMemoryEnvironment } from '@/lib/learner-memory/simulated-environment';
import { simulatedScope } from '@/lib/learner-memory/simulated-seeds';
import {
  DIALOGUE_MEMORY_SYSTEM,
  DIALOGUE_MEMORY_PROMPT_VERSION,
} from '@/lib/learner-memory/dialogue-prompt';
import { resolveModel } from '@/lib/server/resolve-model';
import { getProvider } from '@/lib/ai/providers';
import {
  dialogueMemoryModelIdentity,
  invokeDialogueMemoryModel,
} from '@/lib/server/dialogue-memory-model';
const phase = process.env.F75_MEMORY_REPAIR_PHASE;
const MEMORY_REPAIR_OPERATION_ID = 'f75:003:chronology:memory-v2-1';
it('uses an operation ID accepted by the existing Memory store', () => {
  expect(MEMORY_REPAIR_OPERATION_ID).toMatch(/^[\w:-]{1,120}$/);
});
const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const complete = (
  records: {
    state: string;
    usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  }[],
) =>
  records.length > 0 &&
  records.every(
    (r) =>
      r.state === 'completed' &&
      r.usage &&
      [r.usage.prompt_tokens, r.usage.completion_tokens, r.usage.total_tokens].every(
        (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0,
      ),
  );
it.skipIf(!phase)(
  'controlled chronology maintenance and fresh formal generation; never retries an unknown call',
  async () => {
    if (
      !['preflight', 'serve-memory', 'memory', 'serve-next', 'next'].includes(phase!) ||
      !process.env.DATABASE_URL?.endsWith('/f75_app003') ||
      !process.env.MEMORY_DATABASE_URL?.endsWith('/f75_memory003')
    )
      throw Error('F75_REPAIR_ISOLATION_REQUIRED');
    const dir = path.resolve(process.env.F75_ARTIFACT_DIR ?? '');
    if (!dir.replaceAll('\\', '/').endsWith('/docs/log/artifacts/F75/live-003/repair-v2.1'))
      throw Error('F75_REPAIR_DIR_REQUIRED');
    const originalDir = path.dirname(dir),
      batch = JSON.parse(await readFile(path.join(originalDir, 'batch.json'), 'utf8'));
    const original = JSON.parse(
      await readFile(path.join(originalDir, 'restart-readback.json'), 'utf8'),
    );
    const summary = JSON.parse(
      await readFile(path.join(originalDir, 'gateway-summary.json'), 'utf8'),
    );
    expect(batch.owner).toBe('f75-controlled-003');
    expect(batch.environmentId).toBe('00000000-0000-4000-8000-000000000077');
    expect(summary.calls).toBe(11);
    expect(summary.counts).toEqual({ evidence: 1, memory: 1, other: 9 });
    expect(complete(summary.records)).toBe(true);
    const legacyDir = path.join(originalDir, 'repair-v2');
    const legacy = JSON.parse(
      await readFile(path.join(legacyDir, 'memory-gateway-summary.json'), 'utf8'),
    );
    const failed = JSON.parse(await readFile(path.join(legacyDir, 'result.json'), 'utf8'));
    expect(legacy.calls).toBe(1);
    expect(legacy.counts).toEqual({ evidence: 0, memory: 1, other: 0 });
    expect(complete(legacy.records)).toBe(true);
    const checkLedger = (ledger: typeof summary) => {
      expect(ledger.calls).toBe(ledger.records.length);
      expect(ledger.inputBytes).toBe(
        ledger.records.reduce((n: number, r: { requestBytes: number }) => n + r.requestBytes, 0),
      );
      expect(ledger.outputBudget).toBe(
        ledger.records.reduce(
          (n: number, r: { maxOutputTokens: number }) => n + r.maxOutputTokens,
          0,
        ),
      );
      for (const kind of ['evidence', 'memory', 'other'])
        expect(ledger.counts[kind]).toBe(
          ledger.records.filter((r: { kind: string }) => r.kind === kind).length,
        );
    };
    checkLedger(summary);
    checkLedger(legacy);
    expect(failed.result.run).toMatchObject({
      state: 'failed',
      errorCode: 'BATCH_COVERAGE',
      id: 'f75:003:chronology:memory-v2',
    });
    const authorization = JSON.parse(
      await readFile(path.join(dir, 'budget-authorization.json'), 'utf8'),
    );
    expect(authorization).toMatchObject({
      approved: true,
      memoryCalls: 3,
      totalCalls: 16,
      previousMemoryCalls: 2,
      scope: 'F75 live-003 repair-v2.1',
      otherLimitsUnchanged: true,
    });
    expect(batch.limits.memoryCalls).toBe(2);
    const overallLimits = { ...batch.limits, memoryCalls: authorization.memoryCalls };
    const base = {
      calls: summary.calls + legacy.calls,
      counts: {
        evidence: summary.counts.evidence + legacy.counts.evidence,
        memory: summary.counts.memory + legacy.counts.memory,
        other: summary.counts.other + legacy.counts.other,
      },
      inputBytes: summary.inputBytes + legacy.inputBytes,
      outputBudget: summary.outputBudget + legacy.outputBudget,
      tokens: [...summary.records, ...legacy.records].reduce(
        (n: number, r: { usage: { total_tokens: number } }) => n + r.usage.total_tokens,
        0,
      ),
    };
    expect(base).toEqual({
      calls: 12,
      counts: { evidence: 1, memory: 2, other: 9 },
      inputBytes: 126598,
      outputBudget: 88016,
      tokens: 32835,
    });
    const manifest = JSON.parse(
      await readFile(path.join(originalDir, 'artifact-manifest.json'), 'utf8'),
    );
    expect(manifest.files).toHaveLength(62);
    const paths = new Set<string>([
      '../batch.json',
      '../gateway-summary.json',
      '../original-raw-manifest.json',
      '../artifact-manifest.json',
      '../restart-readback.json',
      '../repair-v2/allocation.json',
      '../repair-v2/memory-gateway-summary.json',
      '../repair-v2/result.json',
      'budget-authorization.json',
    ]);
    for (const file of manifest.files) {
      expect(path.isAbsolute(file.path)).toBe(false);
      const target = path.resolve(originalDir, file.path);
      const relative = path.relative(originalDir, target);
      expect(relative).not.toBe('');
      expect(
        relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative),
      ).toBe(false);
      expect(sha(await readFile(target))).toBe(file.sha256);
      paths.add('../' + file.path);
    }
    for (const [folder, prefix, records] of [
      [originalDir, 'call-', summary.records],
      [legacyDir, 'memory-call-', legacy.records],
    ] as const) {
      for (const record of records) {
        const stem = prefix + String(record.index).padStart(3, '0');
        const meta = JSON.parse(await readFile(path.join(folder, stem + '.meta.json'), 'utf8'));
        expect(meta).toEqual(record);
        const response = JSON.parse(
          await readFile(path.join(folder, stem + '.response.json'), 'utf8'),
        );
        expect(response.status).toBe(200);
        expect(response.usage).toEqual(record.usage);
        const request = JSON.parse(
          await readFile(path.join(folder, stem + '.request.json'), 'utf8'),
        );
        expect(sha(JSON.stringify(request))).toBe(record.requestHash);
        for (const extension of ['request', 'response', 'meta'])
          paths.add(
            '../' + (folder === legacyDir ? 'repair-v2/' : '') + stem + '.' + extension + '.json',
          );
      }
    }
    const ledgerHashes: Record<string, string> = {};
    for (const relative of paths)
      ledgerHashes[relative] = sha(await readFile(path.join(dir, relative)));

    const write = (name: string, value: unknown) =>
      writeFile(path.join(dir, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    process.env.OWNER_SINGLE_USER = 'true';
    process.env.OWNER_SINGLE_USER_ID = batch.owner;
    process.env.PERSISTENCE_SHARED_OWNER_ID = '';
    process.env.OPENMAIC_SIMULATED_LEARNING_LOOP = JSON.stringify({
      sourceNature: 'proxy',
      conditions: [
        'F75 isolated synthetic classroom; operator knows reference answers; not real learner evidence',
      ],
      memoryEnvironmentId: batch.environmentId,
    });
    process.env.OPENMAIC_DIALOGUE_EVIDENCE_BINDINGS_FILE = '';
    process.env.MODEL_FALLBACK = '';
    const app = await getServerPersistenceProvider(process.env.DATABASE_URL!),
      opened = await openSimulatedMemory();
    const memory = new SimulatedMemoryEnvironment({
      ...opened.memory.provider,
      systemPrompt: DIALOGUE_MEMORY_SYSTEM,
    });
    const scope = simulatedScope('A'),
      gateway = 'http://127.0.0.1:3096',
      appBase = 'http://127.0.0.1:3095';
    const budget = async () => {
      const r = await fetch(gateway + '/__f75/status', {
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
      expect(r.ok).toBe(true);
      return r.json();
    };
    try {
      if (phase === 'preflight') {
        const before = await memory.read('A');
        expect(before.usable.revision).toBe(2);
        expect(before.maintenancePending).toBe(true);
        expect(before.coverage.every((s) => s.valid && s.current && s.processed)).toBe(true);
        expect(base.calls + 3).toBeLessThanOrEqual(overallLimits.totalCalls);
        expect(base.counts.memory + 1).toBeLessThanOrEqual(overallLimits.memoryCalls);
        expect(base.counts.other + 2).toBeLessThanOrEqual(overallLimits.otherCalls);
        expect(base.outputBudget + 24576).toBeLessThanOrEqual(overallLimits.totalConfiguredOutput);
        expect(base.inputBytes + 196608).toBeLessThanOrEqual(overallLimits.totalRequestBytes);
        expect(DIALOGUE_MEMORY_PROMPT_VERSION).toBe('dialogue-memory.v2.1');
        const targetPieceId = original.formal.sections.learning_experiences[0].id;
        expect(
          before.snapshot.pieces.find((p) => p.id === targetPieceId)?.restrictions.length,
        ).toBeGreaterThan(0);
        expect(await memory.store.getRun(scope, failed.result.run.id)).toEqual(failed.result.run);
        await write('allocation.json', {
          ledgerHashes,
          baseCalls: base.calls,
          baseCounts: base.counts,
          baseTokens: base.tokens,
          baseInputBytes: base.inputBytes,
          baseOutputBudget: base.outputBudget,
          owner: batch.owner,
          environmentId: batch.environmentId,
          systemHashes: { memory: sha(DIALOGUE_MEMORY_SYSTEM) },
          promptVersion: DIALOGUE_MEMORY_PROMPT_VERSION,
          additionalCalls: 3,
          totalCallsUpperBound: 15,
          overallLimits,
          phases: {
            memory: {
              allowedKind: 'memory',
              totalCalls: 1,
              memoryCalls: 1,
              evidenceCalls: 1,
              otherCalls: 1,
              totalConfiguredOutput: 8192,
              totalRequestBytes: 65536,
            },
            next: {
              allowedKind: 'other',
              totalCalls: 2,
              memoryCalls: 1,
              evidenceCalls: 1,
              otherCalls: 2,
              totalConfiguredOutput: 16384,
              totalRequestBytes: 131072,
            },
          },
          expectedRevision: before.usable.revision,
          targetPieceId,
          failedMemoryRunId: failed.result.run.id,
        });
        return;
      }
      const allocation = JSON.parse(await readFile(path.join(dir, 'allocation.json'), 'utf8'));
      expect(allocation.ledgerHashes).toEqual(ledgerHashes);
      expect(allocation.promptVersion).toBe(DIALOGUE_MEMORY_PROMPT_VERSION);
      expect(allocation.systemHashes.memory).toBe(sha(DIALOGUE_MEMORY_SYSTEM));
      expect(allocation.overallLimits).toEqual(overallLimits);
      const requireReview = async () => {
        const accepted = JSON.parse(await readFile(path.join(dir, 'content-review.json'), 'utf8'));
        expect(accepted.passed).toBe(true);
        expect(accepted.resultSha256).toBe(sha(await readFile(path.join(dir, 'result.json'))));
        const result = JSON.parse(await readFile(path.join(dir, 'result.json'), 'utf8'));
        expect(result.result.run.state).toBe('completed');
        expect(result.model.promptVersion).toBe(DIALOGUE_MEMORY_PROMPT_VERSION);
        expect(result.result.memory.maintenancePending).toBe(false);
        const ledger = JSON.parse(
          await readFile(path.join(dir, 'memory-gateway-summary.json'), 'utf8'),
        );
        expect(ledger.calls).toBe(1);
        expect(ledger.counts).toEqual({ evidence: 0, memory: 1, other: 0 });
        expect(complete(ledger.records)).toBe(true);
        checkLedger(ledger);
        expect(result.gateway.records).toEqual(ledger.records);
        const meta = JSON.parse(
          await readFile(path.join(dir, 'memory-call-001.meta.json'), 'utf8'),
        );
        expect(meta).toEqual(ledger.records[0]);
        const request = JSON.parse(
          await readFile(path.join(dir, 'memory-call-001.request.json'), 'utf8'),
        );
        const response = JSON.parse(
          await readFile(path.join(dir, 'memory-call-001.response.json'), 'utf8'),
        );
        expect(sha(JSON.stringify(request))).toBe(meta.requestHash);
        expect(response.status).toBe(200);
        expect(response.usage).toEqual(meta.usage);
        expect(meta.systemHash).toBe(allocation.systemHashes.memory);
        expect(base.calls + ledger.calls + 2).toBeLessThanOrEqual(overallLimits.totalCalls);
        expect(base.counts.memory + ledger.counts.memory).toBeLessThanOrEqual(
          overallLimits.memoryCalls,
        );
        expect(base.outputBudget + ledger.outputBudget + 16384).toBeLessThanOrEqual(
          overallLimits.totalConfiguredOutput,
        );
        expect(base.inputBytes + ledger.inputBytes + 131072).toBeLessThanOrEqual(
          overallLimits.totalRequestBytes,
        );
        return accepted;
      };
      if (phase!.startsWith('serve-')) {
        if (phase === 'serve-next') await requireReview();
        const resolved = await resolveModel({
          stage: 'quiz-evidence',
          workspaceId: batch.owner,
          modelString: batch.model,
        });
        const upstream = resolved.baseUrl ?? getProvider('deepseek')?.defaultBaseUrl;
        if (!resolved.apiKey || !upstream) throw Error('F75_PROVIDER_CONFIGURATION_REQUIRED');
        await new Promise<void>((resolve, reject) => {
          const child = spawn(process.execPath, [path.join(dir, 'start-repair.mjs')], {
            cwd: process.cwd(),
            windowsHide: true,
            stdio: 'inherit',
            env: {
              ...process.env,
              F75_REPAIR_STAGE: phase === 'serve-memory' ? 'memory' : 'next',
              F75_PROVIDER_KEY: resolved.apiKey,
              F75_UPSTREAM_URL: upstream,
            },
          });
          child.on('error', reject);
          child.on('exit', (c) => (c === 0 ? resolve() : reject(Error('F75_REPAIR_SERVER_EXIT'))));
        });
        return;
      }
      if (phase === 'memory') {
        const zeroCallBytes = await readFile(
          path.join(dir, 'zero-call-001-memory-gateway-summary.json'),
          'utf8',
        ).catch((error: unknown) => {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
          throw error;
        });
        if (zeroCallBytes !== null) {
          const zeroCall = JSON.parse(zeroCallBytes);
          expect(zeroCall.calls).toBe(0);
          expect(zeroCall.records).toEqual([]);
          expect(zeroCall.counts).toEqual({ evidence: 0, memory: 0, other: 0 });
          expect(zeroCall.stopped).toBe(true);
        }
        const before = await memory.read('A'),
          ledger = await budget();
        expect(before.usable.revision).toBe(allocation.expectedRevision);
        expect(before.maintenancePending).toBe(true);
        expect(ledger.stage).toBe('memory');
        expect(ledger.calls).toBe(0);
        expect(ledger.stopped).toBe(false);
        const reason =
          'semantic_review:chronology: 教师先给0.6kg=600g，学生只算600÷30=20且自报不能独立换算；教师随后才讲1kg=1000g/右移三位并让试算，未见后续学生作答。原Memory倒置时序并无据声称学生完成换算，请仅以仍准确的Evidence纠正。';
        await write('memory-intent.json', {
          operationId: MEMORY_REPAIR_OPERATION_ID,
          pieceId: allocation.targetPieceId,
          expectedRevision: before.usable.revision,
          reason,
          originalReplySha256: sha(JSON.stringify(original.results[0].delivery.memoryRun.reply)),
        });
        const restricted = await memory.read('A');
        expect(restricted.maintenancePending).toBe(true);
        expect(restricted.coverage.every((s) => s.valid && s.processed)).toBe(true);
        await write('restricted.json', restricted);
        const operation = MEMORY_REPAIR_OPERATION_ID;
        const prepared = await memory.store.prepare(scope, operation);
        expect(prepared.state).toBe('prepared');
        expect(prepared.batch).toHaveLength(0);
        expect(Object.keys(prepared.aliases).every((alias) => alias.startsWith('s'))).toBe(true);
        expect(
          Object.values(prepared.aliases).some((source) => source.kind === 'dialogue_evidence'),
        ).toBe(true);
        expect(prepared.prompt.system).toBe(DIALOGUE_MEMORY_SYSTEM);
        await write('prepared.json', prepared);
        // The client has only a dummy loopback credential; the gateway owns the provider key.
        process.env.OPENMAIC_CONFIG = path.join(dir, 'model-config.yml');
        process.env.F75_PROVIDER_KEY = 'F75-LOCAL-REPAIR-CLIENT';
        const resolved = await resolveModel({
          stage: 'quiz-evidence',
          workspaceId: batch.owner,
          modelString: batch.model,
        });
        expect(resolved.baseUrl).toBe(gateway + '/v1');
        const result = await memory.update('A', operation, (run) =>
          invokeDialogueMemoryModel(resolved, run),
        );
        const afterLedger = await budget();
        expect(await memory.store.getRun(scope, failed.result.run.id)).toEqual(failed.result.run);
        const oldRun = await memory.store.getRun(scope, original.results[0].delivery.memoryRun.id);
        expect(oldRun.reply).toEqual(original.results[0].delivery.memoryRun.reply);
        await write('result.json', {
          result,
          model: dialogueMemoryModelIdentity(resolved),
          gateway: afterLedger,
          originalReplyUnchanged: true,
          semanticAcceptance: 'pending_independent_review',
        });
        expect(result.run.state).toBe('completed');
        expect(result.memory.maintenancePending).toBe(false);
        expect(result.memory.coverage.every((s) => s.valid && s.processed)).toBe(true);
        expect(complete(afterLedger.records)).toBe(true);
        expect(afterLedger.calls).toBe(1);
        return;
      }
      const accepted = await requireReview();
      const formal = await memory.read('A');
      expect(formal.maintenancePending).toBe(false);
      expect(formal.usable.revision).toBeGreaterThan(1);
      const ledger = await budget();
      expect(ledger.stage).toBe('next');
      expect(ledger.calls).toBe(0);
      expect(ledger.stopped).toBe(false);
      const oldNext = JSON.parse(
        await readFile(path.join(originalDir, 'next-class-verification.json'), 'utf8'),
      );
      await write('next-intent.json', {
        expectedRevision: formal.usable.revision,
        review: accepted,
        discardWrongRunId: oldNext.runId,
        input: {
          requirement: batch.inputs.nextClass,
          simulatedLearner: 'A',
          materialIds: [],
          interactive: false,
          taskEngine: false,
          agents: { mode: 'preset', agentIds: ['default-1'] },
          outlineReview: 'wait',
        },
      });
      const discarded = await fetch(appBase + '/api/generation-runs/' + oldNext.runId, {
        method: 'DELETE',
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
      await write('old-run-discard.json', {
        status: discarded.status,
        body: await discarded.json(),
      });
      expect(discarded.ok).toBe(true);
      const input = JSON.parse(await readFile(path.join(dir, 'next-intent.json'), 'utf8')).input;
      const started = await fetch(appBase + '/api/generation-runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
      const start = await started.json();
      await write('next-start.json', { status: started.status, body: start });
      expect(started.status).toBe(202);
      expect(start.success).toBe(true);
      const id = start.run.id as string;
      expect(id).not.toBe(oldNext.runId);
      const readRun = async () => {
        const r = await fetch(appBase + '/api/generation-runs/' + id, {
          signal: AbortSignal.timeout(15000),
          redirect: 'error',
        });
        expect(r.ok).toBe(true);
        return (await r.json())
          .run as import('@/lib/server/generation/run/types').GenerationRunSnapshot;
      };
      let run = await readRun();
      const until = Date.now() + 240000;
      while (run.state !== 'awaiting_outline_confirmation') {
        const b = await budget();
        if (b.records.some((r: { state: string }) => ['failed', 'unknown'].includes(r.state)))
          throw Error('F75_REPAIR_CALL_UNKNOWN');
        expect(['preparing', 'outlining']).toContain(run.state);
        if (Date.now() > until) throw Error('F75_REPAIR_POLL_TIMEOUT');
        await new Promise((r) => setTimeout(r, 1000));
        run = await readRun();
      }
      const after = await budget(),
        steps = (
          await app.pool.query(
            'SELECT step_id,output FROM generation_run_steps WHERE run_id=$1 ORDER BY step_id',
            [id],
          )
        ).rows;
      await write('next-outline-wait.json', {
        run,
        checkpoints: steps,
        gateway: after,
        fullCourseGenerated: false,
      });
      expect(complete(after.records)).toBe(true);
      expect(after.calls).toBe(2);
      expect(run.progress.scenesCompleted).toBe(0);
      expect(run.input).toMatchObject(input);
      expect(steps.some((step) => step.step_id.startsWith('scene:'))).toBe(false);
      expect(run.outlineAutoConfirmAt).toBeUndefined();
      expect(run.outline?.learnerContext?.memoryRevision).toBe(formal.usable.revision);
      expect(run.outline?.learnerContext?.status).toBe('ready');
      expect(
        run.outline?.learnerContext?.selected.some((p) =>
          p.supports.some((s) => s.kind === 'dialogue_evidence'),
        ),
      ).toBe(true);
      expect(steps.find((s) => s.step_id === 'learner-context')?.output).toEqual(
        run.outline?.learnerContext,
      );
      await write('next-verification.json', {
        passed: true,
        runId: id,
        memoryRevision: formal.usable.revision,
        state: run.state,
        selected: run.outline?.learnerContext?.selected,
        fullCourseGenerated: false,
      });
    } catch (error) {
      if (phase === 'memory' || phase === 'next') {
        await fetch(gateway + '/__f75/shutdown', {
          method: 'POST',
          signal: AbortSignal.timeout(5000),
        }).catch(() => {});
        await write(phase + '-failure.json', {
          message: error instanceof Error ? error.message : 'unknown',
        }).catch(() => {});
      }
      throw error;
    } finally {
      await opened.close();
      await app.pool.end();
    }
  },
  3600000,
);
