import type { Queryable, WithTransaction } from '@openmaic/storage/document/pg';
import { readPreparedIn } from '@/lib/persistence/quiz-trace';
import { evidenceDigest } from '@/lib/evidence/context';
import { projectShortFactsContext } from '@/lib/evidence/short-facts-context';
import { SHORT_FACTS_SYSTEM } from '@/lib/evidence/short-facts-system';
import {
  SHORT_FACTS_PROTOCOL,
  shortFactSources,
  validateShortFacts,
} from '@/lib/evidence/short-facts';
import type { MemoryInvoker } from '@/lib/server/learner-memory';
import { simulatedScope } from '@/lib/learner-memory/simulated-seeds';
import { SimulatedMemoryEnvironment } from '@/lib/learner-memory/simulated-environment';
import { updateMemory } from '@/lib/server/learner-memory';
import { sourceKey } from '@/lib/learner-memory/contracts';
import { randomUUID } from 'node:crypto';

type Student = 'A' | 'B' | 'C';
type Request = {
  owner: string;
  generationRunId: string;
  attemptId: string;
  submissionId: string;
  student: Student;
  conditions: string[];
  sourceNature: 'proxy' | 'synthetic';
  retryOf?: string;
  sceneBinding?: 'operator-confirmed';
  memoryEnvironmentId: string;
};
type Reply = { text: string; finishReason: string; model: string; usage: unknown };
type Stored = {
  id: string;
  request: Request;
  context: ReturnType<typeof projectShortFactsContext> & {
    binding: 'checkpoint' | 'operator-confirmed';
  };
  system: string;
  protocol: typeof SHORT_FACTS_PROTOCOL;
  budgets: { maxOutputTokens: 16000; timeoutMs: 180000; retries: 0 };
  state: 'prepared' | 'calling' | 'completed' | 'failed' | 'interrupted';
  reply?: Reply;
  validation?: ReturnType<typeof validateShortFacts>;
  snapshot?: string;
};
type Row = { data: Stored } & Record<string, unknown>;
export type FactsInvoker = (system: string, user: string) => Promise<Reply>;

/** Separate table preserves legacy evidence.v1. Called explicitly by the controlled entrypoint. */
export async function ensureShortFactsSchema(db: Queryable) {
  await db.query(`CREATE TABLE IF NOT EXISTS f68_short_facts_runs (
    id text PRIMARY KEY, owner_id text NOT NULL, submission_id text NOT NULL, parent_id text,
    data jsonb NOT NULL, UNIQUE(owner_id, parent_id)
  )`);
}
/** Explicit setup for an isolated Memory database, never called by a read or handoff. */
export async function initializeMemoryEnvironment(db: Queryable) {
  await db.query(
    'CREATE TABLE IF NOT EXISTS f68_memory_environment (singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), id text NOT NULL)',
  );
  await db.query(
    'INSERT INTO f68_memory_environment(singleton,id) VALUES(true,$1) ON CONFLICT(singleton) DO NOTHING',
    [randomUUID()],
  );
  return readMemoryEnvironment(db);
}
async function readMemoryEnvironment(db: Queryable) {
  const row = await db.query<{ id: string } & Record<string, unknown>>(
    'SELECT id FROM f68_memory_environment WHERE singleton=true',
  );
  if (row.rows.length !== 1) throw new Error('MEMORY_ENVIRONMENT_NOT_INITIALIZED');
  return row.rows[0].id;
}

export class QuizShortFactsService {
  constructor(readonly withTransaction: WithTransaction) {}

  private async previewIn(tx: Queryable, request: Request) {
    if (
      !['A', 'B', 'C'].includes(request.student) ||
      !['proxy', 'synthetic'].includes(request.sourceNature) ||
      (request.sceneBinding !== undefined && request.sceneBinding !== 'operator-confirmed') ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        request.memoryEnvironmentId ?? '',
      ) ||
      !request.conditions.length
    )
      throw new Error('INVALID_SOURCE_ATTRIBUTION');
    const quiz = await readPreparedIn(tx, request.owner, request.attemptId);
    if (quiz.submission?.id !== request.submissionId) throw new Error('SUBMISSION_MISMATCH');
    const run = await tx.query<
      { input: { simulatedLearner?: string }; stage_id: string | null } & Record<string, unknown>
    >('SELECT input,stage_id FROM generation_runs WHERE id=$1 AND owner_id=$2', [
      request.generationRunId,
      request.owner,
    ]);
    if (
      run.rows.length !== 1 ||
      run.rows[0].stage_id !== quiz.stageId ||
      run.rows[0].input.simulatedLearner !== request.student
    )
      throw new Error('SIMULATED_IDENTITY_MISMATCH');
    const scene = await tx.query(
      "SELECT 1 FROM generation_run_steps WHERE run_id=$1 AND step_id LIKE 'scene:%:narration' AND output->'scene'->>'id'=$2",
      [request.generationRunId, quiz.sceneId],
    );
    let binding: 'checkpoint' | 'operator-confirmed' = 'checkpoint';
    if (scene.rows.length !== 1) {
      if (scene.rows.length > 1) throw new Error('RUN_SCENE_MISMATCH');
      const table = await tx.query<{ name: string | null } & Record<string, unknown>>(
        "SELECT to_regclass('f68_short_facts_runs')::text AS name",
      );
      let priorBinding: 'checkpoint' | 'operator-confirmed' | undefined;
      if (table.rows[0]?.name) {
        const candidates = await tx.query<Row>(
          'SELECT data FROM f68_short_facts_runs WHERE owner_id=$1 AND submission_id=$2',
          [request.owner, request.submissionId],
        );
        const { retryOf: _parent, ...currentRequest } = request;
        const previous = candidates.rows
          .map((row) => row.data)
          .find((item) => {
            const { retryOf: _oldParent, ...oldRequest } = item.request;
            return (
              evidenceDigest(oldRequest) === evidenceDigest(currentRequest) &&
              item.context.source.stageId === quiz.stageId &&
              item.context.source.sceneId === quiz.sceneId &&
              ['checkpoint', 'operator-confirmed'].includes(item.context.binding)
            );
          });
        priorBinding = previous?.context.binding;
      }
      if (!priorBinding && request.sceneBinding !== 'operator-confirmed')
        throw new Error('RUN_SCENE_PROOF_UNAVAILABLE');
      binding = priorBinding ?? 'operator-confirmed';
    }
    const context = projectShortFactsContext(
      quiz,
      binding === 'operator-confirmed'
        ? [...request.conditions, '模拟课堂与学生的归属由操作人员显式确认']
        : request.conditions,
    );
    return { ...context, binding };
  }

  async preview(request: Request) {
    return this.withTransaction(async (tx) => {
      await tx.query('SET TRANSACTION READ ONLY');
      return this.previewIn(tx, request);
    });
  }

  async prepare(request: Request) {
    return this.withTransaction(async (tx) => {
      const context = await this.previewIn(tx, request);
      if (request.retryOf) {
        const previous = await this.readIn(tx, request.owner, request.retryOf, true);
        const { retryOf: _previousParent, ...previousRequest } = previous.request;
        const { retryOf: _currentParent, ...currentRequest } = request;
        if (
          !['failed', 'interrupted'].includes(previous.state) ||
          evidenceDigest(previousRequest) !== evidenceDigest(currentRequest) ||
          previous.context.digest !== context.digest
        )
          throw new Error('REANALYSIS_NOT_ALLOWED');
      }
      const id = evidenceDigest({
        owner: request.owner,
        submission: request.submissionId,
        retryOf: request.retryOf ?? null,
      }).slice(0, 40);
      const value: Stored = {
        id,
        request,
        context,
        system: SHORT_FACTS_SYSTEM,
        protocol: SHORT_FACTS_PROTOCOL,
        budgets: { maxOutputTokens: 16000, timeoutMs: 180000, retries: 0 },
        state: 'prepared',
      };
      await tx.query(
        'INSERT INTO f68_short_facts_runs(id,owner_id,submission_id,parent_id,data) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING',
        [id, request.owner, request.submissionId, request.retryOf ?? null, JSON.stringify(value)],
      );
      const stored = await this.readIn(tx, request.owner, id);
      if (
        evidenceDigest(stored.request) !== evidenceDigest(request) ||
        stored.context.digest !== context.digest ||
        stored.system !== SHORT_FACTS_SYSTEM ||
        stored.protocol !== SHORT_FACTS_PROTOCOL ||
        evidenceDigest(stored.budgets) !== evidenceDigest(value.budgets)
      )
        throw new Error('SOURCE_OR_REQUEST_CHANGED');
      return stored;
    });
  }

  private async readIn(tx: Queryable, owner: string, id: string, lock = false) {
    const found = await tx.query<Row>(
      `SELECT data FROM f68_short_facts_runs WHERE id=$1 AND owner_id=$2${lock ? ' FOR UPDATE' : ''}`,
      [id, owner],
    );
    if (!found.rows.length) throw new Error('SHORT_FACTS_NOT_FOUND');
    return found.rows[0].data;
  }
  async read(owner: string, id: string) {
    return this.withTransaction(async (tx) => {
      const run = await this.readIn(tx, owner, id);
      const current = await this.previewIn(tx, run.request);
      if (current.digest !== run.context.digest) throw new Error('SOURCE_OR_REQUEST_CHANGED');
      return run;
    });
  }
  private async save(tx: Queryable, run: Stored) {
    await tx.query('UPDATE f68_short_facts_runs SET data=$3::jsonb WHERE owner_id=$1 AND id=$2', [
      run.request.owner,
      run.id,
      JSON.stringify(run),
    ]);
  }
  /** Explicit operator action: stop automatic continuation of an unknown call. */
  async interrupt(owner: string, id: string) {
    return this.withTransaction(async (tx) => {
      const run = await this.readIn(tx, owner, id, true);
      if (run.state !== 'calling') throw new Error('INTERRUPT_NOT_ALLOWED');
      run.state = 'interrupted';
      await this.save(tx, run);
      return run;
    });
  }

  /** Explicitly abandon an unknown F67 call before choosing a new operation ID. */
  async interruptMemory(
    owner: string,
    id: string,
    memory: SimulatedMemoryEnvironment,
    recoveryId?: string,
  ) {
    const run = await this.read(owner, id);
    if (recoveryId && !/^[\w-]{1,32}$/.test(recoveryId)) throw new Error('INVALID_RECOVERY_ID');
    const operationId = `f68:${run.id}${recoveryId ? `:${recoveryId}` : ''}`;
    const scope = simulatedScope(run.request.student);
    return memory.provider.withTransaction(async (tx) => {
      if ((await readMemoryEnvironment(tx)) !== run.request.memoryEnvironmentId)
        throw new Error('MEMORY_ENVIRONMENT_MISMATCH');
      const sameTransaction = new SimulatedMemoryEnvironment({
        withTransaction: (body) => body(tx),
      });
      const existing = await sameTransaction.store.getRun(scope, operationId);
      if (existing.state !== 'calling') throw new Error('INTERRUPT_NOT_ALLOWED');
      return sameTransaction.store.abandon(scope, operationId);
    });
  }

  async extract(owner: string, id: string, invoke: FactsInvoker) {
    const initial = await this.read(owner, id);
    await this.prepare(initial.request);
    const claim = await this.withTransaction(async (tx) => {
      const run = await this.readIn(tx, owner, id, true);
      if (run.state !== 'prepared') return null;
      run.state = 'calling';
      await this.save(tx, run);
      return run;
    });
    if (!claim) return this.read(owner, id);
    let reply: Reply;
    try {
      reply = await invoke(claim.system, claim.context.user);
    } catch {
      return this.read(owner, id);
    } // Calling remains unknown: never retry automatically.
    return this.withTransaction(async (tx) => {
      const run = await this.readIn(tx, owner, id, true);
      if (run.state !== 'calling') throw new Error('INVOCATION_STATE_CHANGED');
      run.reply = reply;
      run.validation = validateShortFacts(reply.text, run.context.refs);
      if (reply.finishReason !== 'stop' || run.validation.status === 'invalid')
        run.state = 'failed';
      else {
        const parsed = JSON.parse(reply.text) as { facts: unknown[] };
        run.snapshot = JSON.stringify({
          facts: parsed.facts,
          refs: run.context.refs,
          student: run.request.student,
          runId: run.id,
          sourceNature: run.request.sourceNature,
          occurredAt: run.context.source.savedAt,
        });
        run.state = 'completed';
      }
      await this.save(tx, run);
      return run;
    });
  }

  async handoff(
    owner: string,
    id: string,
    memory: SimulatedMemoryEnvironment,
    invoke: MemoryInvoker,
    recoveryId?: string,
  ) {
    const run = await this.read(owner, id);
    if (run.state !== 'completed' || !run.snapshot || !run.reply)
      throw new Error('SHORT_FACTS_NOT_COMPLETED');
    await this.prepare(run.request);
    const { sources } = shortFactSources({
      student: run.request.student,
      runId: run.id,
      snapshotFile: `postgres:f68_short_facts_runs/${run.id}/snapshot`,
      snapshotBytes: Buffer.from(run.snapshot),
      reply: run.reply.text,
      refs: run.context.refs,
      sourceNature: run.request.sourceNature,
      occurredAt: run.context.source.savedAt,
    });
    const scope = simulatedScope(run.request.student);
    await memory.provider.withTransaction(async (tx) => {
      if ((await readMemoryEnvironment(tx)) !== run.request.memoryEnvironmentId)
        throw new Error('MEMORY_ENVIRONMENT_MISMATCH');
    });
    if (!sources.length) return { sources, update: null };
    if (sources.length > 16) throw new Error('MEMORY_BATCH_LIMIT');
    const initialOperationId = `f68:${run.id}`;
    let batchSources = sources;
    let deferredRecovery = false;
    if (recoveryId) {
      deferredRecovery = true;
      if (!/^[\w-]{1,32}$/.test(recoveryId)) throw new Error('INVALID_RECOVERY_ID');
      const initial = await memory.store.getRun(scope, initialOperationId);
      if (initial.state === 'completed') {
        const deferred = (initial.decisions ?? [])
          .filter((decision) => decision.action === 'defer')
          .map((decision) => initial.aliases[decision.source])
          .filter(Boolean)
          .map(sourceKey);
        batchSources = sources.filter((source) => deferred.includes(sourceKey(source)));
        if (!batchSources.length) throw new Error('RECOVERY_NOT_ALLOWED');
      } else if (!['failed', 'conflict'].includes(initial.state))
        throw new Error('RECOVERY_NOT_ALLOWED');
    }
    const operationId = recoveryId ? `${initialOperationId}:${recoveryId}` : initialOperationId;
    const prepared = await memory.provider.withTransaction(async (tx) => {
      if ((await readMemoryEnvironment(tx)) !== run.request.memoryEnvironmentId)
        throw new Error('MEMORY_ENVIRONMENT_MISMATCH');
      await tx.query(
        'SELECT learner_key FROM learner_memory_states WHERE namespace=$1 AND learner_key=$2 FOR UPDATE',
        [scope.namespace, scope.learnerKey],
      );
      const prior = await tx.query<
        { data: import('@/lib/learner-memory/contracts').PreparedMemoryRun } & Record<
          string,
          unknown
        >
      >('SELECT data FROM learner_memory_runs WHERE namespace=$1 AND learner_key=$2 AND id=$3', [
        scope.namespace,
        scope.learnerKey,
        operationId,
      ]);
      if (deferredRecovery || prior.rows.length) {
        const rows = await tx.query<
          { source_id: string; version: string; valid: boolean; current: boolean } & Record<
            string,
            unknown
          >
        >(
          'SELECT source_id,version,valid,current FROM learner_memory_sources WHERE namespace=$1 AND learner_key=$2 AND source_id=ANY($3::text[])',
          [scope.namespace, scope.learnerKey, batchSources.map((source) => source.id)],
        );
        if (
          batchSources.some(
            (source) =>
              !rows.rows.some(
                (row) =>
                  row.source_id === source.id &&
                  row.version === source.version &&
                  row.valid &&
                  row.current,
              ),
          )
        )
          throw new Error('MEMORY_SOURCE_UNAVAILABLE');
      }
      if (prior.rows.length) {
        const previous = prior.rows[0].data;
        if (
          previous.batch.some(
            (source) => !batchSources.some((expected) => sourceKey(expected) === sourceKey(source)),
          )
        )
          throw new Error('MEMORY_BATCH_MISMATCH');
        return previous;
      }
      const pending = await tx.query<
        { source_id: string; version: string } & Record<string, unknown>
      >(
        'SELECT source_id,version FROM learner_memory_sources WHERE namespace=$1 AND learner_key=$2 AND processed=false AND current=true AND valid=true',
        [scope.namespace, scope.learnerKey],
      );
      if (deferredRecovery) {
        batchSources = batchSources.filter((source) =>
          pending.rows.some((row) => row.source_id === source.id && row.version === source.version),
        );
        if (!batchSources.length) throw new Error('DEFER_ALREADY_PROCESSED');
      }
      if (pending.rows.some((row) => !batchSources.some((source) => source.id === row.source_id)))
        throw new Error('MEMORY_PENDING_SOURCES');
      const sameTransaction = new SimulatedMemoryEnvironment({
        withTransaction: (body) => body(tx),
      });
      await sameTransaction.ingest(run.request.student, batchSources);
      const prepared = await sameTransaction.store.prepare(scope, operationId);
      if (
        prepared.state !== 'noop' &&
        (prepared.batch.length !== batchSources.length ||
          prepared.batch.some(
            (source) => !batchSources.some((expected) => sourceKey(expected) === sourceKey(source)),
          ))
      )
        throw new Error('MEMORY_BATCH_MISMATCH');
      return prepared;
    });
    const memoryRun =
      prepared.state === 'noop'
        ? prepared
        : await updateMemory(memory.store, scope, operationId, invoke);
    const update = { run: memoryRun, memory: await memory.read(run.request.student) };
    return { sources, update };
  }
}
