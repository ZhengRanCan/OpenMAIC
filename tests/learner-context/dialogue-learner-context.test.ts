import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DSL_VERSION } from '@openmaic/dsl';
import type { ConnectableQueryable } from '@openmaic/storage/server/reference';
import { nodePostgresTransaction } from '@openmaic/storage/server/reference';
import { Pool } from 'pg';
import {
  digest,
  emptySnapshot,
  versionSource,
  type MemoryPiece,
} from '@/lib/learner-memory/contracts';
import { simulatedSeed } from '@/lib/learner-memory/simulated-seeds';
import { projectMemory } from '@/lib/learner-memory/read';
import { buildChildTurnPrompt, buildNativeChildTurnPrompt } from '@/lib/chat/pi/prompts';
import { resolveDialogueLearnerContext } from '@/lib/server/dialogue-learner-context';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { ensureMemorySchema } from '@/lib/persistence/learner-memory-schema';
import { ensureDialogueMemorySchema } from '@/lib/persistence/dialogue-memory-schema';
import { ensureGenerationRunSchema } from '@/lib/persistence/generation-runs';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { SimulatedMemoryEnvironment } from '@/lib/learner-memory/simulated-environment';
import { readSimulatedLearnerMemory } from '@/lib/server/simulated-learner-memory';
import {
  ensureLearningSceneBindings,
  retainLearningSceneBindings,
} from '@/lib/server/quiz-learning-loop/scene-bindings';

type Input = Parameters<typeof resolveDialogueLearnerContext>[0];
type Deps = Required<NonNullable<Parameters<typeof resolveDialogueLearnerContext>[1]>>;
const environment = '00000000-0000-4000-8000-000000000084';
const student = 'B';
const question = '这道题一定要用克吗？';
const problem = '质量 0.8 kg，体积 1000 cm³，请独立列式。';
const memoryText = '教师给出换算值后算对密度。';
const gap = '在新题中独立列式。';

function view() {
  const support = versionSource({
    id: 'private-evidence-ref',
    kind: 'confirmed_experience',
    text: memoryText,
    refs: ['private-message-id'],
    conditions: ['教师给出换算值', '只观察到一次', '{"refs":["private-source-ref"]}'],
    sourceNature: 'synthetic',
    occurredAt: null,
    provenance: { file: 'private.json', sha256: 'a'.repeat(64), pointer: '/1' },
  });
  const piece: MemoryPiece = {
    id: 'piece-density',
    text: 'PRIVATE SYNTHESIS',
    formation: 'confirmed_experience',
    supports: [support],
    conditions: ['PRIVATE SYNTHESIS CONDITION'],
    restrictions: [],
  };
  const snapshot = emptySnapshot();
  snapshot.pieces = [piece];
  snapshot.sections.learning_experiences = [piece.id];
  return {
    scope: { namespace: 'private-namespace', learnerKey: 'private-learner' },
    snapshot,
    usable: projectMemory(snapshot),
    sections: {
      background: [],
      goals: [],
      teaching_requirements: [],
      learning_experiences: [piece],
    },
    markdown: 'PRIVATE AUDIT',
    maintenancePending: false,
    coverage: [
      {
        source_id: support.id,
        version: support.version,
        current: true,
        valid: true,
        processed: true,
      },
    ],
  };
}

function fixture(mode: 'qa' | 'discussion' = 'qa') {
  const data = view();
  const deps = {
    resolveScope: vi.fn<Deps['resolveScope']>().mockResolvedValue({
      runId: 'run-1',
      student,
      title: '密度练习',
      actions: [{ type: 'discussion', topic: problem, prompt: '请先等学生独立作答。' }],
    }),
    readMemory: vi.fn<Deps['readMemory']>().mockResolvedValue(data),
    authorizeMemory: vi.fn<Deps['authorizeMemory']>(
      async (_owner, _student, _environment, sources) => new Set(sources.map(digest)),
    ),
    readMastery: vi.fn<Deps['readMastery']>().mockResolvedValue([
      {
        target: { id: 'private-target', revision: 1, statement: '独立计算密度并提交过程。' },
        summary: '上次只观察到受助计算。',
        unverified: [gap],
      },
    ]),
    select: vi.fn<Deps['select']>().mockResolvedValue('{"selected":["M1","T1"]}'),
  };
  const body: Input['body'] = {
    messages:
      mode === 'qa'
        ? [
            {
              id: 'question',
              role: 'user',
              parts: [{ type: 'text', text: question }],
            },
          ]
        : [],
    config: {
      agentIds: ['default-1'],
      sessionType: mode,
      ...(mode === 'discussion'
        ? { discussionTopic: problem, discussionPrompt: 'CLIENT INJECTION' }
        : {}),
    },
    storeState: {
      stage: { id: 'stage-owned', name: 'CLIENT STAGE' } as Input['body']['storeState']['stage'],
      scenes: [],
      currentSceneId: 'scene-owned',
      mode: 'autonomous',
      whiteboardOpen: false,
    },
  };
  const input: Input = {
    owner: 'owner-authoritative',
    body,
    model: { serverManaged: true } as Input['model'],
    signal: new AbortController().signal,
  };
  return { input, deps, data };
}

describe('F84 optional dialogue learner context', () => {
  beforeEach(() => {
    vi.stubEnv('OPENMAIC_DIALOGUE_LEARNER_CONTEXT', 'true');
    vi.stubEnv(
      'OPENMAIC_SIMULATED_LEARNING_LOOP',
      JSON.stringify({
        sourceNature: 'synthetic',
        conditions: ['synthetic'],
        memoryEnvironmentId: environment,
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it.each(['qa', 'discussion'] as const)(
    'selects one bounded %s context and preserves conditions',
    async (mode) => {
      const { input, deps } = fixture(mode);
      const result = await resolveDialogueLearnerContext(input, deps);
      expect(result.status).toBe('ready');
      expect(deps.resolveScope).toHaveBeenNthCalledWith(
        1,
        'owner-authoritative',
        'stage-owned',
        'scene-owned',
      );
      expect(deps.select).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps current question, trusted context and formal profile reads separate', async () => {
    const { input, deps } = fixture();
    const result = await resolveDialogueLearnerContext(input, deps);
    expect(result.text).toContain(memoryText);
    expect(result.text).toContain(gap);
    expect(result.text).toContain('只观察到一次');
    expect(result.text).toContain('教师给出换算值');
    expect(result.text).not.toMatch(/private-|PRIVATE AUDIT|PRIVATE SYNTHESIS/);
    expect(deps.resolveScope).toHaveBeenCalledTimes(2);
    expect(deps.readMemory).toHaveBeenCalledWith(student, environment);
    expect(deps.readMastery).toHaveBeenCalledWith('owner-authoritative', student);
    const call = deps.select.mock.calls[0]![0];
    expect(call.prompt.user).toContain(question);
    expect(call.prompt.user).not.toMatch(/private-|CLIENT STAGE/);
    expect(deps.select).toHaveBeenCalledTimes(1);
    for (const prompt of [buildChildTurnPrompt, buildNativeChildTurnPrompt]) {
      expect(prompt('Explain this.', 'teacher', { learner: result.text })).toContain(gap);
      expect(prompt('Explain this.', 'assistant', { learner: result.text })).toContain(
        'actual current work take priority',
      );
      expect(prompt('Discuss this.', 'student', { learner: result.text })).not.toContain(
        memoryText,
      );
    }
  });

  it('keeps the exact bundled profile used by the live comparison', async () => {
    const {
      input,
      deps: { resolveScope, readMemory, readMastery, select },
      data,
    } = fixture();
    const { snapshot, sources } = simulatedSeed(student);
    const piece = snapshot.pieces.find(({ id }) => id === 'm-density')!;
    expect(piece).toBeDefined();
    const { version: originalVersion, ...rawSource } = piece.supports[0]!;
    const forged = versionSource({
      ...rawSource,
      text: 'FORGED SEED',
    });
    expect(forged.version).not.toBe(originalVersion);
    const proxy = versionSource({
      ...rawSource,
      id: 'proxy-source',
      sourceNature: 'proxy',
      text: 'PROXY HISTORY',
    });
    const pieces = [
      piece,
      { ...piece, id: 'fake', text: forged.text, supports: [forged] },
      { ...piece, id: 'proxy', text: proxy.text, supports: [proxy] },
    ];
    readMemory.mockResolvedValue({
      ...data,
      snapshot,
      sections: { ...data.sections, learning_experiences: pieces },
      coverage: [
        ...sources.filter(({ id }) => id !== forged.id),
        forged,
        ...piece.supports,
        proxy,
      ].map((source) => ({
        source_id: source.id,
        version: source.version,
        current: true,
        valid: true,
        processed: true,
      })),
    });
    const result = await resolveDialogueLearnerContext(input, {
      resolveScope,
      readMemory,
      readMastery,
      select,
    });
    const [selected] = JSON.parse(result.text!);
    expect(selected).toEqual({
      kind: 'memory',
      data: {
        text: '密度题已给公式和换算提示时，54÷20算出2.7g/cm³正确，但直接写成2.7kg/m³，未按1000倍关系换算为2700kg/m³。',
        conditions: [
          '人工组合的模拟学生数据，不代表真实学习者或真实连续学习史；各身份独立使用素材。',
          '题目已提供密度公式和单位换算关系提示。',
        ],
      },
    });
    expect(select.mock.calls[0]![0].prompt.user).not.toMatch(/FORGED SEED|PROXY HISTORY/);
  });

  it('can select Mastery when Memory ownership is unavailable', async () => {
    const { input, deps } = fixture();
    deps.authorizeMemory.mockRejectedValue(new Error('unavailable'));
    deps.select.mockResolvedValue('{"selected":["T1"]}');
    const result = await resolveDialogueLearnerContext(input, deps);
    expect(result.status).toBe('ready');
    expect(result.text).toContain(gap);
    expect(deps.select.mock.calls[0]![0].prompt.user).not.toContain(memoryText);
  });

  it('uses the saved Discussion invitation and ignores a forged prompt', async () => {
    const { input, deps } = fixture('discussion');
    expect((await resolveDialogueLearnerContext(input, deps)).status).toBe('ready');
    expect(deps.select.mock.calls[0]![0].prompt.user).toContain(problem);
    expect(deps.select.mock.calls[0]![0].prompt.user).not.toContain('CLIENT INJECTION');
    input.body.config.discussionTopic = 'unknown discussion';
    deps.select.mockClear();
    expect((await resolveDialogueLearnerContext(input, deps)).status).toBe('empty');
    expect(deps.select).not.toHaveBeenCalled();
  });

  it('skips other owners, disabled features and unmanaged models before reading profiles', async () => {
    const { input, deps } = fixture();
    input.model.serverManaged = false;
    expect((await resolveDialogueLearnerContext(input, deps)).status).toBe('disabled');
    expect(deps.resolveScope).not.toHaveBeenCalled();
    input.model.serverManaged = true;
    deps.resolveScope.mockResolvedValue(null);
    expect((await resolveDialogueLearnerContext(input, deps)).status).toBe('empty');
    expect(deps.readMemory).not.toHaveBeenCalled();
    expect(deps.readMastery).not.toHaveBeenCalled();
  });

  it('never attaches revoked, changed, or unsolicited candidates', async () => {
    const { input, deps, data } = fixture();
    deps.readMemory.mockResolvedValueOnce(data).mockResolvedValue({
      ...data,
      coverage: data.coverage.map((item) => ({ ...item, valid: false })),
    });
    const result = await resolveDialogueLearnerContext(input, deps);
    expect(result.text).not.toContain(memoryText);
    expect(result.text).toContain(gap);
    deps.select.mockResolvedValue('{"selected":["M9"]}');
    expect((await resolveDialogueLearnerContext(input, deps)).text).toBeUndefined();
    deps.select.mockResolvedValue('{"selected":[]}');
    expect((await resolveDialogueLearnerContext(input, deps)).status).toBe('empty');
  });

  it('returns after the deadline and skips selection if slow storage later resolves', async () => {
    vi.useFakeTimers();
    const { input, deps, data } = fixture();
    deps.readMemory.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(data), 5000)),
    );
    const original = AbortSignal.timeout;
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    try {
      const response = resolveDialogueLearnerContext(input, deps);
      await vi.advanceTimersByTimeAsync(4000);
      expect(await response).toEqual({ status: 'unavailable' });
      await vi.advanceTimersByTimeAsync(1000);
      expect(deps.select).not.toHaveBeenCalled();
    } finally {
      timeout.mockRestore();
      expect(AbortSignal.timeout).toBe(original);
    }
  });

  it.skipIf(!process.env.F84_DATABASE_URL)(
    'requires persisted owner and Scene proof in isolated PostgreSQL',
    async () => {
      const raw = process.env.F84_DATABASE_URL!;
      const url = new URL(raw);
      expect([url.hostname, url.port, url.pathname]).toEqual([
        '127.0.0.1',
        '55484',
        '/f84_contract',
      ]);
      vi.stubEnv('DATABASE_URL', raw);
      const app = await getServerPersistenceProvider(raw);
      try {
        await ensureGenerationRunSchema(app.pool);
        await ensureLearningSceneBindings(app.pool);
        await ensureDialogueMemorySchema(app.pool);
        const {
          input,
          deps: { readMemory, authorizeMemory, readMastery, select },
        } = fixture('discussion');
        const stageId = 'f84-stage-' + randomUUID();
        const sceneId = 'f84-scene-' + randomUUID();
        const runId = 'f84-run-' + randomUUID();
        const stage = { id: stageId, name: 'F84 密度练习', createdAt: 1, updatedAt: 2 };
        const doc = await getOwnerScopedDocumentStore(input.owner);
        await doc.createDocument({
          dslVersion: DSL_VERSION,
          stage,
          scenes: [
            {
              id: sceneId,
              stageId,
              order: 1,
              title: '正式练习',
              type: 'slide',
              content: {
                type: 'slide',
                canvas: {
                  id: 'f84-slide',
                  viewportSize: 1000,
                  viewportRatio: 0.5625,
                  theme: {
                    backgroundColor: '#fff',
                    themeColors: ['#000'],
                    fontColor: '#000',
                    fontName: 'Inter',
                  },
                  elements: [],
                },
              },
              actions: [
                {
                  id: 'discussion',
                  type: 'discussion',
                  topic: problem,
                  prompt: '先等学生独立提交。',
                },
              ],
            },
          ],
        });
        input.body.storeState.stage = stage;
        input.body.storeState.currentSceneId = sceneId;
        const overrides = { readMemory, authorizeMemory, readMastery, select };
        expect((await resolveDialogueLearnerContext(input, overrides)).status).toBe('empty');
        await app.pool.query(
          "INSERT INTO generation_runs(id,owner_id,stage_id,input,state) VALUES($1,$2,$3,$4::jsonb,'completed')",
          [runId, input.owner, stageId, JSON.stringify({ simulatedLearner: 'B' })],
        );
        expect((await resolveDialogueLearnerContext(input, overrides)).status).toBe('empty');
        expect(select).not.toHaveBeenCalled();
        await app.pool.query(
          'INSERT INTO generation_run_steps(run_id,step_id,output) VALUES($1,$2,$3::jsonb)',
          [runId, 'scene:0:narration', JSON.stringify({ scene: { id: sceneId, stageId } })],
        );
        expect(
          (await resolveDialogueLearnerContext({ ...input, owner: 'foreign' }, overrides)).status,
        ).toBe('empty');
        expect(select).not.toHaveBeenCalled();
        expect((await resolveDialogueLearnerContext(input, overrides)).status).toBe('ready');
        expect(select.mock.calls[0]![0].prompt.user).toContain('先等学生独立提交');
        const shared = view();
        const base = shared.sections.learning_experiences[0]!;
        const { version: baseVersion, ...raw } = base.supports[0]!;
        const ownRaw = {
          ...raw,
          id: randomUUID(),
          kind: 'dialogue_evidence',
        };
        const own = versionSource(ownRaw);
        expect(own.version).not.toBe(baseVersion);
        const foreign = versionSource({ ...ownRaw, id: randomUUID(), text: 'FOREIGN OWNER' });
        const wrongEnvironment = versionSource({
          ...ownRaw,
          id: randomUUID(),
          text: 'WRONG ENVIRONMENT',
        });
        const proxy = versionSource({
          ...ownRaw,
          id: randomUUID(),
          text: 'PROXY OWNER',
          sourceNature: 'proxy',
        });
        const changed = versionSource({ ...ownRaw, text: 'CHANGED SOURCE' });
        for (const [source, owner, scope] of [
          [own, input.owner, environment],
          [foreign, 'foreign', environment],
          [wrongEnvironment, input.owner, randomUUID()],
          [proxy, input.owner, environment],
        ] as const) {
          await app.pool.query(
            'INSERT INTO dialogue_memory_sources(id,owner_id,stage_id,environment_id,student,data) VALUES($1,$2,$3,$4,$5,$6)',
            [source.id, owner, stageId, scope, student, { source }],
          );
        }
        const pieces = [
          { ...base, supports: [own] },
          { ...base, id: 'mixed', supports: [own, foreign] },
          { ...base, id: 'foreign', supports: [foreign] },
          { ...base, id: 'wrong-environment', supports: [wrongEnvironment] },
          { ...base, id: 'proxy', supports: [proxy] },
          { ...base, id: 'changed', supports: [changed] },
        ];
        shared.sections.learning_experiences = pieces;
        shared.coverage = [own, foreign, wrongEnvironment, proxy, changed].map((source) => ({
          source_id: source.id,
          version: source.version,
          current: true,
          valid: true,
          processed: true,
        }));
        readMemory.mockResolvedValue(shared);
        const isolated = await resolveDialogueLearnerContext(input, {
          readMemory,
          readMastery,
          select,
        });
        expect(isolated.status).toBe('ready');
        expect(isolated.text).toContain(memoryText);
        const selectInput = select.mock.lastCall![0].prompt.user;
        expect(
          JSON.parse(selectInput).candidates.filter(
            ({ kind }: { kind: string }) => kind === 'memory',
          ),
        ).toHaveLength(1);
        expect(selectInput).not.toMatch(
          /FOREIGN OWNER|WRONG ENVIRONMENT|PROXY OWNER|CHANGED SOURCE|PRIVATE SYNTHESIS/,
        );
        await retainLearningSceneBindings(app.pool, [runId]);
        await app.pool.query('DELETE FROM generation_run_steps WHERE run_id=$1', [runId]);
        expect((await resolveDialogueLearnerContext(input, overrides)).status).toBe('ready');
        await app.pool.query('UPDATE stage_meta SET deleted_at=now() WHERE stage_id=$1', [stageId]);
        expect((await resolveDialogueLearnerContext(input, overrides)).status).toBe('empty');
        expect(select).toHaveBeenCalledTimes(3);
      } finally {
        await app.pool.end();
      }
    },
    20_000,
  );

  it.skipIf(!process.env.F84_DATABASE_URL)(
    'checks the physical Memory environment before reading a simulated learner',
    async () => {
      const raw = new URL(process.env.F84_DATABASE_URL!);
      expect([raw.hostname, raw.port, raw.pathname]).toEqual([
        '127.0.0.1',
        '55484',
        '/f84_contract',
      ]);
      raw.pathname = '/f84_memory';
      vi.stubEnv('MEMORY_DATABASE_URL', raw.href);
      const db = new Pool({
        connectionString: raw.href,
        options: '-c search_path=f67_simulated_memory',
      });
      try {
        await db.query('CREATE SCHEMA IF NOT EXISTS f67_simulated_memory');
        await ensureMemorySchema(db);
        await db.query(
          'CREATE TABLE IF NOT EXISTS f68_memory_environment(singleton boolean PRIMARY KEY, id text NOT NULL)',
        );
        await db.query(
          'INSERT INTO f68_memory_environment VALUES(true,$1) ON CONFLICT(singleton) DO UPDATE SET id=excluded.id',
          [environment],
        );
        await new SimulatedMemoryEnvironment({
          withTransaction: nodePostgresTransaction(db as unknown as ConnectableQueryable),
        }).initialize(student);
        expect(
          (await readSimulatedLearnerMemory(student, environment)).usable.pieces.length,
        ).toBeGreaterThan(0);
        await expect(readSimulatedLearnerMemory(student, 'other-environment')).rejects.toThrow(
          'LEARNER_MEMORY_UNAVAILABLE',
        );
      } finally {
        await db.end();
      }
    },
  );
});
