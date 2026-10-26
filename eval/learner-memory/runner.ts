import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import type { ConnectableQueryable } from '@openmaic/storage/server/reference';
import { z } from 'zod';
import { loadMemoryCases } from './inputs';
import {
  budgetsSchema,
  DEFAULT_BUDGETS,
  digest,
  emptySnapshot,
  invariant,
  scopeSchema,
  sourceSchema,
  type CapturedMemoryReply,
} from '@/lib/learner-memory/contracts';
import { buildMemoryPrompt, checkModelCapacity } from '@/lib/learner-memory/prompt';
import { LearnerMemoryStore } from '@/lib/persistence/learner-memory-store';
import { ensureMemorySchema } from '@/lib/persistence/learner-memory-schema';
import { updateMemory } from '@/lib/server/learner-memory';

const workspace = path.resolve(process.cwd(), '..');
const root = path.join(workspace, 'docs/log/artifacts/F67/memory-v0.1-2026-10-25');
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8')) as unknown;
const write = (p: string, value: unknown) =>
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const slug = (s: string | undefined) => {
  invariant(s && /^[\w-]{1,80}$/.test(s), 'INVALID_NAME');
  return s;
};
const manifestSchema = z.strictObject({
  schemaVersion: z.literal('memory-experiment.v1'),
  batch: z.string(),
  mode: z.enum(['manual', 'real']),
  cases: z.array(z.string()),
  namespace: z.string(),
  budgets: budgetsSchema,
  maximumCalls: z.number().int().positive().max(12),
  sourceFiles: z.record(z.string(), z.string()),
  codeFiles: z.record(z.string(), z.string()),
  packetFiles: z.record(z.string(), z.string()),
  model: z.string().nullable(),
  contextWindow: z.number().positive().nullable(),
  outputWindow: z.number().positive().nullable(),
});
const packetSchema = z.strictObject({
  caseId: z.string(),
  scope: scopeSchema,
  operationId: z.string(),
  sources: z.array(sourceSchema),
  prompt: z.strictObject({
    version: z.enum(['memory.v1', 'memory.v2']),
    digest: z.string(),
    system: z.string(),
    user: z.string(),
    inputBytes: z.number(),
  }),
});
const codePaths = [
  'lib/learner-memory/contracts.ts',
  'lib/learner-memory/prompt.ts',
  'lib/learner-memory/output-protocol.ts',
  'lib/learner-memory/transition.ts',
  'lib/learner-memory/read.ts',
  'lib/persistence/learner-memory-schema.ts',
  'lib/persistence/learner-memory-store.ts',
  'lib/server/learner-memory.ts',
  'eval/learner-memory/inputs.ts',
  'eval/learner-memory/runner.ts',
];

export function verifyArchivedPacket(
  manifest: Pick<z.infer<typeof manifestSchema>, 'namespace' | 'packetFiles'>,
  caseId: string,
  rawText: string,
) {
  invariant(manifest.packetFiles[caseId] === sha(rawText), 'PACKET_FILE_CHANGED');
  const packet = packetSchema.parse(JSON.parse(rawText));
  invariant(
    packet.caseId === caseId &&
      packet.scope.namespace === manifest.namespace &&
      packet.scope.learnerKey === caseId &&
      packet.operationId === 'initial',
    'PACKET_SCOPE',
  );
  invariant(
    packet.prompt.digest === digest([packet.prompt.system, packet.prompt.user]) &&
      packet.prompt.inputBytes ===
        Buffer.byteLength(packet.prompt.system + packet.prompt.user, 'utf8'),
    'PACKET_PROMPT_HASH',
  );
  return packet;
}

export function verifyPreparedPacket(
  manifest: Pick<z.infer<typeof manifestSchema>, 'namespace' | 'budgets' | 'packetFiles' | 'mode'>,
  caseId: string,
  rawText: string,
) {
  const packet = verifyArchivedPacket(manifest, caseId, rawText);
  invariant(packet.prompt.version === 'memory.v2', 'PROMPT_VERSION_UNSUPPORTED');
  const fixed = loadMemoryCases(workspace, manifest.mode).find((c) => c.caseId === caseId);
  invariant(fixed && isDeepStrictEqual(packet.sources, fixed.sources), 'FIXED_INPUT_MISMATCH');
  const rebuilt = buildMemoryPrompt(emptySnapshot(), fixed.sources, manifest.budgets, []);
  invariant(isDeepStrictEqual(packet.prompt, rebuilt.prompt), 'FIXED_PROMPT_MISMATCH');
  return packet;
}

async function model(modelString?: string) {
  const { resolveModel } = await import('@/lib/server/resolve-model');
  return resolveModel({ stage: 'quiz-evidence', workspaceId: null, modelString });
}
async function database() {
  const { nodePostgresTransaction } = await import('@openmaic/storage/server/reference');
  const url = process.env.MEMORY_DATABASE_URL ?? process.env.PG_CONTRACT_URL;
  invariant(url, 'MEMORY_DATABASE_URL_REQUIRED');
  // This dedicated schema has no stage/owner foreign keys or production initialization.
  const admin = new Pool({ connectionString: url });
  try {
    await admin.query('CREATE SCHEMA IF NOT EXISTS f67_memory_experiment');
  } finally {
    await admin.end();
  }
  const pool = new Pool({
    connectionString: url,
    options: '-c search_path=f67_memory_experiment',
    max: 4,
  });
  try {
    await ensureMemorySchema(pool);
  } catch (e) {
    await pool.end();
    throw e;
  }
  return {
    store: new LearnerMemoryStore({
      withTransaction: nodePostgresTransaction(pool as unknown as ConnectableQueryable),
    }),
    close: () => pool.end(),
  };
}
export async function main(args: string[]) {
  invariant(path.basename(process.cwd()) === 'OpenMAIC', 'RUN_FROM_OPENMAIC');
  const [command, batchArg, caseArg, replyFile] = args;
  const batch = slug(batchArg),
    dir = path.join(root, batch);
  if (command === 'prepare') {
    invariant(caseArg === 'manual' || caseArg === 'real', 'INPUT_MODE_REQUIRED');
    invariant(!fs.existsSync(dir), 'BATCH_EXISTS');
    const cases = loadMemoryCases(workspace, caseArg),
      sourceFiles = Object.assign({}, ...cases.map((c) => c.sealedFiles)) as Record<string, string>;
    const codeFiles = Object.fromEntries(
      codePaths.map((p) => ['OpenMAIC/' + p, sha(fs.readFileSync(path.join(process.cwd(), p)))]),
    );
    fs.mkdirSync(dir, { recursive: true });
    const namespace = 'f67-test:' + batch;
    const packetFiles: Record<string, string> = {};
    for (const c of cases) {
      const built = buildMemoryPrompt(emptySnapshot(), c.sources, DEFAULT_BUDGETS, []);
      write(path.join(dir, c.caseId + '.packet.json'), {
        caseId: c.caseId,
        scope: { namespace, learnerKey: c.caseId },
        operationId: 'initial',
        sources: c.sources,
        prompt: built.prompt,
      });
      packetFiles[c.caseId] = sha(fs.readFileSync(path.join(dir, c.caseId + '.packet.json')));
      fs.writeFileSync(path.join(dir, c.caseId + '.user-prompt.txt'), built.prompt.user, {
        flag: 'wx',
      });
    }
    write(path.join(dir, 'manifest.json'), {
      schemaVersion: 'memory-experiment.v1',
      batch,
      mode: caseArg,
      cases: cases.map((c) => c.caseId),
      namespace,
      budgets: DEFAULT_BUDGETS,
      maximumCalls: cases.length,
      sourceFiles,
      codeFiles,
      packetFiles,
      model: null,
      contextWindow: null,
      outputWindow: null,
    });
    console.log(
      JSON.stringify({
        state: 'prepared',
        cases: cases.length,
        facts: cases.flatMap((c) => c.sources).length,
        modelCalls: 0,
      }),
    );
    return;
  }
  const manifest = manifestSchema.parse(read(path.join(dir, 'manifest.json')));
  invariant(
    manifest.batch === batch && manifest.namespace === 'f67-test:' + batch,
    'BATCH_BINDING',
  );
  if (command === 'configure') {
    invariant(!fs.existsSync(path.join(dir, 'model.json')), 'MODEL_ALREADY_FIXED');
    const packets = manifest.cases.map((id) =>
      verifyPreparedPacket(
        manifest,
        id,
        fs.readFileSync(path.join(dir, id + '.packet.json'), 'utf8'),
      ),
    );
    const resolved = await model(caseArg);
    for (const packet of packets)
      checkModelCapacity(
        packet.prompt,
        resolved.modelInfo?.contextWindow,
        resolved.modelInfo?.outputWindow,
      );
    write(path.join(dir, 'model.json'), {
      model: resolved.modelString,
      provider: resolved.providerId,
      endpointFingerprint: digest(resolved.baseUrl ?? 'default'),
      contextWindow: resolved.modelInfo!.contextWindow,
      outputWindow: resolved.modelInfo!.outputWindow,
      maxOutputTokens: 16000,
      timeoutMs: 180000,
      maxCalls: manifest.maximumCalls,
      retries: 0,
      fallback: false,
      thinking: resolved.thinkingConfig ?? null,
    });
    console.log(
      JSON.stringify({
        state: 'configured',
        model: resolved.modelString,
        maximumCalls: manifest.maximumCalls,
        modelCalls: 0,
      }),
    );
    return;
  }
  if (command === 'report') {
    console.log(
      JSON.stringify(
        {
          batch,
          mode: manifest.mode,
          cases: manifest.cases.map((id) => ({
            caseId: id,
            result: fs.existsSync(path.join(dir, id + '.result.json'))
              ? read(path.join(dir, id + '.result.json'))
              : 'not_run',
          })),
        },
        null,
        2,
      ),
    );
    return;
  }
  const caseId = slug(caseArg);
  invariant(manifest.cases.includes(caseId), 'CASE_NOT_IN_BATCH');
  if (command === 'cleanup') {
    const db = await database();
    try {
      await db.store.deleteExperiment({ namespace: manifest.namespace, learnerKey: caseId });
    } finally {
      await db.close();
    }
    console.log('Deleted selected experimental scope.');
    return;
  }
  if (command === 'read') {
    // Archived requests remain readable; do not rebuild them with a newer generation protocol.
    const packet = verifyArchivedPacket(
      manifest,
      caseId,
      fs.readFileSync(path.join(dir, caseId + '.packet.json'), 'utf8'),
    );
    const db = await database();
    try {
      console.log((await db.store.read(packet.scope)).markdown);
    } finally {
      await db.close();
    }
    return;
  }
  const packet = verifyPreparedPacket(
    manifest,
    caseId,
    fs.readFileSync(path.join(dir, caseId + '.packet.json'), 'utf8'),
  );
  invariant(
    packet.caseId === caseId &&
      packet.scope.namespace === manifest.namespace &&
      packet.scope.learnerKey === caseId &&
      packet.operationId === 'initial',
    'PACKET_SCOPE',
  );
  invariant(
    new Set(manifest.cases).size === manifest.cases.length &&
      manifest.maximumCalls === manifest.cases.length,
    'BATCH_CALL_LIMIT',
  );
  for (const [file, hash] of Object.entries(manifest.sourceFiles))
    invariant(sha(fs.readFileSync(path.join(workspace, file))) === hash, 'SOURCE_CHANGED');
  if (command === 'run') {
    invariant(replyFile === '--approved', 'EXPLICIT_BATCH_APPROVAL_REQUIRED');
    if (manifest.mode === 'manual' && !['N04', 'N02'].includes(caseId))
      for (const first of ['N04', 'N02'])
        invariant(
          z
            .object({ state: z.literal('completed') })
            .safeParse(read(path.join(dir, first + '.result.json'))).success,
          'FIRST_PAIR_NOT_COMPLETE',
        );
    for (const [file, hash] of Object.entries(manifest.codeFiles))
      invariant(sha(fs.readFileSync(path.join(workspace, file))) === hash, 'PREPARED_CODE_CHANGED');
  }
  const db = await database();
  try {
    await db.store.ingest(packet.scope, packet.sources);
    const run = await db.store.prepare(packet.scope, packet.operationId, manifest.budgets);
    invariant(run.prompt.digest === packet.prompt.digest, 'PREPARED_MEMORY_CHANGED');
    if (command === 'import') {
      invariant(replyFile && fs.statSync(replyFile).size <= 250000, 'REPLY_FILE_REQUIRED');
      const text = fs.readFileSync(replyFile, 'utf8');
      await db.store.capture(packet.scope, run.id, {
        text,
        finishReason: 'stop',
        usage: null,
        model: 'manual-fixture',
        origin: 'manual',
      });
      await db.store.commit(packet.scope, run.id);
    } else if (command === 'resume') {
      const captured = path.join(dir, caseId + '.reply.json');
      if (run.state === 'calling' && fs.existsSync(captured))
        await db.store.capture(
          packet.scope,
          run.id,
          read(captured) as CapturedMemoryReply,
          run.claimToken,
        );
      await db.store.commit(packet.scope, run.id);
    } else if (command === 'repeat') {
      const repeated = await db.store.prepare(packet.scope, 'repeat', manifest.budgets);
      console.log(JSON.stringify({ state: repeated.state, pending: repeated.batch.length }));
      return;
    } else if (command === 'run') {
      const cfg = z
        .object({
          model: z.string(),
          provider: z.string(),
          endpointFingerprint: z.string(),
          thinking: z.unknown(),
        })
        .parse(read(path.join(dir, 'model.json')));
      const resolved = await model(cfg.model);
      invariant(
        resolved.modelString === cfg.model &&
          digest(resolved.thinkingConfig ?? null) === digest(cfg.thinking),
        'MODEL_CHANGED',
      );
      invariant(
        resolved.providerId === cfg.provider &&
          digest(resolved.baseUrl ?? 'default') === cfg.endpointFingerprint,
        'MODEL_CHANGED',
      );
      checkModelCapacity(
        run.prompt,
        resolved.modelInfo?.contextWindow,
        resolved.modelInfo?.outputWindow,
      );
      const { callLLM } = await import('@/lib/ai/llm');
      await updateMemory(db.store, packet.scope, run.id, async (claimed) => {
        const marker = path.join(dir, caseId + '.attempt.json');
        // Marker precedes network execution; an unknown result is never silently replayed.
        write(marker, {
          state: 'calling',
          operationId: run.id,
          model: resolved.modelString,
          startedAt: new Date().toISOString(),
        });
        const output = await callLLM(
          {
            model: resolved.model,
            system: claimed.prompt.system,
            prompt: claimed.prompt.user,
            maxOutputTokens: 16000,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(180000),
          },
          'f67-memory',
          { retries: 0 },
          resolved.thinkingConfig,
          { enabled: false, serverManaged: resolved.serverManaged },
        );
        const u = output.totalUsage ?? output.usage;
        const reply: CapturedMemoryReply = {
          text: output.text,
          finishReason: output.finishReason,
          model: output.response?.modelId ?? resolved.modelString,
          origin: 'model',
          usage: u
            ? {
                inputTokens: u.inputTokens ?? null,
                outputTokens: u.outputTokens ?? null,
                totalTokens: u.totalTokens ?? null,
              }
            : null,
        };
        write(path.join(dir, caseId + '.reply.json'), reply);
        return reply;
      });
    } else throw new Error('UNKNOWN_COMMAND');
    const saved = await db.store.getRun(packet.scope, run.id),
      view = await db.store.read(packet.scope);
    const result = {
      state: saved.state,
      errorCode: saved.errorCode,
      decisions: saved.decisions,
      adopted: saved.adopted,
      view,
    };
    const resultPath = path.join(dir, caseId + '.result.json');
    if (!fs.existsSync(resultPath)) write(resultPath, result);
    const markdownPath = path.join(dir, caseId + '.memory.md');
    if (!fs.existsSync(markdownPath)) fs.writeFileSync(markdownPath, view.markdown, { flag: 'wx' });
    console.log(
      JSON.stringify({
        caseId,
        state: saved.state,
        pieces: view.usable.pieces.length,
        pending: view.coverage.filter((c) => c.current && c.valid && !c.processed).length,
      }),
    );
  } finally {
    await db.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch((error: unknown) => {
    const code =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string' &&
      /^[A-Z_0-9]+$/.test(error.code)
        ? error.code
        : 'COMMAND_FAILED';
    console.error(JSON.stringify({ state: 'stopped', code, automaticRetry: false }));
    process.exitCode = 1;
  });
