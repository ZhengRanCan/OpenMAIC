/** Executes only the three frozen v0.3.1 rejection inputs, once per case. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import type { ConnectableQueryable } from '@openmaic/storage/server/reference';
import { loadStandardCorpus, prepareStandardInput } from './standard-replay';
import { verifyTrialInput } from './standard-live';
import {
  canonicalJson,
  digest,
  invariant,
  type CapturedMemoryReply,
} from '@/lib/learner-memory/contracts';
import { checkModelCapacity } from '@/lib/learner-memory/prompt';
import { LearnerMemoryStore } from '@/lib/persistence/learner-memory-store';
import { ensureMemorySchema } from '@/lib/persistence/learner-memory-schema';
import { updateMemory } from '@/lib/server/learner-memory';

const workspace = path.resolve(process.cwd(), '..');
const base = path.join(workspace, 'docs/log/artifacts/F67');
const root = path.join(base, 'memory-v0.3.1-2026-10-26');
const prepared = path.join(root, 'prepared-rejection-three-001');
const dir = path.join(root, 'live-rejection-three-001');
const cases = ['N01', 'N02', 'U06'];
const schema = 'f67_rejection_v031_three_001';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (name: string, value: unknown) =>
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

async function resolve() {
  const { resolveModel } = await import('@/lib/server/resolve-model');
  return resolveModel({
    stage: 'quiz-evidence',
    workspaceId: null,
    modelString: 'deepseek:deepseek-v4-flash',
  });
}
function identity(model: Awaited<ReturnType<typeof resolve>>) {
  return {
    model: model.modelString,
    provider: model.providerId,
    endpointFingerprint: digest(model.baseUrl ?? 'default'),
    thinking: model.thinkingConfig ?? null,
    maxOutputTokens: 16000,
    timeoutMs: 180000,
    retries: 0,
    fallback: false,
  };
}
async function database(systemPrompt: string) {
  const url = process.env.MEMORY_DATABASE_URL ?? process.env.PG_CONTRACT_URL;
  invariant(url, 'MEMORY_DATABASE_URL_REQUIRED');
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
      systemPrompt,
    }),
    isolatedDatabase: true as const,
    close: () => pool.end(),
  };
}

async function main() {
  invariant(path.basename(process.cwd()) === 'OpenMAIC', 'RUN_FROM_OPENMAIC');
  const [command, caseId, approval] = process.argv.slice(2);
  invariant(['configure', 'run', 'read'].includes(command), 'INVALID_COMMAND');
  const original = read(path.join(prepared, 'manifest.json'));
  const system = fs.readFileSync(path.join(root, 'system-prompt.txt'), 'utf8');
  invariant(sha(system) === original.systemSha256, 'SYSTEM_CHANGED');
  for (const [file, hash] of Object.entries(original.files))
    invariant(sha(fs.readFileSync(path.join(prepared, file))) === hash, 'PREPARED_FILE_CHANGED');
  for (const [file, hash] of Object.entries(original.codeFiles))
    invariant(sha(fs.readFileSync(file)) === hash, 'PREPARED_CODE_CHANGED');
  const standard = loadStandardCorpus(workspace);
  const negatives = loadStandardCorpus(
    workspace,
    'docs/log/artifacts/F67/memory-v0.2-2026-10-25/negative-standard.json',
  );
  invariant(
    equal(original.standardHashes, [negatives.standardSha256, standard.standardSha256]),
    'STANDARD_CHANGED',
  );
  const corpusFor = (id: string) => (id === 'U06' ? standard : negatives);
  const inputFor = (id: string) => {
    const corpus = corpusFor(id);
    const test = corpus.cases.find((c) => c.id === id)!;
    const fixed = { id: test.id, scope: test.scope, input: test.input };
    const packet = read(path.join(prepared, id + '.json'));
    verifyTrialInput(packet, fixed);
    invariant(
      packet.run.prompt.system === system && packet.run.state === 'prepared',
      'UNEXPECTED_PACKET',
    );
    return { corpus, test, fixed, packet };
  };
  if (command === 'configure') {
    invariant(!fs.existsSync(dir), 'BATCH_EXISTS');
    const model = await resolve();
    const baseline = read(path.join(base, 'memory-v0.2-2026-10-25/live-five-001/manifest.json'));
    for (const [key, value] of Object.entries(identity(model)))
      invariant(equal(value, baseline[key]), 'BASELINE_MODEL_CHANGED');
    for (const id of cases)
      checkModelCapacity(
        inputFor(id).packet.run.prompt,
        model.modelInfo?.contextWindow,
        model.modelInfo?.outputWindow,
      );
    const extraCode = [
      'lib/server/learner-memory.ts',
      'eval/learner-memory/standard-live.ts',
      'eval/learner-memory/rejection-live.ts',
    ];
    fs.mkdirSync(dir);
    write('manifest.json', {
      schemaVersion: 'memory-rejection-live.v1',
      promptCandidate: 'v0.3.1',
      protocol: 'memory.v2',
      cases,
      maximumCalls: 3,
      ...identity(model),
      judge: false,
      databaseSchema: schema,
      preparedManifestSha256: sha(fs.readFileSync(path.join(prepared, 'manifest.json'))),
      codeFiles: {
        ...original.codeFiles,
        ...Object.fromEntries(extraCode.map((file) => [file, sha(fs.readFileSync(file))])),
      },
      authorization:
        'User replied 可以，弄吧 to the frozen N01/N02/U06 preparation; one live call per case; no retries/fallback/Judge.',
      createdAt: new Date().toISOString(),
      semanticApproved: false,
    });
    console.log(
      JSON.stringify({ state: 'configured', cases, model: model.modelString, modelCalls: 0 }),
    );
    return;
  }
  const manifest = read(path.join(dir, 'manifest.json'));
  invariant(cases.includes(caseId), 'CASE_NOT_IN_BATCH');
  invariant(
    sha(fs.readFileSync(path.join(prepared, 'manifest.json'))) === manifest.preparedManifestSha256,
    'PREPARATION_CHANGED',
  );
  for (const [file, hash] of Object.entries(manifest.codeFiles))
    invariant(sha(fs.readFileSync(file)) === hash, 'TRIAL_CODE_CHANGED');
  const { corpus, test, fixed, packet } = inputFor(caseId);
  const fixture = await database(system);
  try {
    if (command === 'run') {
      invariant(approval === '--approved', 'EXPLICIT_TRIAL_APPROVAL_REQUIRED');
      invariant(!fs.existsSync(path.join(dir, caseId + '.attempt.json')), 'ATTEMPT_EXISTS');
      const run = await prepareStandardInput(fixture, corpus, fixed, packet.run.id);
      invariant(
        equal(run.prompt, packet.run.prompt) &&
          equal(run.aliases, packet.run.aliases) &&
          equal(run.snapshot, packet.run.snapshot),
        'PREPARED_CONTEXT_CHANGED',
      );
      const model = await resolve();
      for (const [key, value] of Object.entries(identity(model)))
        invariant(equal(value, manifest[key]), 'MODEL_CHANGED');
      checkModelCapacity(run.prompt, model.modelInfo?.contextWindow, model.modelInfo?.outputWindow);
      const { callLLM } = await import('@/lib/ai/llm');
      await updateMemory(fixture.store, test.scope, run.id, async (claimed) => {
        write(caseId + '.attempt.json', {
          state: 'calling',
          operationId: claimed.id,
          promptDigest: claimed.prompt.digest,
          model: model.modelString,
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
        write(caseId + '.reply.json', reply);
        return reply;
      });
      const saved = await fixture.store.getRun(test.scope, run.id);
      const view = await fixture.store.read(test.scope);
      let repeated = null;
      if (saved.state === 'completed') {
        await fixture.store.ingest(
          test.scope,
          test.input.incomingSourceIds.map((id) => corpus.sources[id]),
        );
        const repeat = await fixture.store.prepare(test.scope, 'rejection-repeat', run.budgets);
        repeated = {
          state: repeat.state,
          unchanged: equal(view, await fixture.store.read(test.scope)),
        };
      }
      write(caseId + '.result.json', {
        caseId,
        state: saved.state,
        errorCode: saved.errorCode,
        decisions: saved.decisions,
        adopted: saved.adopted,
        view,
        repeated,
      });
      fs.writeFileSync(path.join(dir, caseId + '.memory.md'), view.markdown, { flag: 'wx' });
      console.log(
        JSON.stringify({
          caseId,
          state: saved.state,
          errorCode: saved.errorCode,
          decisions: saved.decisions,
          repeated,
        }),
      );
    } else {
      const saved = await fixture.store.getRun(test.scope, packet.run.id);
      const view = await fixture.store.read(test.scope);
      const result = read(path.join(dir, caseId + '.result.json'));
      invariant(equal(view, result.view), 'READBACK_CHANGED');
      invariant(
        equal(saved.reply, read(path.join(dir, caseId + '.reply.json'))),
        'RAW_REPLY_CHANGED',
      );
      invariant(
        equal(saved.prompt, packet.run.prompt) && equal(saved.aliases, packet.run.aliases),
        'INPUT_CHANGED',
      );
      invariant(
        equal(saved.decisions, result.decisions) && equal(saved.adopted, result.adopted),
        'DECISIONS_CHANGED',
      );
      for (const piece of view.snapshot.pieces) {
        for (const support of piece.supports)
          invariant(
            Object.values(packet.run.aliases).some((s) => equal(s, support)),
            'SUPPORT_SNAPSHOT_CHANGED',
          );
        invariant(
          equal(piece.conditions, [...new Set(piece.supports.flatMap((s) => s.conditions))]),
          'CONDITIONS_CHANGED',
        );
      }
      for (const section of ['background', 'goals', 'teaching_requirements'] as const) {
        invariant(
          equal(view.snapshot.sections[section], packet.run.snapshot.sections[section]),
          'OTHER_SECTION_CHANGED',
        );
        for (const id of view.snapshot.sections[section])
          invariant(
            equal(
              view.snapshot.pieces.find((p) => p.id === id),
              packet.run.snapshot.pieces.find((p: { id: string }) => p.id === id),
            ),
            'OTHER_PIECE_CHANGED',
          );
      }
      const verification = {
        caseId,
        readback: 'match',
        rawReply: 'match',
        promptAndAliases: 'match',
        supportsAndConditions: 'exact',
        otherSections: 'unchanged',
        repeated: result.repeated,
        verifiedAt: new Date().toISOString(),
      };
      write(caseId + '.verification.json', verification);
      console.log(JSON.stringify(verification));
    }
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
            : 'REJECTION_TRIAL_STOPPED',
        automaticRetry: false,
      }),
    );
    process.exitCode = 1;
  });
