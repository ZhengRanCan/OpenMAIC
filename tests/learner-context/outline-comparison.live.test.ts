/**
 * Opt-in, two-phase F65 A/C outline observation. Default test runs perform no IO.
 * Parent supplies TEST_LOAD_LOCAL_ENV=1, DATABASE_URL, MEMORY_DATABASE_URL and:
 * F65_OUTLINE_COMPARISON_MODE=prepare|live, F65_OUTLINE_COMPARISON_DIR=<fixed artifact root>.
 * Each live identity is attempted once. Removing attempt markers is not a retry mechanism.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { buildOutlinePrompt } from '@openmaic/generation';
import { canonicalJson } from '@/lib/learner-memory/contracts';
import { simulatedScope } from '@/lib/learner-memory/simulated-seeds';
import type { PreclassSelectionPrompt } from '@/lib/learner-context/contracts';
import { buildPreclassLearnerContext } from '@/lib/server/preclass-learner-context';
import { resolveModel } from '@/lib/server/resolve-model';
import { backgroundWorkspaceId } from '@/lib/server/model-config/runtime';
import { resolveServerGenerationCapabilities } from '@/lib/server/generation-capabilities';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { executeGenerationRun, runRequirements } from '@/lib/server/generation/run/engine';
import { defaultRunStepServices, type RunStepServices } from '@/lib/server/generation/run/services';
import { generationRunConfig } from '@/lib/server/generation/run/config';
import { parseRunInput } from '@/lib/server/generation/run/input';
import {
  claimNextGenerationRun,
  createGenerationRun,
  heartbeatGenerationRun,
  readGenerationRun,
  readGenerationRunEvents,
  readGenerationRunSteps,
  releaseGenerationRunLease,
  runSnapshot,
} from '@/lib/server/generation/run/store';
import type { GenerationRunInput } from '@/lib/server/generation/run/types';

interface CallToken {
  kind: 'selection' | 'outline';
}
interface CapturedReply {
  text?: string;
  finishReason?: string;
  usage?: unknown;
  errorCode?: string;
  streamError?: boolean;
}
interface ActiveCase {
  student: 'A' | 'C';
  dir: string;
  counts: { selection: number; outline: number };
  blockedCalls: number;
  replies: Partial<Record<CallToken['kind'], CapturedReply>>;
  usage: unknown[];
  forbiddenServices: string[];
  expectedOutline?: { system: string; user: string };
}
const interception = vi.hoisted(() => ({
  begin: undefined as
    | undefined
    | ((
        kind: CallToken['kind'],
        params: Record<string, unknown>,
        source: string,
        extra: Record<string, unknown>,
      ) => CallToken),
  finish: undefined as undefined | ((token: CallToken, reply: CapturedReply) => void),
  usage: undefined as undefined | ((input: unknown) => void),
}));

// Only transport budgets and capture are changed. Real prompts and model outputs pass through.
vi.mock('@/lib/ai/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/llm')>();
  return {
    ...actual,
    callLLM: async (...args: Parameters<typeof actual.callLLM>) => {
      const [params, source, retries, thinking, fallback] = args;
      if (!interception.begin || !interception.finish) throw new Error('F65_MODEL_CALL_NOT_ARMED');
      const token = interception.begin('selection', params, source, {
        retries,
        thinking,
        fallback,
      });
      try {
        const result = await actual.callLLM(params, source, retries, thinking, fallback);
        interception.finish(token, {
          text: result.text,
          finishReason: result.finishReason,
          usage: result.totalUsage ?? result.usage,
        });
        return result;
      } catch {
        interception.finish(token, { errorCode: 'F65_SELECTION_CALL_FAILED' });
        throw new Error('F65_SELECTION_CALL_FAILED');
      }
    },
    streamLLM: (...args: Parameters<typeof actual.streamLLM>) => {
      const [params, source, thinking, fallback] = args;
      if (!interception.begin || !interception.finish) throw new Error('F65_MODEL_CALL_NOT_ARMED');
      const token = interception.begin('outline', params, source, { thinking, fallback });
      try {
        const result = actual.streamLLM(
          { ...params, maxRetries: 0, maxOutputTokens: 4096 },
          source,
          thinking,
          { enabled: false },
        );
        const stream = result.fullStream;
        async function* capturedStream() {
          const reply: CapturedReply = { streamError: false };
          try {
            for await (const part of stream) {
              if (part.type === 'error') reply.streamError = true;
              if (part.type === 'finish') {
                reply.finishReason = part.finishReason;
                reply.usage = part.totalUsage;
              }
              // Never inspect or persist reasoning deltas, and preserve every original part.
              yield part;
            }
          } catch (error) {
            reply.errorCode = 'F65_OUTLINE_STREAM_FAILED';
            throw error;
          } finally {
            interception.finish!(token, reply);
          }
        }
        return new Proxy(result, {
          get(target, key, receiver) {
            return key === 'fullStream' ? capturedStream() : Reflect.get(target, key, receiver);
          },
        });
      } catch {
        interception.finish(token, { errorCode: 'F65_OUTLINE_CALL_FAILED' });
        throw new Error('F65_OUTLINE_CALL_FAILED');
      }
    },
  };
});
vi.mock('@/lib/server/usage-storage', () => ({
  recordUsage: async (input: unknown) => {
    interception.usage?.(input);
  },
  recordGenerationUsage: async () => {
    throw new Error('F65_NON_LLM_USAGE_FORBIDDEN');
  },
}));

const BASELINE_RUN = 'run-VJ9hDi6uen8-maAA';
const FIXED_ROOT = path.resolve(
  '../docs/log/artifacts/F65/outline-comparison-2026-10-27/batch-003',
);
const BASELINE_MANIFEST = path.resolve(
  '../docs/log/artifacts/F65/simulated-context-mvp-2026-10-26/live-one-001/manifest.json',
);
const mode = process.env.F65_OUTLINE_COMPARISON_MODE;
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const digest = (value: unknown) => sha(canonicalJson(value));
function requireCondition(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
function failureCode(error: unknown) {
  return error instanceof Error && /^F65_[A-Z_]+$/.test(error.message)
    ? error.message
    : 'F65_UNEXPECTED_FAILURE';
}
function numericUsage(value: unknown): unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (!value || typeof value !== 'object') return undefined;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      const safe = numericUsage(item);
      return safe === undefined ? [] : [[key, safe]];
    }),
  );
}

interface Manifest {
  version: 'f65-outline-comparison.v1';
  referenceRunId: string;
  ownerDigest: string;
  workspaceDigest: string;
  taskDigest: string;
  inputDigest: string;
  memoryDigest: string;
  codeDigest: string;
  codeFiles: Record<string, string>;
  inputs: Record<'A' | 'C', GenerationRunInput>;
  model: Record<string, unknown>;
  capabilities: Record<string, boolean>;
  prompts: {
    selectionSystem: string;
    selectionUser: string;
    outlineSystem: string;
    emptyOutlineUser: string;
  };
  observationBudget: Record<string, unknown>;
}

function productionFingerprints() {
  const files: Record<string, string> = {};
  function collect(absolute: string, label: string) {
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) {
        if (name === 'node_modules' || name === '.git') continue;
        collect(path.join(absolute, name), `${label}/${name}`);
      }
    } else files[label] = sha(fs.readFileSync(absolute));
  }
  for (const target of [
    'lib/learner-context',
    'lib/learner-memory',
    'lib/server/preclass-learner-context.ts',
    'lib/server/learner-memory.ts',
    'lib/persistence/learner-memory-store.ts',
    'lib/server/generation/run',
    'lib/server/generation/steps/outline.ts',
    'lib/server/generation-capabilities.ts',
    'lib/server/resolve-model.ts',
    'lib/server/model-config',
    'lib/ai',
    'lib/prompts',
    'tests/learner-context/outline-comparison.live.test.ts',
  ])
    collect(path.resolve(target), target);
  const generationRoot = fs.realpathSync(path.resolve('node_modules/@openmaic/generation'));
  for (const target of ['package.json', 'dist', 'src', 'templates', 'snippets', 'prompts-pbl'])
    collect(path.join(generationRoot, target), `@openmaic/generation/${target}`);
  return files;
}

async function memorySnapshot(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
    statement_timeout: 10000,
    lock_timeout: 5000,
    options: '-c search_path=f67_simulated_memory',
  });
  pool.on('error', () => undefined);
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot: Record<string, unknown> = {};
    for (const student of ['A', 'B', 'C'] as const) {
      const scope = simulatedScope(student),
        keys = [scope.namespace, scope.learnerKey];
      const state = await client.query(
        'SELECT namespace,learner_key,snapshot,maintenance FROM learner_memory_states WHERE namespace=$1 AND learner_key=$2',
        keys,
      );
      requireCondition(state.rows.length === 1, 'F65_MEMORY_NOT_INITIALIZED');
      requireCondition(!state.rows[0].maintenance, 'F65_MEMORY_MAINTENANCE_PENDING');
      const sources = await client.query(
        'SELECT source_id,version,data,valid,current,processed FROM learner_memory_sources WHERE namespace=$1 AND learner_key=$2 ORDER BY source_id,version',
        keys,
      );
      const runs = await client.query(
        'SELECT id,state,data FROM learner_memory_runs WHERE namespace=$1 AND learner_key=$2 ORDER BY id',
        keys,
      );
      requireCondition(
        !runs.rows.some((row) => ['prepared', 'calling', 'captured'].includes(row.state)),
        'F65_MEMORY_UPDATE_ACTIVE',
      );
      snapshot[student] = { state: state.rows[0], sources: sources.rows, runs: runs.rows };
    }
    await client.query('COMMIT');
    return snapshot;
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

describe.skipIf(!mode)('F65 explicit A/C outline comparison', () => {
  it('prepares or executes the frozen one-attempt batch', { timeout: 250_000 }, async () => {
    // Production logs can include transport errors. The harness exports only fixed failure codes.
    const muted = ['log', 'info', 'warn', 'error', 'debug'].map((key) =>
      vi.spyOn(console, key as 'log').mockImplementation(() => undefined),
    );
    const secrets = new Set<string>();
    let active: ActiveCase | undefined;
    let appPool: Pool | undefined;
    let persistence: Awaited<ReturnType<typeof getServerPersistenceProvider>> | undefined;
    let root: string | undefined;
    let beforeMemory: Record<string, unknown> | undefined;
    let memoryUrl: string | undefined;
    const redacted = (text: string) => {
      let safe = text;
      for (const secret of secrets) if (secret) safe = safe.split(secret).join('[REDACTED]');
      return safe;
    };
    function write(file: string, value: unknown, plain = false) {
      const body =
        redacted(
          plain
            ? String(value)
            : JSON.stringify(
                value,
                (key, item) => {
                  if (/^(ownerId|owner_id|apiKey|authorization|connectionString)$/i.test(key))
                    return '[REDACTED]';
                  return item;
                },
                2,
              ),
        ) + (plain ? '' : '\n');
      const handle = fs.openSync(file, 'wx');
      try {
        fs.writeFileSync(handle, body);
        fs.fsyncSync(handle);
      } finally {
        fs.closeSync(handle);
      }
    }
    try {
      requireCondition(mode === 'prepare' || mode === 'live', 'F65_MODE_INVALID');
      requireCondition(process.env.TEST_LOAD_LOCAL_ENV === '1', 'F65_LOCAL_ENV_OPT_IN_REQUIRED');
      root = path.resolve(process.env.F65_OUTLINE_COMPARISON_DIR ?? '');
      requireCondition(root === FIXED_ROOT, 'F65_ARTIFACT_ROOT_MISMATCH');
      const appUrl = process.env.DATABASE_URL?.trim();
      memoryUrl = process.env.MEMORY_DATABASE_URL?.trim();
      requireCondition(appUrl && memoryUrl, 'F65_DATABASE_CONFIGURATION_REQUIRED');
      for (const [name, value] of Object.entries(process.env))
        if (value && /KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL/.test(name)) secrets.add(value);
      appPool = new Pool({
        connectionString: appUrl,
        max: 1,
        connectionTimeoutMillis: 5000,
        query_timeout: 10000,
      });
      appPool.on('error', () => undefined);
      const original = await appPool.query<{ owner_id: string; input: GenerationRunInput }>(
        'SELECT owner_id,input FROM generation_runs WHERE id=$1',
        [BASELINE_RUN],
      );
      requireCondition(original.rows.length === 1, 'F65_BASELINE_RUN_MISSING');
      const { owner_id: owner, input: baseline } = original.rows[0];
      secrets.add(owner);
      requireCondition(parseRunInput(baseline).ok, 'F65_BASELINE_INPUT_INVALID');
      requireCondition(
        !('learnerProfile' in baseline) &&
          baseline.materialIds.length === 0 &&
          baseline.interactive === false &&
          baseline.taskEngine === false &&
          baseline.simulatedLearner === 'B',
        'F65_BASELINE_SCOPE_MISMATCH',
      );
      const oldManifest = JSON.parse(fs.readFileSync(BASELINE_MANIFEST, 'utf8'));
      requireCondition(
        sha(oldManifest.task) === sha(baseline.requirement),
        'F65_BASELINE_TASK_MISMATCH',
      );
      persistence = await getServerPersistenceProvider(appUrl);
      const workspace = await backgroundWorkspaceId(owner);
      secrets.add(workspace);
      const capabilities = await resolveServerGenerationCapabilities(workspace);
      requireCondition(
        Object.values(capabilities).every((value) => value === false),
        'F65_CAPABILITIES_CHANGED',
      );
      const resolved = await resolveModel({
        stage: 'scene-outlines-stream',
        workspaceId: workspace,
      });
      secrets.add(resolved.apiKey);
      if (resolved.baseUrl) secrets.add(resolved.baseUrl);
      requireCondition(
        resolved.modelId === 'deepseek-v4-flash' && resolved.serverManaged,
        'F65_FLASH_SLOT_REQUIRED',
      );
      const sdkModel = resolved.model;
      requireCondition(typeof sdkModel === 'object', 'F65_RESOLVED_MODEL_OBJECT_REQUIRED');
      const safeModel = {
        providerId: resolved.providerId,
        modelId: resolved.modelId,
        modelString: resolved.modelString,
        sdkProvider: sdkModel.provider,
        sdkModelId: sdkModel.modelId,
        serverManaged: resolved.serverManaged,
        thinkingConfig: resolved.thinkingConfig ?? null,
        contextWindow: resolved.modelInfo?.contextWindow ?? null,
        outputWindow: resolved.modelInfo?.outputWindow ?? null,
        endpointDigest: sha(resolved.baseUrl ?? ''),
      };
      const inputs = Object.fromEntries(
        (['A', 'C'] as const).map((student) => [
          student,
          {
            ...structuredClone(baseline),
            simulatedLearner: student,
            outlineReview: 'wait' as const,
          },
        ]),
      ) as Record<'A' | 'C', GenerationRunInput>;
      beforeMemory = await memorySnapshot(memoryUrl);
      const codeFiles = productionFingerprints();
      const emptyPrompts = buildOutlinePrompt(runRequirements(inputs.A, false), {
        imageGenerationEnabled: false,
        videoGenerationEnabled: false,
      });
      const common = {
        version: 'f65-outline-comparison.v1' as const,
        referenceRunId: BASELINE_RUN,
        ownerDigest: sha(owner),
        workspaceDigest: sha(workspace),
        taskDigest: sha(baseline.requirement),
        inputDigest: digest(baseline),
        memoryDigest: digest(beforeMemory),
        codeDigest: digest(codeFiles),
        codeFiles,
        inputs,
        model: safeModel,
        capabilities: { ...capabilities },
      };
      if (mode === 'prepare') {
        requireCondition(
          !fs.existsSync(root) || fs.readdirSync(root).length === 0,
          'F65_PREPARE_DIRECTORY_NOT_EMPTY',
        );
        fs.mkdirSync(root, { recursive: true });
        let selectionPrompt: PreclassSelectionPrompt | undefined;
        let calls = 0;
        const emptyContext = await buildPreclassLearnerContext(
          { student: 'A', task: baseline.requirement, content: {} },
          {
            select: async () => {
              throw new Error('F65_A_MUST_SKIP_SELECTION');
            },
          },
        );
        requireCondition(
          emptyContext.status === 'empty' && emptyContext.selected.length === 0,
          'F65_A_NOT_EMPTY',
        );
        await buildPreclassLearnerContext(
          { student: 'C', task: baseline.requirement, content: {} },
          {
            select: async (prompt) => {
              selectionPrompt = prompt;
              calls++;
              return '{"selected":[]}';
            },
          },
        );
        requireCondition(selectionPrompt && calls === 1, 'F65_C_CANDIDATES_REQUIRED');
        requireCondition(
          digest(await memorySnapshot(memoryUrl)) === common.memoryDigest,
          'F65_MEMORY_CHANGED_DURING_PREPARE',
        );
        write(path.join(root, 'memory-prepared.json'), beforeMemory);
        write(path.join(root, 'A.empty-context.json'), emptyContext);
        write(path.join(root, 'C.selection.system.txt'), selectionPrompt.system, true);
        write(path.join(root, 'C.selection.user.json'), selectionPrompt.user, true);
        write(path.join(root, 'outline.system.txt'), emptyPrompts.system, true);
        write(path.join(root, 'A.outline.user.txt'), emptyPrompts.user, true);
        const manifest: Manifest = {
          ...common,
          prompts: {
            selectionSystem: sha(selectionPrompt.system),
            selectionUser: sha(selectionPrompt.user),
            outlineSystem: sha(emptyPrompts.system),
            emptyOutlineUser: sha(emptyPrompts.user),
          },
          observationBudget: {
            modelCallsDuringPrepare: 0,
            identities: { A: { selection: 0, outline: 1 }, C: { selection: 1, outline: 1 } },
            selectionMaxOutputTokens: 2000,
            outlineMaxOutputTokens: 4096,
            sdkMaxRetries: 0,
            fallback: false,
            perIdentityTimeoutMs: 180000,
            batchTimeoutMs: 240000,
            originalOutlineMaxOutputTokens: resolved.modelInfo?.outputWindow ?? null,
            originalOutlineSdkMaxRetries: 2,
            strictCausalComparisonWithB: false,
            comparisonLimit:
              'A/C use the unchanged production prompts with a harness-only 4096-token outline ceiling and zero transport retries; B used the native outputWindow ceiling. This is an observation, not a strictly paired causal experiment.',
            productionPromptChanged: false,
          },
        };
        write(path.join(root, 'prepared-manifest.json'), manifest);
        return;
      }
      const manifest: Manifest = JSON.parse(
        fs.readFileSync(path.join(root, 'prepared-manifest.json'), 'utf8'),
      );
      for (const key of [
        'version',
        'referenceRunId',
        'ownerDigest',
        'workspaceDigest',
        'taskDigest',
        'inputDigest',
        'memoryDigest',
        'codeDigest',
        'inputs',
        'model',
        'capabilities',
      ] as const)
        requireCondition(
          digest(manifest[key]) === digest(common[key]),
          'F65_FROZEN_PREFLIGHT_CHANGED',
        );
      requireCondition(
        manifest.prompts.outlineSystem === sha(emptyPrompts.system) &&
          manifest.prompts.emptyOutlineUser === sha(emptyPrompts.user),
        'F65_FROZEN_PROMPT_CHANGED',
      );
      const promptFiles = {
        selectionSystem: 'C.selection.system.txt',
        selectionUser: 'C.selection.user.json',
        outlineSystem: 'outline.system.txt',
        emptyOutlineUser: 'A.outline.user.txt',
      };
      for (const [key, file] of Object.entries(promptFiles))
        requireCondition(
          sha(fs.readFileSync(path.join(root, file))) ===
            manifest.prompts[key as keyof typeof promptFiles],
          'F65_PREPARED_PROMPT_FILE_CHANGED',
        );
      write(path.join(root, 'batch-live.attempt.json'), {
        startedAt: new Date().toISOString(),
        memoryDigest: common.memoryDigest,
      });
      write(path.join(root, 'memory-live-before.json'), beforeMemory);
      let batchFailed = false;
      const batchAbort = new AbortController();
      const batchTimer = setTimeout(() => batchAbort.abort(), 240000);
      try {
        for (const student of ['A', 'C'] as const) {
          requireCondition(
            digest(await memorySnapshot(memoryUrl)) === manifest.memoryDigest,
            'F65_MEMORY_CHANGED_BEFORE_CASE',
          );
          const dir = path.join(root, student);
          fs.mkdirSync(dir, { recursive: true });
          write(path.join(dir, 'attempt.json'), {
            student,
            startedAt: new Date().toISOString(),
            limits: manifest.observationBudget,
          });
          active = {
            student,
            dir,
            counts: { selection: 0, outline: 0 },
            blockedCalls: 0,
            replies: {},
            usage: [],
            forbiddenServices: [],
          };
          const current = active;
          let runId: string | undefined;
          let claim: Awaited<ReturnType<typeof claimNextGenerationRun>>;
          let released = false;
          let heartbeat: ReturnType<typeof setInterval> | undefined;
          let heartbeatPending = Promise.resolve();
          const caseAbort = new AbortController();
          const caseTimer = setTimeout(() => caseAbort.abort(), 180000);
          let failed = false;
          let failedCode: string | null = null;
          interception.begin = (kind, params, source, extra) => {
            const allowedSource =
              kind === 'selection' ? 'f65-learner-context' : 'scene-outlines-stream';
            const limit = kind === 'selection' && student === 'A' ? 0 : 1;
            if (source !== allowedSource || current.counts[kind] >= limit) {
              current.blockedCalls++;
              throw new Error('F65_CALL_BUDGET_EXCEEDED');
            }
            requireCondition(
              typeof params.system === 'string' &&
                typeof params.prompt === 'string' &&
                !params.messages &&
                !params.tools,
              'F65_TEXT_ONLY_REQUEST_REQUIRED',
            );
            const actualModel = params.model as { modelId?: string; provider?: string };
            requireCondition(
              actualModel.modelId === safeModel.sdkModelId &&
                actualModel.provider === safeModel.sdkProvider,
              'F65_MODEL_SWITCH_REFUSED',
            );
            if (kind === 'selection') {
              requireCondition(
                params.maxOutputTokens === 2000 &&
                  params.maxRetries === 0 &&
                  (extra.retries as { retries?: number })?.retries === 0 &&
                  (extra.fallback as { enabled?: boolean })?.enabled === false,
                'F65_SELECTION_POLICY_CHANGED',
              );
              requireCondition(
                sha(params.system) === manifest.prompts.selectionSystem &&
                  sha(params.prompt) === manifest.prompts.selectionUser,
                'F65_SELECTION_PROMPT_CHANGED',
              );
            } else {
              requireCondition(
                sha(params.system) === manifest.prompts.outlineSystem &&
                  current.expectedOutline &&
                  params.system === current.expectedOutline.system &&
                  params.prompt === current.expectedOutline.user,
                'F65_OUTLINE_PROMPT_CHANGED',
              );
              if (student === 'A')
                requireCondition(
                  sha(params.prompt) === manifest.prompts.emptyOutlineUser,
                  'F65_A_OUTLINE_PROMPT_CHANGED',
                );
            }
            // fsync happens before the real SDK is invoked. A second attempt cannot reuse this file.
            write(path.join(dir, `${kind}.request.json`), {
              source,
              system: params.system,
              prompt: params.prompt,
              systemDigest: sha(params.system),
              promptDigest: sha(params.prompt),
              model: safeModel,
              originalMaxOutputTokens: params.maxOutputTokens ?? null,
              originalSdkMaxRetries: params.maxRetries ?? 2,
              effectiveMaxOutputTokens: kind === 'selection' ? 2000 : 4096,
              effectiveSdkMaxRetries: 0,
              fallback: false,
              thinking: extra.thinking ?? null,
            });
            current.counts[kind]++;
            return { kind };
          };
          interception.finish = (token, reply) => {
            const safe = { ...reply, ...(reply.usage ? { usage: numericUsage(reply.usage) } : {}) };
            current.replies[token.kind] = safe;
            write(path.join(dir, `${token.kind}.response.json`), safe);
          };
          interception.usage = (input) => {
            const record = input as {
              source?: string;
              providerId?: string;
              modelId?: string;
              modelString?: string;
              usage?: unknown;
            };
            requireCondition(
              ['f65-learner-context', 'scene-outlines-stream'].includes(record.source ?? ''),
              'F65_UNEXPECTED_USAGE_SOURCE',
            );
            current.usage.push({
              source: record.source,
              providerId: record.providerId,
              modelId: record.modelId,
              modelString: record.modelString,
              usage: numericUsage(record.usage),
            });
          };
          const blockedServices = new Set([
            'agentProfiles',
            'presetAgents',
            'sceneContent',
            'sceneActions',
            'narrationTarget',
            'narrateClip',
            'generateImage',
            'generateVideo',
            'analyzeMaterials',
          ]);
          const services = new Proxy(defaultRunStepServices, {
            get(target, key, receiver) {
              if (blockedServices.has(String(key)))
                return () => {
                  current.forbiddenServices.push(String(key));
                  throw new Error('F65_POST_OUTLINE_SERVICE_FORBIDDEN');
                };
              if (key === 'outline')
                return async (...args: Parameters<RunStepServices['outline']>) => {
                  const [ownerId, input, ctx] = args;
                  current.expectedOutline = buildOutlinePrompt(input.requirements, {
                    ...input,
                    imageGenerationEnabled: false,
                    videoGenerationEnabled: false,
                  });
                  write(path.join(dir, 'planner-input.json'), input);
                  return defaultRunStepServices.outline(ownerId, input, ctx);
                };
              return Reflect.get(target, key, receiver);
            },
          });
          try {
            const run = await createGenerationRun(owner, inputs[student], generationRunConfig());
            runId = run.id;
            write(path.join(dir, 'run-link.json'), { runId, student, createdAt: run.createdAt });
            requireCondition(await readGenerationRun(runId, owner), 'F65_CREATED_RUN_UNREADABLE');
            claim = await claimNextGenerationRun(`f65-outline-comparison-${student}`, {
              runId,
              leaseTtlMs: 60000,
              maxTakeovers: 0,
            });
            requireCondition(claim, 'F65_TARGET_RUN_NOT_CLAIMED');
            heartbeat = setInterval(() => {
              heartbeatPending = heartbeatPending.then(async () => {
                if (released) return;
                try {
                  if (!(await heartbeatGenerationRun(claim!.lease)) && !released) caseAbort.abort();
                } catch {
                  caseAbort.abort();
                }
              });
            }, 5000);
            const outcome = await executeGenerationRun(claim, {
              services,
              signal: AbortSignal.any([caseAbort.signal, batchAbort.signal]),
              onLeaseReleased: () => {
                released = true;
              },
            });
            requireCondition(outcome === 'waiting', 'F65_RUN_DID_NOT_WAIT');
            const stored = await readGenerationRun(runId, owner);
            requireCondition(
              stored?.state === 'awaiting_outline_confirmation' &&
                stored.stageId === null &&
                stored.agents === null,
              'F65_OUTLINE_ONLY_BOUNDARY_FAILED',
            );
            const steps = await readGenerationRunSteps(runId);
            requireCondition(
              [...steps.keys()].every((key) =>
                ['research', 'learner-context', 'learner-context:calling', 'outline'].includes(key),
              ),
              'F65_POST_OUTLINE_STEP_FOUND',
            );
            const frozen = stored.outline?.learnerContext;
            requireCondition(frozen && frozen.student === student, 'F65_FROZEN_CONTEXT_MISSING');
            if (student === 'A')
              requireCondition(
                frozen.status === 'empty' && frozen.selected.length === 0,
                'F65_A_CONTEXT_NOT_EMPTY',
              );
            requireCondition(
              current.counts.selection === (student === 'A' ? 0 : 1) &&
                current.counts.outline === 1 &&
                current.blockedCalls === 0 &&
                current.forbiddenServices.length === 0,
              'F65_CALL_LIMIT_ASSERTION_FAILED',
            );
            requireCondition(
              current.replies.outline?.finishReason === 'stop' &&
                current.replies.outline.streamError === false &&
                !current.replies.outline.errorCode,
              'F65_OUTLINE_NON_STOP_OR_STREAM_ERROR',
            );
            if (student === 'C')
              requireCondition(
                current.replies.selection?.finishReason === 'stop',
                'F65_SELECTION_NON_STOP',
              );
          } catch (error) {
            failed = true;
            failedCode = failureCode(error);
            batchFailed = true;
          } finally {
            clearTimeout(caseTimer);
            if (heartbeat) clearInterval(heartbeat);
            await heartbeatPending;
            if (claim! && !released)
              await releaseGenerationRunLease(claim!.lease).catch(() => undefined);
            // Usage is captured by source during these exact calls, never by an app-log time window.
            if (!failed) {
              try {
                await vi.waitFor(
                  () => {
                    requireCondition(
                      current.usage.length === current.counts.selection + current.counts.outline,
                      'F65_USAGE_CAPTURE_INCOMPLETE',
                    );
                  },
                  { timeout: 3000, interval: 20 },
                );
              } catch {
                failed = true;
                failedCode = 'F65_USAGE_CAPTURE_INCOMPLETE';
                batchFailed = true;
              }
            }
            if (runId) {
              const stored = await readGenerationRun(runId, owner);
              const steps = await readGenerationRunSteps(runId);
              const events = await readGenerationRunEvents(runId, 0, 5000);
              if (stored) {
                const snapshot = runSnapshot(stored);
                if (snapshot.error)
                  snapshot.error = { ...snapshot.error, message: 'F65_RUN_FAILURE_SEE_ERROR_CODE' };
                write(path.join(dir, 'run.json'), snapshot);
                write(
                  path.join(dir, 'frozen-context.json'),
                  snapshot.outline?.learnerContext ?? steps.get('learner-context') ?? null,
                );
                write(path.join(dir, 'outlines.json'), snapshot.outline?.outlines ?? null);
              }
              write(path.join(dir, 'steps.json'), Object.fromEntries(steps));
              write(
                path.join(dir, 'events.json'),
                events.map((event) =>
                  event.type === 'step_failed'
                    ? {
                        ...event,
                        data: { ...event.data, message: 'F65_STEP_FAILED_SEE_ERROR_CODE' },
                      }
                    : event,
                ),
              );
            }
            write(path.join(dir, 'safe-usage.json'), current.usage);
            write(path.join(dir, 'case-result.json'), {
              student,
              status: failed ? 'failed' : 'awaiting_outline_confirmation',
              errorCode: failedCode,
              counts: current.counts,
              blockedCalls: current.blockedCalls,
              forbiddenServices: current.forbiddenServices,
            });
            interception.begin = undefined;
            interception.finish = undefined;
            interception.usage = undefined;
          }
          if (failed) break;
        }
      } catch (error) {
        batchFailed = true;
        throw error;
      } finally {
        clearTimeout(batchTimer);
        const after = await memorySnapshot(memoryUrl);
        const unchanged = digest(after) === manifest.memoryDigest;
        write(path.join(root, 'memory-live-after.json'), after);
        write(path.join(root, 'live-summary.json'), {
          status: !batchFailed && unchanged ? 'outlines_ready_for_review' : 'failed_no_retry',
          memoryUnchanged: unchanged,
          beforeDigest: manifest.memoryDigest,
          afterDigest: digest(after),
          noConfirmation: true,
          noFullClass: true,
        });
        requireCondition(unchanged, 'F65_MEMORY_CHANGED_DURING_LIVE');
      }
      requireCondition(!batchFailed, 'F65_BATCH_FAILED_NO_RETRY');
    } catch (error) {
      // Fixed codes only: neither provider errors nor connection/owner objects leave this test.
      throw new Error(failureCode(error));
    } finally {
      interception.begin = undefined;
      interception.finish = undefined;
      interception.usage = undefined;
      await appPool?.end().catch(() => undefined);
      await persistence?.pool.end().catch(() => undefined);
      for (const spy of muted) spy.mockRestore();
    }
    expect(active?.forbiddenServices ?? []).toEqual([]);
  });
});
