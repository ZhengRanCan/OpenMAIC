import { expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { assertPreclassContextCurrent } from '@/lib/server/preclass-learner-context';
import { renderPreclassLearnerContext } from '@/lib/learner-context/render';
import { defaultRunStepServices } from '@/lib/server/generation/run/services';
import { runRequirements } from '@/lib/server/generation/run/engine';
import { discardGenerationRun } from '@/lib/server/generation/run/store';
import type { GenerationRunSnapshot } from '@/lib/server/generation/run/types';
import type { OutlineEvent } from '@/lib/server/generation/steps/outline';
import { resolveModel } from '@/lib/server/resolve-model';
import { getProvider } from '@/lib/ai/providers';
import { createLogger } from '@/lib/logger';

const phase = process.env.F75_OUTLINE_CHECK_PHASE;
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
it.skipIf(!phase)(
  'checks the formal outline service against unchanged revision3, once',
  async () => {
    if (
      !['preflight', 'serve', 'outline', 'finalize'].includes(phase!) ||
      !process.env.DATABASE_URL?.endsWith('/f75_app003') ||
      !process.env.MEMORY_DATABASE_URL?.endsWith('/f75_memory003')
    )
      throw Error('F75_OUTLINE_ISOLATION');
    const dir = path.resolve(process.env.F75_ARTIFACT_DIR ?? '');
    if (!dir.replaceAll('\\', '/').endsWith('/docs/log/artifacts/F75/live-003/outline-attribution'))
      throw Error('F75_OUTLINE_DIRECTORY');
    const base = path.dirname(dir);
    const read = async (name: string) => JSON.parse(await readFile(path.join(base, name), 'utf8'));
    const write = (name: string, value: unknown) =>
      writeFile(path.join(dir, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    const batch = await read('batch.json');
    const next = (await read('repair-v2.1/next-outline-wait.json')) as {
      run: GenerationRunSnapshot;
    };
    const frozen = next.run.outline!.learnerContext!;
    expect(frozen.memoryRevision).toBe(3);
    expect(frozen.status).toBe('ready');
    const fingerprints: Record<string, string> = {};
    const record = async (name: string) => {
      fingerprints[name] = sha(await readFile(path.join(base, name)));
    };
    const manifest = await read('artifact-manifest.json');
    expect(manifest.files).toHaveLength(62);
    for (const f of manifest.files) {
      const target = path.resolve(base, f.path),
        relative = path.relative(base, target);
      expect(
        relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative),
      ).toBe(true);
      expect(sha(await readFile(target))).toBe(f.sha256);
      await record(f.path);
    }
    const counters = {
      calls: 0,
      counts: { evidence: 0, memory: 0, other: 0 },
      inputBytes: 0,
      outputBudget: 0,
      tokens: 0,
    };
    for (const [name, folder, prefix] of [
      ['gateway-summary.json', '', 'call-'],
      ['repair-v2/memory-gateway-summary.json', 'repair-v2/', 'memory-call-'],
      ['repair-v2.1/memory-gateway-summary.json', 'repair-v2.1/', 'memory-call-'],
      ['repair-v2.1/next-gateway-summary.json', 'repair-v2.1/', 'next-call-'],
    ]) {
      const ledger = await read(name);
      expect(ledger.stopped).toBe(true);
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
      await record(name);
      for (const kind of ['evidence', 'memory', 'other'] as const) {
        expect(ledger.counts[kind]).toBe(
          ledger.records.filter((r: { kind: string }) => r.kind === kind).length,
        );
        counters.counts[kind] += ledger.counts[kind];
      }
      for (const r of ledger.records) {
        expect(r.state).toBe('completed');
        for (const k of ['prompt_tokens', 'completion_tokens', 'total_tokens'])
          expect(
            typeof r.usage[k] === 'number' && Number.isFinite(r.usage[k]) && r.usage[k] >= 0,
          ).toBe(true);
        counters.tokens += r.usage.total_tokens;
        const stem = folder + prefix + String(r.index).padStart(3, '0');
        expect(await read(stem + '.meta.json')).toEqual(r);
        const response = await read(stem + '.response.json');
        expect(response.status).toBe(200);
        expect(response.usage).toEqual(r.usage);
        expect(sha(JSON.stringify(await read(stem + '.request.json')))).toBe(r.requestHash);
        for (const ext of ['meta', 'request', 'response']) await record(stem + '.' + ext + '.json');
      }
      counters.calls += ledger.calls;
      counters.inputBytes += ledger.inputBytes;
      counters.outputBudget += ledger.outputBudget;
    }
    expect(counters).toEqual({
      calls: 15,
      counts: { evidence: 1, memory: 3, other: 11 },
      inputBytes: 169761,
      outputBudget: 106400,
      tokens: 45423,
    });
    const auth = await read('repair-v2.1/budget-authorization.json');
    expect(auth).toMatchObject({ approved: true, totalCalls: 16, memoryCalls: 3 });
    for (const f of [
      'artifact-manifest.json',
      'repair-v2.1/budget-authorization.json',
      'repair-v2.1/result.json',
      'repair-v2.1/content-review.json',
      'repair-v2.1/next-outline-wait.json',
    ])
      await record(f);
    const reviewed = await read('repair-v2.1/content-review.json');
    expect(reviewed.passed).toBe(true);
    expect(reviewed.resultSha256).toBe(fingerprints['repair-v2.1/result.json']);
    const sourceHash = sha(
      await readFile('packages/@openmaic/generation/src/outline-generator.ts'),
    );
    const builtHash = sha(
      await readFile('packages/@openmaic/generation/dist/outline-generator.js'),
    );
    process.env.OWNER_SINGLE_USER = 'true';
    process.env.OWNER_SINGLE_USER_ID = batch.owner;
    process.env.PERSISTENCE_SHARED_OWNER_ID = '';
    process.env.MODEL_FALLBACK = '';
    process.env.OPENMAIC_AUTOMATIC_DIALOGUE_LOOP = 'false';
    process.env.OPENMAIC_AUTOMATIC_LEARNING_LOOP = 'false';
    process.env.OPENMAIC_DIALOGUE_EVIDENCE_BINDINGS_FILE = '';
    process.env.OPENMAIC_SIMULATED_LEARNING_LOOP = JSON.stringify({
      sourceNature: 'proxy',
      conditions: [
        'F75 isolated synthetic classroom; operator knows reference answers; not real learner evidence',
      ],
      memoryEnvironmentId: batch.environmentId,
    });
    await assertPreclassContextCurrent(frozen);
    if (phase === 'preflight') {
      await write('allocation.json', {
        fingerprints,
        sourceHash,
        builtHash,
        owner: batch.owner,
        counters,
        additionalCalls: 1,
        allowedKind: 'other',
        allowedSystemHash: (await read('repair-v2.1/next-call-002.meta.json')).systemHash,
        limits: { ...batch.limits, memoryCalls: 3 },
        requestBytes: 65536,
        outputTokens: 8192,
        purpose:
          'Known attribution defect, corrected prompt; formal outline service control only, no new or revised generation run',
        userAuthorization: 'Approved total16/M3; user continued this repair',
      });
      return;
    }
    const allocation = JSON.parse(await readFile(path.join(dir, 'allocation.json'), 'utf8'));
    expect(allocation.fingerprints).toEqual(fingerprints);
    expect(allocation.sourceHash).toBe(sourceHash);
    expect(allocation.builtHash).toBe(builtHash);
    if (phase === 'serve') {
      const resolved = await resolveModel({
        stage: 'scene-outlines-stream',
        workspaceId: batch.owner,
        modelString: batch.model,
      });
      const upstream = resolved.baseUrl ?? getProvider('deepseek')?.defaultBaseUrl;
      if (!resolved.apiKey || !upstream) throw Error('F75_MODEL_CONFIGURATION');
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(dir, 'start-outline.mjs')], {
          cwd: process.cwd(),
          windowsHide: true,
          stdio: 'inherit',
          env: { ...process.env, F75_PROVIDER_KEY: resolved.apiKey, F75_UPSTREAM_URL: upstream },
        });
        child.on('error', reject);
        child.on('exit', (c) => (c === 0 ? resolve() : reject(Error('F75_GATEWAY_EXIT'))));
      });
      return;
    }
    const status = async () => {
      const r = await fetch('http://127.0.0.1:3096/__f75/status', {
        signal: AbortSignal.timeout(5000),
      });
      expect(r.ok).toBe(true);
      return r.json();
    };
    const app = await getServerPersistenceProvider(process.env.DATABASE_URL!);
    try {
      if (phase === 'finalize') {
        const ledger = JSON.parse(await readFile(path.join(dir, 'gateway-summary.json'), 'utf8'));
        expect(ledger.calls).toBe(1);
        expect(ledger.stopped).toBe(true);
        expect(ledger.records[0].state).toBe('completed');
        const before = (
          await app.pool.query('SELECT outline FROM generation_runs WHERE id=$1 AND owner_id=$2', [
            next.run.id,
            batch.owner,
          ])
        ).rows[0];
        const command = await discardGenerationRun(next.run.id, batch.owner);
        expect(command?.state).toBe('ended');
        const after = (
          await app.pool.query(
            'SELECT state,outline,stage_id FROM generation_runs WHERE id=$1 AND owner_id=$2',
            [next.run.id, batch.owner],
          )
        ).rows[0];
        expect(after.outline).toEqual(before.outline);
        expect(after.state).toBe('ended');
        expect(after.stage_id).toBeNull();
        await write('source-run-discard.json', {
          sourceRunId: next.run.id,
          command,
          oldOutlinePreserved: true,
          fullCourseGenerated: false,
          additionalCalls: 0,
        });
        return;
      }
      expect((await status()).calls).toBe(0);
      const before = (
        await app.pool.query(
          'SELECT state,outline FROM generation_runs WHERE id=$1 AND owner_id=$2',
          [next.run.id, batch.owner],
        )
      ).rows[0];
      expect(before.state).toBe('awaiting_outline_confirmation');
      await write('intent.json', {
        sourceRunId: next.run.id,
        context: frozen,
        inputHash: sha(JSON.stringify(next.run.input)),
        ...allocation,
      });
      process.env.OPENMAIC_CONFIG = path.join(dir, 'model-config.yml');
      process.env.F75_PROVIDER_KEY = 'F75-OUTLINE-LOCAL-CLIENT';
      const local = await resolveModel({
        stage: 'scene-outlines-stream',
        workspaceId: batch.owner,
        modelString: batch.model,
      });
      expect(local.baseUrl).toBe('http://127.0.0.1:3096/v1');
      const events: OutlineEvent[] = [],
        controller = new AbortController();
      const result = await defaultRunStepServices.outline(
        batch.owner,
        {
          requirements: runRequirements(next.run.input, false),
          learnerContext: renderPreclassLearnerContext(frozen),
          allowImageGeneration: false,
          allowVideoGeneration: false,
        },
        {
          log: createLogger('F75-outline-attribution-control'),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]),
          emit: (e) => {
            if (e.type === 'retry') {
              controller.abort();
              throw Error('F75_RETRY_FORBIDDEN');
            }
            events.push(e);
          },
        },
      );
      await assertPreclassContextCurrent(frozen);
      const gateway = await status();
      expect(gateway.calls).toBe(1);
      expect(gateway.records[0].state).toBe('completed');
      const after = (
        await app.pool.query(
          'SELECT state,outline FROM generation_runs WHERE id=$1 AND owner_id=$2',
          [next.run.id, batch.owner],
        )
      ).rows[0];
      expect(after).toEqual(before);
      expect(result.outlines.length).toBeGreaterThan(0);
      await write('result.json', {
        kind: 'controlled_formal_outline_service',
        sourceRunId: next.run.id,
        originalRunUnchanged: true,
        context: frozen,
        result,
        events,
        gateway,
        fullCourseGenerated: false,
        semanticAcceptance: 'pending_independent_review',
      });
    } catch (error) {
      await write('failure.json', {
        message: error instanceof Error ? error.message : 'unknown',
      }).catch(() => {});
      throw error;
    } finally {
      await fetch('http://127.0.0.1:3096/__f75/shutdown', {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
      await app.pool.end();
    }
  },
  3600000,
);
