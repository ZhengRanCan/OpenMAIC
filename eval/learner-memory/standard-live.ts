/** Explicit, bounded live trial of the already frozen five Memory inputs. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import type { ConnectableQueryable } from '@openmaic/storage/server/reference';
import { loadStandardCorpus, prepareStandardInput } from './standard-replay';
import {
  canonicalJson,
  digest,
  invariant,
  type CapturedMemoryReply,
  type PreparedMemoryRun,
} from '@/lib/learner-memory/contracts';
import { checkModelCapacity } from '@/lib/learner-memory/prompt';
import { LearnerMemoryStore } from '@/lib/persistence/learner-memory-store';
import { ensureMemorySchema } from '@/lib/persistence/learner-memory-schema';
import { updateMemory } from '@/lib/server/learner-memory';

const workspace = path.resolve(process.cwd(), '..');
const root = path.join(workspace, 'docs/log/artifacts/F67/memory-v0.2-2026-10-25');
const prepared = path.join(root, 'prepared-five-002');
const first = ['I08', 'U02', 'U03'];
const second = ['I06', 'U11'];
const cases = [...first, ...second];
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file: string, value: unknown) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const codePaths = [
  'lib/learner-memory/contracts.ts',
  'lib/learner-memory/prompt.ts',
  'lib/learner-memory/output-protocol.ts',
  'lib/learner-memory/transition.ts',
  'lib/learner-memory/read.ts',
  'lib/persistence/learner-memory-schema.ts',
  'lib/persistence/learner-memory-store.ts',
  'lib/server/learner-memory.ts',
  'eval/learner-memory/standard-replay.ts',
  'eval/learner-memory/standard-live.ts',
];

export function verifyTrialInput(
  packet: { caseId: string; input: unknown; run: PreparedMemoryRun },
  fixed: { id: string; scope: unknown; input: unknown },
) {
  invariant(
    packet.caseId === fixed.id &&
      canonicalJson(packet.input) === canonicalJson(fixed) &&
      canonicalJson(packet.run.scope) === canonicalJson(fixed.scope),
    'FIXED_STANDARD_INPUT_CHANGED',
  );
  invariant(packet.run.prompt.version === 'memory.v2', 'PROMPT_VERSION_UNSUPPORTED');
  invariant(
    packet.run.prompt.digest === digest([packet.run.prompt.system, packet.run.prompt.user]),
    'PROMPT_DIGEST_CHANGED',
  );
}

async function resolvedModel(modelString?: string) {
  const { resolveModel } = await import('@/lib/server/resolve-model');
  return resolveModel({ stage: 'quiz-evidence', workspaceId: null, modelString });
}

async function database(batch: string) {
  const url = process.env.MEMORY_DATABASE_URL ?? process.env.PG_CONTRACT_URL;
  invariant(url, 'MEMORY_DATABASE_URL_REQUIRED');
  const schema = 'f67_live_' + batch.replaceAll('-', '_');
  invariant(/^f67_live_[a-z][a-z0-9_]{0,40}$/.test(schema), 'ISOLATED_SCHEMA_REQUIRED');
  const admin = new Pool({ connectionString: url });
  try {
    await admin.query('CREATE SCHEMA IF NOT EXISTS ' + schema);
  } finally {
    await admin.end();
  }
  const pool = new Pool({ connectionString: url, options: '-c search_path=' + schema, max: 4 });
  try {
    await ensureMemorySchema(pool);
  } catch (error) {
    await pool.end();
    throw error;
  }
  const { nodePostgresTransaction } = await import('@openmaic/storage/server/reference');
  return {
    db: pool,
    store: new LearnerMemoryStore({
      withTransaction: nodePostgresTransaction(pool as unknown as ConnectableQueryable),
    }),
    isolatedDatabase: true as const,
    close: () => pool.end(),
  };
}

async function main() {
  invariant(path.basename(process.cwd()) === 'OpenMAIC', 'RUN_FROM_OPENMAIC');
  const [command, batch, caseId, approval] = process.argv.slice(2);
  invariant(batch && /^[a-z][a-z0-9-]{0,40}$/.test(batch), 'INVALID_BATCH');
  invariant(['configure', 'run', 'read', 'resume'].includes(command), 'INVALID_COMMAND');
  const dir = path.join(root, batch);
  const corpus = loadStandardCorpus(workspace);
  const original = read(path.join(prepared, 'manifest.json'));
  invariant(original.standardHashes[0] === corpus.standardSha256, 'STANDARD_CHANGED');
  for (const [name, hash] of Object.entries(original.files))
    invariant(sha(fs.readFileSync(path.join(prepared, name))) === hash, 'PREPARED_FILE_CHANGED');
  for (const [name, hash] of Object.entries(original.codeFiles))
    invariant(sha(fs.readFileSync(path.resolve(name))) === hash, 'PREPARED_CODE_CHANGED');

  if (command === 'configure') {
    invariant(!fs.existsSync(dir), 'BATCH_EXISTS');
    const model = await resolvedModel(caseId);
    invariant(!caseId || model.modelString === caseId, 'MODEL_CHANGED');
    const packets: Record<string, string> = {};
    for (const id of cases) {
      const file = path.join(prepared, id + '.json');
      const packet = read(file);
      const test = corpus.cases.find((c) => c.id === id)!;
      verifyTrialInput(packet, { id: test.id, scope: test.scope, input: test.input });
      checkModelCapacity(
        packet.run.prompt,
        model.modelInfo?.contextWindow,
        model.modelInfo?.outputWindow,
      );
      packets[id] = sha(fs.readFileSync(file));
    }
    fs.mkdirSync(dir);
    write(path.join(dir, 'manifest.json'), {
      schemaVersion: 'memory-standard-live.v1',
      batch,
      prepared: 'prepared-five-002',
      standardSha256: corpus.standardSha256,
      cases,
      first,
      second,
      maximumCalls: 5,
      packets,
      codeFiles: Object.fromEntries(codePaths.map((file) => [file, sha(fs.readFileSync(file))])),
      model: model.modelString,
      provider: model.providerId,
      endpointFingerprint: digest(model.baseUrl ?? 'default'),
      thinking: model.thinkingConfig ?? null,
      contextWindow: model.modelInfo!.contextWindow,
      outputWindow: model.modelInfo!.outputWindow,
      maxOutputTokens: 16000,
      timeoutMs: 180000,
      retries: 0,
      fallback: false,
      authorization:
        'User authorized I08/U02/U03 once each; I06/U11 only after content and persistence review.',
      createdAt: new Date().toISOString(),
    });
    console.log(
      JSON.stringify({ state: 'configured', model: model.modelString, cases, modelCalls: 0 }),
    );
    return;
  }
  const manifest = read(path.join(dir, 'manifest.json'));
  invariant(manifest.batch === batch && cases.includes(caseId), 'CASE_NOT_IN_BATCH');
  const raw = fs.readFileSync(path.join(prepared, caseId + '.json'));
  invariant(sha(raw) === manifest.packets[caseId], 'PACKET_CHANGED');
  const packet = JSON.parse(raw.toString('utf8'));
  const test = corpus.cases.find((c) => c.id === caseId)!;
  verifyTrialInput(packet, { id: test.id, scope: test.scope, input: test.input });
  const fixture = await database(batch);
  try {
    if (command === 'read') {
      const view = await fixture.store.read(test.scope);
      const saved = read(path.join(dir, caseId + '.result.json'));
      invariant(canonicalJson(saved.view) === canonicalJson(view), 'READBACK_CHANGED');
      console.log(JSON.stringify({ caseId, readback: 'match', revision: view.snapshot.revision }));
      return;
    }
    let run: PreparedMemoryRun;
    const existing = await fixture.db.query(
      'SELECT id FROM learner_memory_runs WHERE namespace=$1 AND learner_key=$2 AND id=$3',
      [test.scope.namespace, test.scope.learnerKey, packet.run.id],
    );
    if (existing.rows.length) run = await fixture.store.getRun(test.scope, packet.run.id);
    else
      run = await prepareStandardInput(
        fixture,
        corpus,
        { id: test.id, scope: test.scope, input: test.input },
        packet.run.id,
      );
    invariant(
      canonicalJson(run.prompt) === canonicalJson(packet.run.prompt),
      'PREPARED_PROMPT_CHANGED',
    );
    if (command === 'run') {
      invariant(approval === '--approved', 'EXPLICIT_TRIAL_APPROVAL_REQUIRED');
      for (const [file, hash] of Object.entries(manifest.codeFiles))
        invariant(sha(fs.readFileSync(path.resolve(file))) === hash, 'TRIAL_CODE_CHANGED');
      if (second.includes(caseId)) {
        const review = read(path.join(dir, 'first-three-review.json'));
        invariant(review.proceed === true, 'FIRST_THREE_REVIEW_REQUIRED');
        for (const id of first) {
          const result = fs.readFileSync(path.join(dir, id + '.result.json'));
          invariant(sha(result) === review.results[id], 'FIRST_THREE_RESULTS_CHANGED');
        }
      }
      const model = await resolvedModel(manifest.model);
      invariant(
        model.modelString === manifest.model &&
          model.providerId === manifest.provider &&
          digest(model.baseUrl ?? 'default') === manifest.endpointFingerprint &&
          digest(model.thinkingConfig ?? null) === digest(manifest.thinking),
        'MODEL_CHANGED',
      );
      checkModelCapacity(run.prompt, model.modelInfo?.contextWindow, model.modelInfo?.outputWindow);
      const { callLLM } = await import('@/lib/ai/llm');
      await updateMemory(fixture.store, test.scope, run.id, async (claimed) => {
        write(path.join(dir, caseId + '.attempt.json'), {
          state: 'calling',
          operationId: claimed.id,
          model: model.modelString,
          promptDigest: claimed.prompt.digest,
          startedAt: new Date().toISOString(),
        });
        const output = await callLLM(
          {
            model: model.model,
            system: claimed.prompt.system,
            prompt: claimed.prompt.user,
            maxOutputTokens: 16000,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(180000),
          },
          'f67-memory',
          { retries: 0 },
          model.thinkingConfig,
          { enabled: false, serverManaged: model.serverManaged },
        );
        const usage = output.totalUsage ?? output.usage;
        const reply: CapturedMemoryReply = {
          text: output.text,
          finishReason: output.finishReason,
          model: output.response?.modelId ?? model.modelString,
          origin: 'model',
          usage: usage
            ? {
                inputTokens: usage.inputTokens ?? null,
                outputTokens: usage.outputTokens ?? null,
                totalTokens: usage.totalTokens ?? null,
              }
            : null,
        };
        write(path.join(dir, caseId + '.reply.json'), reply);
        return reply;
      });
    } else {
      invariant(command === 'resume', 'INVALID_COMMAND');
      if (run.state === 'calling')
        await fixture.store.capture(
          test.scope,
          run.id,
          read(path.join(dir, caseId + '.reply.json')),
          run.claimToken,
        );
      await fixture.store.commit(test.scope, run.id);
    }
    const saved = await fixture.store.getRun(test.scope, run.id);
    const view = await fixture.store.read(test.scope);
    let repeated: { state: string; unchanged: boolean } | null = null;
    if (saved.state === 'completed') {
      await fixture.store.ingest(
        test.scope,
        test.input.incomingSourceIds.map((id) => corpus.sources[id]),
      );
      const repeat = await fixture.store.prepare(test.scope, 'live-repeat', run.budgets);
      const after = await fixture.store.read(test.scope);
      repeated = { state: repeat.state, unchanged: canonicalJson(view) === canonicalJson(after) };
    }
    const result = {
      caseId,
      state: saved.state,
      errorCode: saved.errorCode,
      decisions: saved.decisions,
      adopted: saved.adopted,
      view,
      repeated,
    };
    write(path.join(dir, `${caseId}.${command === 'resume' ? 'resumed' : 'result'}.json`), result);
    fs.writeFileSync(
      path.join(dir, `${caseId}.${command === 'resume' ? 'resumed' : 'memory'}.md`),
      view.markdown,
      { flag: 'wx' },
    );
    console.log(
      JSON.stringify({
        caseId,
        state: saved.state,
        errorCode: saved.errorCode,
        pieces: view.usable.pieces.length,
        repeated,
      }),
    );
  } finally {
    await fixture.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        state: 'stopped',
        code:
          error &&
          typeof error === 'object' &&
          'code' in error &&
          typeof error.code === 'string' &&
          /^[A-Z_0-9]+$/.test(error.code)
            ? error.code
            : 'TRIAL_STOPPED',
        automaticRetry: false,
      }),
    );
    process.exitCode = 1;
  });
