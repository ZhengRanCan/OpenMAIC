/** Frozen v0.3.1 write-path trial: U11 first, then I08/U02/U03 after review. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
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
const root = path.join(workspace, 'docs/log/artifacts/F67/memory-v0.3.1-2026-10-26');
const oldRoot = path.join(workspace, 'docs/log/artifacts/F67/memory-v0.2-2026-10-25');
const dir = path.join(root, 'live-write-four-001');
const cases = ['U11', 'I08', 'U02', 'U03'];
const schema = 'f67_write_v031_four_001';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (name: string, value: unknown) =>
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
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
  'eval/learner-memory/writepath-live.ts',
];

async function resolve() {
  const { resolveModel } = await import('@/lib/server/resolve-model');
  return resolveModel({
    stage: 'quiz-evidence',
    workspaceId: null,
    modelString: 'deepseek:deepseek-v4-flash',
  });
}

function modelIdentity(model: Awaited<ReturnType<typeof resolve>>) {
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
  invariant(['prepare', 'run', 'read'].includes(command), 'INVALID_COMMAND');
  const system = fs.readFileSync(path.join(root, 'system-prompt.txt'), 'utf8');
  const corpus = loadStandardCorpus(workspace);
  const negative = loadStandardCorpus(
    workspace,
    'docs/log/artifacts/F67/memory-v0.2-2026-10-25/negative-standard.json',
  );
  const corpusFor = (_id: string) => corpus;
  if (command === 'prepare') {
    invariant(!fs.existsSync(dir), 'BATCH_EXISTS');
    const model = await resolve();
    const identity = modelIdentity(model);
    const oldManifest = read(path.join(oldRoot, 'live-five-001/manifest.json'));
    for (const [key, value] of Object.entries(identity))
      invariant(equal(value, oldManifest[key]), 'BASELINE_MODEL_CHANGED');
    fs.mkdirSync(dir);
    const local = new PGlite();
    const fixture = {
      db: local,
      store: new LearnerMemoryStore({
        withTransaction: (body) => local.transaction(body),
        systemPrompt: system,
      }),
      isolatedDatabase: true as const,
    };
    const files: Record<string, string> = {};
    const comparisons: unknown[] = [];
    const baselineFiles: Record<string, string> = {};
    try {
      await ensureMemorySchema(local);
      for (const id of cases) {
        const selected = corpusFor(id);
        const test = selected.cases.find((c) => c.id === id)!;
        const input = { id: test.id, scope: test.scope, input: test.input };
        const run = await prepareStandardInput(fixture, selected, input, 'v031-write-first');
        const packet = { caseId: id, input, run };
        verifyTrialInput(packet, input);
        checkModelCapacity(
          run.prompt,
          model.modelInfo?.contextWindow,
          model.modelInfo?.outputWindow,
        );
        {
          const old = read(path.join(oldRoot, 'prepared-five-002', id + '.json'));
          invariant(equal(old.input, input), 'BASELINE_INPUT_CHANGED');
          for (const key of ['snapshot', 'aliases', 'batch', 'budgets', 'baseRevision'] as const)
            invariant(equal(old.run[key], run[key]), 'BASELINE_CONTEXT_CHANGED');
          invariant(old.run.prompt.user === run.prompt.user, 'BASELINE_USER_CHANGED');
          for (const name of [
            `prepared-five-002/${id}.json`,
            `live-five-001/${id}.reply.json`,
            `live-five-001/${id}.result.json`,
          ])
            baselineFiles[name] = sha(fs.readFileSync(path.join(oldRoot, name)));
          comparisons.push({
            caseId: id,
            sameUser: true,
            sameContext: true,
            oldSystemChars: [...old.run.prompt.system].length,
            candidateSystemChars: [...system].length,
          });
        }
        write(id + '.json', packet);
        for (const field of ['system', 'user'] as const)
          fs.writeFileSync(path.join(dir, `${id}.${field}-prompt.txt`), run.prompt[field], {
            flag: 'wx',
          });
      }
      for (const name of fs.readdirSync(dir))
        files[name] = sha(fs.readFileSync(path.join(dir, name)));
      write('manifest.json', {
        schemaVersion: 'memory-candidate-live.v1',
        promptCandidate: 'v0.3.1',
        protocol: 'memory.v2',
        cases,
        maximumCalls: 4,
        ...identity,
        standardHashes: [corpus.standardSha256, negative.standardSha256],
        systemSha256: sha(system),
        files,
        baselineFiles,
        comparisons,
        codeFiles: Object.fromEntries(codePaths.map((file) => [file, sha(fs.readFileSync(file))])),
        databaseSchema: schema,
        createdAt: new Date().toISOString(),
        authorization:
          'User requested U11 offline analysis then v0.3.1 live verification; if no blocking issue, I08/U02/U03 once each to verify write paths. No retries/fallback/Judge.',
        semanticApproved: false,
      });
      console.log(JSON.stringify({ state: 'prepared', cases, comparisons, modelCalls: 0 }));
    } finally {
      await local.close();
    }
    return;
  }
  const manifest = read(path.join(dir, 'manifest.json'));
  invariant(cases.includes(caseId), 'CASE_NOT_IN_BATCH');
  invariant(sha(system) === manifest.systemSha256, 'SYSTEM_CHANGED');
  invariant(
    equal(manifest.standardHashes, [corpus.standardSha256, negative.standardSha256]),
    'STANDARD_CHANGED',
  );
  for (const [file, hash] of Object.entries(manifest.files))
    invariant(sha(fs.readFileSync(path.join(dir, file))) === hash, 'PACKET_CHANGED');
  for (const [file, hash] of Object.entries(manifest.baselineFiles))
    invariant(sha(fs.readFileSync(path.join(oldRoot, file))) === hash, 'BASELINE_CHANGED');
  for (const [file, hash] of Object.entries(manifest.codeFiles))
    invariant(sha(fs.readFileSync(file)) === hash, 'TRIAL_CODE_CHANGED');
  const selected = corpusFor(caseId);
  const test = selected.cases.find((c) => c.id === caseId)!;
  const packet = read(path.join(dir, caseId + '.json'));
  verifyTrialInput(packet, { id: test.id, scope: test.scope, input: test.input });
  const fixture = await database(system);
  try {
    if (command === 'run') {
      invariant(approval === '--approved', 'EXPLICIT_TRIAL_APPROVAL_REQUIRED');
      invariant(!fs.existsSync(path.join(dir, caseId + '.attempt.json')), 'ATTEMPT_EXISTS');
      if (caseId !== 'U11') {
        const gate = read(path.join(dir, 'u11-review.json'));
        const u11 = fs.readFileSync(path.join(dir, 'U11.result.json'));
        invariant(gate.proceed === true && gate.resultSha256 === sha(u11), 'U11_REVIEW_REQUIRED');
        invariant(JSON.parse(u11.toString('utf8')).state === 'completed', 'U11_NOT_COMPLETED');
      }
      const run = await prepareStandardInput(fixture, selected, packet.input, packet.run.id);
      invariant(
        equal(run.prompt, packet.run.prompt) && equal(run.aliases, packet.run.aliases),
        'PREPARED_PROMPT_CHANGED',
      );
      const model = await resolve();
      for (const [key, value] of Object.entries(modelIdentity(model)))
        invariant(equal(value, manifest[key]), 'MODEL_CHANGED');
      checkModelCapacity(run.prompt, model.modelInfo?.contextWindow, model.modelInfo?.outputWindow);
      const { callLLM } = await import('@/lib/ai/llm');
      await updateMemory(fixture.store, test.scope, run.id, async (claimed) => {
        write(caseId + '.attempt.json', {
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
        write(caseId + '.reply.json', reply);
        return reply;
      });
      const saved = await fixture.store.getRun(test.scope, run.id);
      const view = await fixture.store.read(test.scope);
      let repeated = null;
      if (saved.state === 'completed') {
        await fixture.store.ingest(
          test.scope,
          test.input.incomingSourceIds.map((id) => selected.sources[id]),
        );
        const repeat = await fixture.store.prepare(test.scope, 'v031-write-repeat', run.budgets);
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
        JSON.stringify({ caseId, state: saved.state, errorCode: saved.errorCode, repeated }),
      );
    } else {
      const saved = await fixture.store.getRun(test.scope, packet.run.id);
      const result = read(path.join(dir, caseId + '.result.json'));
      const view = await fixture.store.read(test.scope);
      invariant(equal(view, result.view), 'READBACK_CHANGED');
      invariant(
        equal(saved.prompt, packet.run.prompt) && equal(saved.aliases, packet.run.aliases),
        'STORED_INPUT_CHANGED',
      );
      invariant(
        equal(saved.decisions, result.decisions) && equal(saved.adopted, result.adopted),
        'STORED_DECISIONS_CHANGED',
      );
      invariant(
        equal(saved.reply, read(path.join(dir, caseId + '.reply.json'))),
        'STORED_REPLY_CHANGED',
      );
      for (const piece of view.snapshot.pieces)
        for (const support of piece.supports)
          invariant(
            Object.values(packet.run.aliases).some((s) => equal(s, support)),
            'SUPPORT_SNAPSHOT_CHANGED',
          );
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
        supports: 'exact',
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
            : 'WRITEPATH_TRIAL_STOPPED',
        automaticRetry: false,
      }),
    );
    process.exitCode = 1;
  });
