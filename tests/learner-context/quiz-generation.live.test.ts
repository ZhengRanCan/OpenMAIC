/**
 * Explicit F66 fixed-Quiz observation, never an unattended model test.
 * TEST_LOAD_LOCAL_ENV=1 and F66_QUIZ_GENERATION_MODE=prepare|live are required.
 * F66_QUIZ_GENERATION_DIR must equal the fixed batch root below. Prepare is
 * read-only for Memory; app persistence may bootstrap its metadata. Live spends
 * at most A content + B selection + B content, once.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { describe, it, vi } from 'vitest';
import { generateSceneContent as generatePackagedContent } from '@openmaic/generation';
import type { QuizGenerationContext } from '@openmaic/generation';
import { canonicalJson } from '@/lib/learner-memory/contracts';
import { simulatedScope } from '@/lib/learner-memory/simulated-seeds';
import type { MemorySelectionPrompt } from '@/lib/learner-context/selection-contracts';
import type { QuizMemoryTask } from '@/lib/learner-context/quiz-contracts';
import { renderQuizLearnerContext } from '@/lib/learner-context/quiz-render';
import { buildQuizLearnerContext } from '@/lib/server/quiz-learner-context';
import { defaultRunStepServices } from '@/lib/server/generation/run/services';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { resolveModel } from '@/lib/server/resolve-model';
import type { ModelRequest, ResolvedModel } from '@/lib/server/resolve-model';
import type { ThinkingConfig } from '@/lib/types/provider';
import { backgroundWorkspaceId } from '@/lib/server/model-config/runtime';

type CallKind = 'selection' | 'content';
interface CapturedReply {
  text?: string;
  finishReason?: string;
  usage?: unknown;
  errorCode?: string;
}
const interception = vi.hoisted(() => ({
  resolve: undefined as undefined | ((request: ModelRequest, model: ResolvedModel) => void),
  begin: undefined as
    | undefined
    | ((
        params: Record<string, unknown>,
        source: string,
        thinking: ThinkingConfig | undefined,
      ) => CallKind),
  finish: undefined as undefined | ((kind: CallKind, reply: CapturedReply) => void),
}));

vi.mock('@/lib/server/resolve-model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/resolve-model')>();
  return {
    ...actual,
    resolveModel: async (request: ModelRequest) => {
      const model = await actual.resolveModel(request);
      interception.resolve?.(request, model);
      return model;
    },
  };
});

vi.mock('@/lib/ai/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/llm')>();
  return {
    ...actual,
    callLLM: async (...args: Parameters<typeof actual.callLLM>) => {
      const [params, source, , thinking, fallback] = args;
      if (!interception.begin || !interception.finish) throw new Error('F66_MODEL_CALL_NOT_ARMED');
      const kind = interception.begin(params, source, thinking);
      let result: Awaited<ReturnType<typeof actual.callLLM>>;
      try {
        result = await actual.callLLM(
          { ...params, maxRetries: 0, maxOutputTokens: kind === 'selection' ? 2000 : 8192 },
          source,
          { retries: 0 },
          thinking,
          { ...fallback, enabled: false },
        );
      } catch {
        interception.finish(kind, { errorCode: 'F66_MODEL_CALL_FAILED' });
        throw new Error('F66_MODEL_CALL_FAILED');
      }
      // Export failures propagate and prevent a success summary or another call.
      interception.finish(kind, {
        text: result.text,
        finishReason: result.finishReason,
        usage: result.totalUsage ?? result.usage,
      });
      if (result.finishReason !== 'stop') throw new Error('F66_MODEL_NON_STOP');
      return result;
    },
    streamLLM: () => {
      throw new Error('F66_STREAM_CALL_FORBIDDEN');
    },
  };
});
// Direct SDK-result usage is captured above; do not write app usage rows.
vi.mock('@/lib/server/usage-storage', () => ({
  recordUsage: async () => undefined,
  recordGenerationUsage: async () => {
    throw new Error('F66_NON_LLM_USAGE_FORBIDDEN');
  },
}));

const BASELINE_RUN = 'run-VJ9hDi6uen8-maAA';
const FIXED_ROOT = path.resolve(
  '../docs/log/artifacts/F66/quiz-generation-mvp-2026-10-27/batch-002',
);
const mode = process.env.F66_QUIZ_GENERATION_MODE;
const LANGUAGE_DIRECTIVE = '使用简体中文。';
const task: QuizMemoryTask = {
  requirement:
    '为初二学生生成密度与单位换算的2道练习题，允许单选题和简答题，难度中等。题目应给出必要数据；简答题可要求说明理由或计算步骤。保留答案或参考要点、解析及简答评分要求。',
  courseTitle: '密度与单位换算',
  outline: {
    id: 'f66-density-units-quiz',
    type: 'quiz',
    order: 1,
    title: '密度与单位换算练习',
    description: '考查密度、质量和体积的关系，以及计算时单位的一致性。',
    keyPoints: ['密度、质量与体积的关系', '质量和体积单位换算', '用单位核对计算结果'],
    teachingObjective: '在给定情境中正确使用密度关系并说明单位换算依据。',
    quizConfig: { questionCount: 2, difficulty: 'medium', questionTypes: ['single', 'text'] },
  },
};
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const digest = (value: unknown) => sha(canonicalJson(value));
function requireCondition(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
/** These are the effective global flags read by llm.ts / the provider transport. */
function effectiveLlmFlags() {
  return {
    llmThinkingDisabled: process.env.LLM_THINKING_DISABLED === 'true',
    openaiCompatStreamingChat: process.env.OPENAI_COMPAT_USE_STREAMING_CHAT === 'true',
  };
}
function effectiveThinkingDigest(thinking: ThinkingConfig | undefined) {
  // Match callLLM: an explicit per-call setting overrides the global flag.
  return digest(
    thinking ??
      (effectiveLlmFlags().llmThinkingDisabled ? { mode: 'disabled', enabled: false } : null),
  );
}
function safeModelSummary(resolved: ResolvedModel) {
  requireCondition(
    resolved.serverManaged && typeof resolved.model === 'object',
    'F66_SERVER_MODEL_REQUIRED',
  );
  return {
    providerId: resolved.providerId,
    modelId: resolved.modelId,
    modelString: resolved.modelString,
    sdkProvider: resolved.model.provider,
    sdkModelId: resolved.model.modelId,
    serverManaged: resolved.serverManaged,
    contextWindow: resolved.modelInfo?.contextWindow ?? null,
    outputWindow: resolved.modelInfo?.outputWindow ?? null,
    modelCapabilitiesDigest: digest(resolved.modelInfo?.capabilities ?? null),
    thinkingDigest: digest(resolved.thinkingConfig ?? null),
    effectiveThinkingDigest: effectiveThinkingDigest(resolved.thinkingConfig),
    llmFlags: effectiveLlmFlags(),
    routingDigest: digest({ provider: resolved.providerId, baseUrl: resolved.baseUrl ?? null }),
  };
}
function failureCode(error: unknown) {
  return error instanceof Error && /^F66_[A-Z_]+$/.test(error.message)
    ? error.message
    : 'F66_UNEXPECTED_FAILURE';
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

function productionFingerprints() {
  const files: Record<string, string> = {};
  function collect(absolute: string, label: string) {
    if (fs.statSync(absolute).isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) {
        if (name !== 'node_modules' && name !== '.git')
          collect(path.join(absolute, name), `${label}/${name}`);
      }
    } else files[label] = sha(fs.readFileSync(absolute));
  }
  for (const target of [
    'lib/learner-context',
    'lib/learner-memory',
    'lib/server/simulated-learner-memory.ts',
    'lib/server/learner-memory.ts',
    'lib/server/learner-memory-selection.ts',
    'lib/server/learner-memory-selection-model.ts',
    'lib/server/quiz-learner-context.ts',
    'lib/persistence/learner-memory-store.ts',
    'lib/server/generation/run',
    'lib/server/generation/steps/scene-content.ts',
    'lib/server/generation/steps/context.ts',
    'lib/server/resolve-model.ts',
    'lib/server/model-config',
    'lib/server/model-routes.ts',
    'lib/server/provider-config.ts',
    'lib/config/feature-flags.ts',
    'lib/types/generation.ts',
    'lib/ai',
    'lib/prompts',
    'tests/setup-env.ts',
    'tests/learner-context/quiz-generation.live.test.ts',
  ])
    collect(path.resolve(target), target);
  for (const packageName of ['generation', 'dsl']) {
    const packageRoot = fs.realpathSync(path.resolve(`node_modules/@openmaic/${packageName}`));
    for (const target of packageName === 'generation'
      ? ['package.json', 'dist', 'src', 'templates', 'snippets', 'prompts-pbl']
      : ['package.json', 'dist', 'src'])
      collect(path.join(packageRoot, target), `@openmaic/${packageName}/${target}`);
  }
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
    const result: Record<string, unknown> = {};
    for (const student of ['A', 'B', 'C'] as const) {
      const scope = simulatedScope(student),
        keys = [scope.namespace, scope.learnerKey];
      const state = await client.query(
        'SELECT * FROM learner_memory_states WHERE namespace=$1 AND learner_key=$2',
        keys,
      );
      requireCondition(state.rows.length === 1, 'F66_MEMORY_NOT_INITIALIZED');
      requireCondition(!state.rows[0].maintenance, 'F66_MEMORY_MAINTENANCE_PENDING');
      const sources = await client.query(
        'SELECT * FROM learner_memory_sources WHERE namespace=$1 AND learner_key=$2 ORDER BY source_id,version',
        keys,
      );
      const runs = await client.query(
        'SELECT * FROM learner_memory_runs WHERE namespace=$1 AND learner_key=$2 ORDER BY id',
        keys,
      );
      requireCondition(
        !runs.rows.some((row) => ['prepared', 'calling', 'captured'].includes(row.state)),
        'F66_MEMORY_UPDATE_ACTIVE',
      );
      result[student] = { state: state.rows[0], sources: sources.rows, runs: runs.rows };
    }
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

/** Capture the actual packaged prompt without transport or a fabricated teaching result. */
async function nativePrompt(context?: QuizGenerationContext) {
  let captured: { system: string; user: string } | undefined;
  await generatePackagedContent(
    structuredClone(task.outline),
    async (system, user) => {
      requireCondition(!captured, 'F66_NATIVE_PROMPT_CALLED_TWICE');
      captured = { system, user };
      return '[]';
    },
    { languageDirective: LANGUAGE_DIRECTIVE, ...(context ? { quizLearnerContext: context } : {}) },
  );
  requireCondition(captured, 'F66_NATIVE_PROMPT_MISSING');
  return captured;
}

describe.skipIf(!mode)('F66 explicit fixed-Quiz A/B generation', () => {
  it('prepares or executes the three-call one-attempt batch', { timeout: 300_000 }, async () => {
    const muted = ['log', 'info', 'warn', 'error', 'debug'].map((key) =>
      vi.spyOn(console, key as 'log').mockImplementation(() => undefined),
    );
    const secrets = new Set<string>();
    let appPool: Pool | undefined;
    let persistence: Awaited<ReturnType<typeof getServerPersistenceProvider>> | undefined;
    let memoryUrl: string | undefined;
    let root: string | undefined;
    let acquired = false;
    let beforeMemory: Record<string, unknown> | undefined;
    let failed: string | null = null;
    let complete = false;
    let exportFailed = false;
    let memoryUnchanged = false;
    let totalCalls = 0;
    const caseSummaries: unknown[] = [];
    function write(file: string, value: unknown, plain = false) {
      let body = plain
        ? String(value)
        : JSON.stringify(
            value,
            (key, item) =>
              /^(ownerId|owner_id|apiKey|authorization|connectionString|baseUrl|endpoint)$/i.test(
                key,
              )
                ? '[REDACTED]'
                : item,
            2,
          ) + '\n';
      for (const secret of secrets) if (secret) body = body.split(secret).join('[REDACTED]');
      try {
        const handle = fs.openSync(file, 'wx');
        try {
          fs.writeFileSync(handle, body);
          fs.fsyncSync(handle);
        } finally {
          fs.closeSync(handle);
        }
      } catch (error) {
        exportFailed = true;
        throw error;
      }
    }
    const log = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    };
    try {
      requireCondition(mode === 'prepare' || mode === 'live', 'F66_MODE_INVALID');
      requireCondition(process.env.TEST_LOAD_LOCAL_ENV === '1', 'F66_LOCAL_ENV_OPT_IN_REQUIRED');
      root = path.resolve(process.env.F66_QUIZ_GENERATION_DIR ?? '');
      requireCondition(root === FIXED_ROOT, 'F66_ARTIFACT_ROOT_MISMATCH');
      if (mode === 'prepare')
        requireCondition(
          !fs.existsSync(root) || fs.readdirSync(root).length === 0,
          'F66_PREPARE_DIRECTORY_NOT_EMPTY',
        );
      else
        requireCondition(
          !fs.existsSync(path.join(root, 'batch-live.attempt.json')),
          'F66_BATCH_ALREADY_ATTEMPTED',
        );
      const appUrl = process.env.DATABASE_URL?.trim();
      memoryUrl = process.env.MEMORY_DATABASE_URL?.trim();
      requireCondition(appUrl && memoryUrl, 'F66_DATABASE_CONFIGURATION_REQUIRED');
      for (const [name, value] of Object.entries(process.env))
        if (value && /KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL/.test(name)) secrets.add(value);
      appPool = new Pool({
        connectionString: appUrl,
        max: 1,
        connectionTimeoutMillis: 5000,
        query_timeout: 10000,
      });
      appPool.on('error', () => undefined);
      const original = await appPool.query<{ owner_id: string }>(
        'SELECT owner_id FROM generation_runs WHERE id=$1',
        [BASELINE_RUN],
      );
      requireCondition(
        original.rows.length === 1 && original.rows[0].owner_id,
        'F66_BASELINE_OWNER_MISSING',
      );
      const owner = original.rows[0].owner_id;
      secrets.add(owner);
      persistence = await getServerPersistenceProvider(appUrl);
      const workspace = await backgroundWorkspaceId(owner);
      secrets.add(workspace);
      const resolved = await resolveModel({ stage: 'scene-content:quiz', workspaceId: workspace });
      secrets.add(resolved.apiKey);
      if (resolved.baseUrl) secrets.add(resolved.baseUrl);
      requireCondition(
        resolved.serverManaged && typeof resolved.model === 'object',
        'F66_SERVER_MODEL_REQUIRED',
      );
      requireCondition(
        resolved.modelInfo?.outputWindow === undefined || resolved.modelInfo.outputWindow >= 8192,
        'F66_MODEL_OUTPUT_CAPACITY_INSUFFICIENT',
      );
      const safeModel = safeModelSummary(resolved);
      beforeMemory = await memorySnapshot(memoryUrl);
      let selectionPrompt: MemorySelectionPrompt | undefined;
      const emptyContext = await buildQuizLearnerContext(
        { student: 'A', sceneIndex: 0, task },
        {
          select: async () => {
            throw new Error('F66_A_MUST_SKIP_SELECTION');
          },
        },
      );
      requireCondition(emptyContext.status === 'empty', 'F66_A_MEMORY_NOT_EMPTY');
      await buildQuizLearnerContext(
        { student: 'B', sceneIndex: 0, task },
        {
          select: async (prompt) => {
            requireCondition(!selectionPrompt, 'F66_SELECTION_PROMPT_CAPTURE_REPEATED');
            selectionPrompt = prompt;
            return '{"selected":[]}';
          },
        },
      );
      requireCondition(selectionPrompt, 'F66_B_CANDIDATES_REQUIRED');
      const emptyPrompt = await nativePrompt();
      const codeFiles = productionFingerprints();
      const common = {
        version: 'f66-quiz-generation.v2',
        referenceRunId: BASELINE_RUN,
        ownerDigest: sha(owner),
        workspaceDigest: sha(workspace),
        task,
        taskDigest: digest(task),
        memoryDigest: digest(beforeMemory),
        memoryIdentityDigests: Object.fromEntries(
          Object.entries(beforeMemory).map(([student, state]) => [student, digest(state)]),
        ),
        codeFiles,
        codeDigest: digest(codeFiles),
        model: safeModel,
        prompts: {
          selectionSystem: sha(selectionPrompt.system),
          selectionUser: sha(selectionPrompt.user),
          emptySystem: sha(emptyPrompt.system),
          emptyUser: sha(emptyPrompt.user),
        },
        budget: {
          A: { selection: 0, content: 1 },
          B: { selection: 1, content: 1 },
          maxModelCalls: 3,
          selectionOutputTokens: 2000,
          contentOutputTokens: 8192,
          retries: 0,
          fallback: false,
          timeoutMs: 240000,
          allowedOutputTypes: ['single', 'short_answer'],
          nativeOutlineTypes: ['single', 'text'],
          languageDirective: LANGUAGE_DIRECTIVE,
          memoryReadOnly: true,
          appMetadataBootstrapPossible: true,
        },
      };
      requireCondition(
        digest(await memorySnapshot(memoryUrl)) === common.memoryDigest,
        'F66_MEMORY_CHANGED_DURING_PREFLIGHT',
      );
      if (mode === 'prepare') {
        fs.mkdirSync(root, { recursive: true });
        write(path.join(root, 'prepare.attempt.json'), { startedAt: new Date().toISOString() });
        acquired = true;
        write(path.join(root, 'memory-prepared.json'), beforeMemory);
        write(path.join(root, 'A.empty-context.json'), emptyContext);
        write(path.join(root, 'B.selection.system.txt'), selectionPrompt.system, true);
        write(path.join(root, 'B.selection.user.json'), selectionPrompt.user, true);
        write(path.join(root, 'A.content.system.txt'), emptyPrompt.system, true);
        write(path.join(root, 'A.content.user.txt'), emptyPrompt.user, true);
        write(path.join(root, 'prepared-manifest.json'), common);
        complete = true;
      } else {
        const manifest = JSON.parse(
          fs.readFileSync(path.join(root, 'prepared-manifest.json'), 'utf8'),
        );
        const preparedSummary = JSON.parse(
          fs.readFileSync(path.join(root, 'prepare-summary.json'), 'utf8'),
        );
        requireCondition(
          preparedSummary.status === 'success' &&
            preparedSummary.totalModelCalls === 0 &&
            preparedSummary.memoryUnchanged === true,
          'F66_PREPARE_NOT_SUCCESSFUL',
        );
        requireCondition(digest(manifest) === digest(common), 'F66_FROZEN_PREFLIGHT_CHANGED');
        requireCondition(
          digest(JSON.parse(fs.readFileSync(path.join(root, 'memory-prepared.json'), 'utf8'))) ===
            common.memoryDigest,
          'F66_PREPARED_MEMORY_CHANGED',
        );
        for (const [key, file] of Object.entries({
          selectionSystem: 'B.selection.system.txt',
          selectionUser: 'B.selection.user.json',
          emptySystem: 'A.content.system.txt',
          emptyUser: 'A.content.user.txt',
        }))
          requireCondition(
            sha(fs.readFileSync(path.join(root, file))) ===
              common.prompts[key as keyof typeof common.prompts],
            'F66_PREPARED_PROMPT_CHANGED',
          );
        write(path.join(root, 'batch-live.attempt.json'), {
          startedAt: new Date().toISOString(),
          manifestDigest: digest(manifest),
        });
        acquired = true;
        write(path.join(root, 'memory-live-before.json'), beforeMemory);
        const signal = AbortSignal.timeout(240000);
        for (const student of ['A', 'B'] as const) {
          signal.throwIfAborted();
          requireCondition(
            digest(await memorySnapshot(memoryUrl)) === common.memoryDigest,
            'F66_MEMORY_CHANGED_BEFORE_CASE',
          );
          const dir = path.join(root, student);
          fs.mkdirSync(dir);
          write(path.join(dir, 'attempt.json'), { student, startedAt: new Date().toISOString() });
          const counts = { selection: 0, content: 0 };
          const caseSummary: Record<string, unknown> = { student, counts, status: 'incomplete' };
          caseSummaries.push(caseSummary);
          const replies: Partial<Record<CallKind, CapturedReply>> = {};
          const contentExpectation: { prompt?: { system: string; user: string } } = {};
          const validatedModels = new WeakMap<object, ReturnType<typeof safeModelSummary>>();
          let marker = false;
          interception.resolve = (request, model) => {
            signal.throwIfAborted();
            requireCondition(request.stage === 'scene-content:quiz', 'F66_MODEL_STAGE_CHANGED');
            requireCondition(
              request.workspaceId === workspace &&
                sha(request.workspaceId) === common.workspaceDigest,
              'F66_MODEL_WORKSPACE_CHANGED',
            );
            const actualSummary = safeModelSummary(model);
            requireCondition(
              digest(actualSummary) === digest(safeModel),
              'F66_RESOLVED_MODEL_CONFIGURATION_CHANGED',
            );
            requireCondition(typeof model.model === 'object', 'F66_RESOLVED_MODEL_OBJECT_REQUIRED');
            validatedModels.set(model.model, actualSummary);
          };
          interception.begin = (params, source, thinking) => {
            signal.throwIfAborted();
            const kind: CallKind = source === 'f66-quiz-learner-context' ? 'selection' : 'content';
            requireCondition(
              source === 'f66-quiz-learner-context' || source === 'scene-content',
              'F66_MODEL_LABEL_FORBIDDEN',
            );
            requireCondition(
              totalCalls < 3 &&
                counts[kind] === 0 &&
                (kind !== 'selection' || (student === 'B' && marker)),
              'F66_CALL_BUDGET_EXCEEDED',
            );
            requireCondition(
              typeof params.system === 'string' &&
                typeof params.prompt === 'string' &&
                !params.messages &&
                !params.tools &&
                !params.providerOptions,
              'F66_TEXT_ONLY_REQUEST_REQUIRED',
            );
            requireCondition(
              typeof params.model === 'object' && params.model !== null,
              'F66_RESOLVED_MODEL_OBJECT_REQUIRED',
            );
            const actualModel = validatedModels.get(params.model);
            requireCondition(
              actualModel && digest(actualModel) === digest(safeModel),
              'F66_MODEL_SWITCH_REFUSED',
            );
            requireCondition(
              digest(effectiveLlmFlags()) === digest(safeModel.llmFlags),
              'F66_LLM_FLAGS_CHANGED',
            );
            requireCondition(
              digest(thinking ?? null) === actualModel.thinkingDigest &&
                effectiveThinkingDigest(thinking) === actualModel.effectiveThinkingDigest,
              'F66_CALL_THINKING_CHANGED',
            );
            requireCondition(params.abortSignal === signal, 'F66_MODEL_SIGNAL_CHANGED');
            const effectiveMaxOutputTokens = kind === 'selection' ? 2000 : 8192;
            const inputBytes = Buffer.byteLength(params.system + params.prompt, 'utf8');
            requireCondition(
              safeModel.contextWindow === null ||
                inputBytes + effectiveMaxOutputTokens + 1024 <= safeModel.contextWindow,
              'F66_MODEL_INPUT_CAPACITY_EXCEEDED',
            );
            if (kind === 'selection')
              requireCondition(
                sha(params.system) === common.prompts.selectionSystem &&
                  sha(params.prompt) === common.prompts.selectionUser,
                'F66_SELECTION_PROMPT_CHANGED',
              );
            else
              requireCondition(
                contentExpectation.prompt &&
                  params.system === contentExpectation.prompt.system &&
                  params.prompt === contentExpectation.prompt.user,
                'F66_CONTENT_PROMPT_CHANGED',
              );
            write(path.join(dir, `${kind}.request.json`), {
              source,
              system: params.system,
              prompt: params.prompt,
              systemDigest: sha(params.system),
              promptDigest: sha(params.prompt),
              model: actualModel,
              workspaceDigest: common.workspaceDigest,
              modelStage: 'scene-content:quiz',
              actualThinkingDigest: digest(thinking ?? null),
              actualEffectiveThinkingDigest: effectiveThinkingDigest(thinking),
              originalMaxOutputTokens: params.maxOutputTokens ?? null,
              effectiveMaxOutputTokens,
              maxRetries: 0,
              fallback: false,
            });
            counts[kind]++;
            totalCalls++;
            return kind;
          };
          interception.finish = (kind, reply) => {
            const captured = {
              ...reply,
              ...(reply.usage ? { usage: numericUsage(reply.usage) } : {}),
            };
            replies[kind] = captured;
            write(path.join(dir, `${kind}.response.json`), captured);
          };
          const context = await defaultRunStepServices.quizLearnerContext!(
            owner,
            { student, sceneIndex: 0, task },
            {
              log,
              signal,
              beforeSelect: async () => {
                signal.throwIfAborted();
                write(path.join(dir, 'selection.calling.json'), {
                  startedAt: new Date().toISOString(),
                });
                marker = true;
              },
            },
          );
          requireCondition(
            student === 'A' ? context.status === 'empty' : context.status === 'ready',
            'F66_CONTEXT_STATE_UNEXPECTED',
          );
          write(path.join(dir, 'frozen-context.json'), context);
          await defaultRunStepServices.validateQuizLearnerContext!(owner, context, { log, signal });
          const projected = renderQuizLearnerContext(task, context);
          write(path.join(dir, 'generation-input.json'), {
            task,
            context: projected ?? null,
            languageDirective: LANGUAGE_DIRECTIVE,
          });
          contentExpectation.prompt = await nativePrompt(projected);
          const generated = await defaultRunStepServices.sceneContent(
            owner,
            {
              outline: structuredClone(task.outline),
              languageDirective: LANGUAGE_DIRECTIVE,
              targetLanguage: 'zh-CN',
              requirements: { requirement: task.requirement },
              ...(projected ? { quizLearnerContext: projected } : {}),
            },
            { log, signal },
          );
          // Preserve the parser's actual result before applying observation assertions.
          write(path.join(dir, 'parsedQuiz.json'), generated);
          await defaultRunStepServices.validateQuizLearnerContext!(owner, context, { log, signal });
          requireCondition(
            'questions' in generated.content && generated.content.questions.length === 2,
            'F66_QUESTION_COUNT_MISMATCH',
          );
          for (const question of generated.content.questions) {
            requireCondition(
              ['single', 'short_answer'].includes(question.type),
              'F66_QUESTION_TYPE_MISMATCH',
            );
            requireCondition(
              typeof question.analysis === 'string' && question.analysis.trim(),
              'F66_ANALYSIS_MISSING',
            );
            requireCondition(
              question.type !== 'short_answer' ||
                (typeof question.commentPrompt === 'string' && question.commentPrompt.trim()),
              'F66_SHORT_ANSWER_RUBRIC_MISSING',
            );
          }
          requireCondition(
            counts.content === 1 &&
              counts.selection === (student === 'A' ? 0 : 1) &&
              replies.content?.finishReason === 'stop',
            'F66_CASE_CALLS_INCOMPLETE',
          );
          Object.assign(caseSummary, {
            student,
            counts,
            status: context.status,
            selectedPieceIds: context.selected.map((piece) => piece.pieceId),
            replies: Object.fromEntries(
              Object.entries(replies).map(([kind, reply]) => [
                kind,
                { finishReason: reply.finishReason, usage: reply.usage },
              ]),
            ),
          });
          interception.begin = undefined;
          interception.finish = undefined;
          interception.resolve = undefined;
        }
        requireCondition(totalCalls === 3, 'F66_BATCH_CALLS_INCOMPLETE');
        complete = true;
      }
    } catch (error) {
      failed = failureCode(error);
    } finally {
      interception.begin = undefined;
      interception.finish = undefined;
      interception.resolve = undefined;
      if (acquired && root && memoryUrl && beforeMemory) {
        try {
          const after = await memorySnapshot(memoryUrl);
          write(
            path.join(
              root,
              mode === 'prepare' ? 'memory-prepare-after.json' : 'memory-live-after.json',
            ),
            after,
          );
          requireCondition(digest(after) === digest(beforeMemory), 'F66_MEMORY_CHANGED');
          memoryUnchanged = true;
        } catch (error) {
          failed = failureCode(error);
        }
        try {
          write(
            path.join(root, mode === 'prepare' ? 'prepare-summary.json' : 'live-summary.json'),
            {
              status: complete && !failed ? 'success' : 'failed',
              failureCode: failed,
              artifactExportFailed: exportFailed,
              mode,
              totalModelCalls: totalCalls,
              cases: caseSummaries,
              memoryUnchanged,
              completedAt: new Date().toISOString(),
              limitation:
                'Memory reads are read-only; app persistence may bootstrap metadata. Inputs and generated questions only; no classroom, learner answers, scoring or learning-effect claim.',
            },
          );
        } catch {
          failed = 'F66_SUMMARY_EXPORT_FAILED';
        }
      }
      await appPool?.end().catch(() => undefined);
      await persistence?.pool.end().catch(() => undefined);
      for (const spy of muted) spy.mockRestore();
    }
    if (failed || !complete) throw new Error(failed ?? 'F66_INCOMPLETE');
  });
});
