import { randomUUID } from 'node:crypto';
import type { Queryable, WithTransaction } from '@openmaic/storage/document/pg';
import {
  assertSource,
  capturedReplySchema,
  budgetsSchema,
  DEFAULT_BUDGETS,
  digest,
  emptySnapshot,
  invariant,
  MemoryError,
  scopeSchema,
  sourceKey,
  type CapturedMemoryReply,
  type MemoryBudgets,
  type MemoryScope,
  type MemorySnapshot,
  type MemorySource,
  type PreparedMemoryRun,
} from '@/lib/learner-memory/contracts';
import { buildMemoryPrompt } from '@/lib/learner-memory/prompt';
import { validateTransition } from '@/lib/learner-memory/transition';
import { projectMemory, renderMemory } from '@/lib/learner-memory/read';

type Row<T> = Record<string, unknown> & T;
interface State {
  snapshot: MemorySnapshot;
  maintenance: boolean;
}
interface SourceRow {
  data: MemorySource;
  valid: boolean;
  current: boolean;
  processed: boolean;
}
const key = (scope: MemoryScope) => [scope.namespace, scope.learnerKey];

/** Explicit experiment adapter. No public identity/production wiring is implied. */
export class LearnerMemoryStore {
  constructor(readonly provider: { withTransaction: WithTransaction }) {}
  private async locked<T>(
    scope: MemoryScope,
    body: (tx: Queryable, state: State) => Promise<T>,
  ): Promise<T> {
    scopeSchema.parse(scope);
    return this.provider.withTransaction(async (tx) => {
      await tx.query(
        'INSERT INTO learner_memory_states(namespace,learner_key,snapshot) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING',
        [...key(scope), JSON.stringify(emptySnapshot())],
      );
      const result = await tx.query<Row<State>>(
        'SELECT snapshot,maintenance FROM learner_memory_states WHERE namespace=$1 AND learner_key=$2 FOR UPDATE',
        key(scope),
      );
      return body(tx, result.rows[0]);
    });
  }
  private async runIn(tx: Queryable, scope: MemoryScope, id: string) {
    const result = await tx.query<Row<{ data: PreparedMemoryRun }>>(
      'SELECT data FROM learner_memory_runs WHERE namespace=$1 AND learner_key=$2 AND id=$3',
      [...key(scope), id],
    );
    invariant(result.rows[0], 'RUN_NOT_FOUND');
    return result.rows[0].data;
  }
  private async saveRun(tx: Queryable, run: PreparedMemoryRun) {
    await tx.query(
      'UPDATE learner_memory_runs SET state=$4,data=$5::jsonb WHERE namespace=$1 AND learner_key=$2 AND id=$3',
      [...key(run.scope), run.id, run.state, JSON.stringify(run)],
    );
  }
  async getRun(scope: MemoryScope, id: string): Promise<PreparedMemoryRun> {
    return this.locked(scope, (tx) => this.runIn(tx, scope, id));
  }
  async ingest(scope: MemoryScope, values: MemorySource[]) {
    invariant(values.length <= 64, 'INGEST_CAPACITY');
    const sources = values.map(assertSource);
    invariant(new Set(sources.map((s) => s.id)).size === sources.length, 'DUPLICATE_SOURCE_ID');
    await this.locked(scope, async (tx) => {
      for (const s of sources) {
        const prior = await tx.query<Row<SourceRow>>(
          'SELECT data,valid,current,processed FROM learner_memory_sources WHERE namespace=$1 AND learner_key=$2 AND source_id=$3 AND version=$4',
          [...key(scope), s.id, s.version],
        );
        invariant(!prior.rows[0] || prior.rows[0].valid, 'SOURCE_WITHDRAWN');
        await tx.query(
          'UPDATE learner_memory_sources SET current=false WHERE namespace=$1 AND learner_key=$2 AND source_id=$3',
          [...key(scope), s.id],
        );
        await tx.query(
          'INSERT INTO learner_memory_sources(namespace,learner_key,source_id,version,data) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(namespace,learner_key,source_id,version) DO UPDATE SET current=true',
          [...key(scope), s.id, s.version, JSON.stringify(s)],
        );
      }
    });
  }
  async prepare(
    scope: MemoryScope,
    operationId: string,
    budgets: MemoryBudgets = DEFAULT_BUDGETS,
  ): Promise<PreparedMemoryRun> {
    invariant(/^[\w:-]{1,120}$/.test(operationId), 'INVALID_OPERATION_ID');
    budgetsSchema.parse(budgets);
    return this.locked(scope, async (tx, state) => {
      const prior = await tx.query<Row<{ data: PreparedMemoryRun }>>(
        'SELECT data FROM learner_memory_runs WHERE namespace=$1 AND learner_key=$2 AND id=$3',
        [...key(scope), operationId],
      );
      if (prior.rows[0]) {
        invariant(digest(prior.rows[0].data.budgets) === digest(budgets), 'OPERATION_CONFLICT');
        return prior.rows[0].data;
      }
      const active = await tx.query(
        "SELECT id FROM learner_memory_runs WHERE namespace=$1 AND learner_key=$2 AND state IN ('prepared','calling','captured')",
        key(scope),
      );
      invariant(!active.rows.length, 'MEMORY_BUSY');
      const pending = await tx.query<Row<SourceRow>>(
        'SELECT data,valid,current,processed FROM learner_memory_sources WHERE namespace=$1 AND learner_key=$2 AND current AND valid AND NOT processed ORDER BY created_at,source_id LIMIT $3',
        [...key(scope), budgets.batchSize],
      );
      const old: MemorySource[] = [];
      for (const s of new Map(
        state.snapshot.pieces.flatMap((p) => p.supports).map((s) => [sourceKey(s), s]),
      ).values()) {
        const r = await tx.query(
          'SELECT source_id FROM learner_memory_sources WHERE namespace=$1 AND learner_key=$2 AND source_id=$3 AND version=$4 AND valid',
          [...key(scope), s.id, s.version],
        );
        if (r.rows.length) old.push(s);
      }
      const batch = pending.rows.map((r) => r.data);
      let built: ReturnType<typeof buildMemoryPrompt>;
      for (;;) {
        try {
          built = buildMemoryPrompt(state.snapshot, batch, budgets, old);
          break;
        } catch (e) {
          if (
            !(e instanceof MemoryError) ||
            e.code !== 'REQUEST_CAPACITY_EXCEEDED' ||
            batch.length < 2
          )
            throw e;
          batch.pop(); // Only the actual prefix is reserved; the rest stays pending.
        }
      }
      const run: PreparedMemoryRun = {
        id: operationId,
        scope,
        state: batch.length || state.maintenance ? 'prepared' : 'noop',
        baseRevision: state.snapshot.revision,
        snapshot: state.snapshot,
        batch,
        budgets,
        ...built,
        createdAt: new Date().toISOString(),
      };
      await tx.query(
        'INSERT INTO learner_memory_runs(namespace,learner_key,id,state,data) VALUES($1,$2,$3,$4,$5::jsonb)',
        [...key(scope), operationId, run.state, JSON.stringify(run)],
      );
      return run;
    });
  }
  async claim(scope: MemoryScope, id: string): Promise<PreparedMemoryRun | null> {
    return this.locked(scope, async (tx, state) => {
      const run = await this.runIn(tx, scope, id);
      if (run.state !== 'prepared') return null;
      let stale = state.snapshot.revision !== run.baseRevision;
      for (const source of run.batch) {
        const r = await tx.query(
          'SELECT source_id FROM learner_memory_sources WHERE namespace=$1 AND learner_key=$2 AND source_id=$3 AND version=$4 AND valid AND current',
          [...key(scope), source.id, source.version],
        );
        stale ||= !r.rows.length;
      }
      if (stale) {
        run.state = 'conflict';
        run.errorCode = 'MEMORY_VERSION_CONFLICT';
        await this.saveRun(tx, run);
        return null;
      }
      run.state = 'calling';
      run.claimToken = randomUUID();
      await this.saveRun(tx, run);
      return run;
    });
  }
  async capture(scope: MemoryScope, id: string, reply: CapturedMemoryReply, token?: string) {
    capturedReplySchema.parse(reply);
    invariant(
      reply.text.length <= 250000 &&
        typeof reply.finishReason === 'string' &&
        reply.model.length <= 200,
      'REPLY_CAPACITY',
    );
    return this.locked(scope, async (tx) => {
      const run = await this.runIn(tx, scope, id);
      if (run.reply) {
        invariant(digest(run.reply) === digest(reply), 'CAPTURE_CONFLICT');
        return run;
      }
      invariant(
        reply.origin === 'manual'
          ? run.state === 'prepared'
          : run.state === 'calling' && !!token && token === run.claimToken,
        'INVOCATION_CLAIM_REQUIRED',
      );
      run.reply = reply;
      run.state = 'captured';
      await this.saveRun(tx, run);
      return run;
    });
  }
  async commit(scope: MemoryScope, id: string): Promise<PreparedMemoryRun> {
    return this.locked(scope, async (tx, state) => {
      const run = await this.runIn(tx, scope, id);
      if (run.state === 'completed' || run.state === 'noop') return run;
      invariant(run.state === 'captured' && run.reply, 'CAPTURE_REQUIRED');
      let stale = run.baseRevision !== state.snapshot.revision;
      for (const s of run.batch) {
        const result = await tx.query(
          'SELECT source_id FROM learner_memory_sources WHERE namespace=$1 AND learner_key=$2 AND source_id=$3 AND version=$4 AND current AND valid',
          [...key(scope), s.id, s.version],
        );
        if (!result.rows.length) stale = true;
      }
      if (stale) {
        run.state = 'conflict';
        run.errorCode = 'MEMORY_VERSION_CONFLICT';
        await this.saveRun(tx, run);
        return run;
      }
      let transition: ReturnType<typeof validateTransition>;
      try {
        invariant(run.reply.finishReason !== 'error', 'INVOCATION_RESULT_UNKNOWN');
        invariant(run.reply.finishReason === 'stop', 'INCOMPLETE_MODEL_REPLY');
        transition = validateTransition(run, JSON.parse(run.reply.text));
      } catch (error) {
        run.state = 'failed';
        run.errorCode = error instanceof MemoryError ? error.code : 'INVALID_MODEL_REPLY';
        await this.saveRun(tx, run);
        return run;
      }
      await tx.query(
        'UPDATE learner_memory_states SET snapshot=$3::jsonb,maintenance=$4 WHERE namespace=$1 AND learner_key=$2',
        [
          ...key(scope),
          JSON.stringify(transition.snapshot),
          transition.snapshot.pieces.some((p) => p.restrictions.length > 0),
        ],
      );
      for (const d of transition.decisions)
        if (d.action !== 'defer') {
          const s = run.aliases[d.source];
          await tx.query(
            'UPDATE learner_memory_sources SET processed=true WHERE namespace=$1 AND learner_key=$2 AND source_id=$3 AND version=$4',
            [...key(scope), s.id, s.version],
          );
        }
      // Store the adopted meaning, retirements and source snapshots in the receipt too.
      run.state = 'completed';
      run.decisions = transition.decisions;
      const adoptedIds = new Set(
        transition.decisions.filter((d) => d.action === 'adopt').flatMap((d) => d.pieceIds),
      );
      run.adopted = transition.snapshot.pieces.filter((p) => adoptedIds.has(p.id));
      await this.saveRun(tx, run);
      return run;
    });
  }
  async restrictSource(scope: MemoryScope, sourceId: string, reason: string) {
    invariant(reason.trim().length > 0 && reason.length <= 500, 'RESTRICTION_REASON');
    await this.locked(scope, async (tx, state) => {
      const changed = await tx.query(
        'UPDATE learner_memory_sources SET valid=false WHERE namespace=$1 AND learner_key=$2 AND source_id=$3 AND valid RETURNING source_id',
        [...key(scope), sourceId],
      );
      if (!changed.rows.length) return;
      for (const p of state.snapshot.pieces)
        if (p.supports.some((s) => s.id === sourceId))
          p.restrictions = [...new Set([...p.restrictions, reason])];
      state.snapshot.revision++;
      await tx.query(
        'UPDATE learner_memory_states SET snapshot=$3::jsonb,maintenance=true WHERE namespace=$1 AND learner_key=$2',
        [...key(scope), JSON.stringify(state.snapshot)],
      );
    });
  }
  async abandon(scope: MemoryScope, id: string) {
    return this.locked(scope, async (tx) => {
      const run = await this.runIn(tx, scope, id);
      invariant(['prepared', 'calling', 'captured'].includes(run.state), 'RUN_NOT_ACTIVE');
      run.errorCode =
        run.state === 'calling' ? 'INVOCATION_RESULT_UNKNOWN' : 'EXPLICITLY_ABANDONED';
      run.state = 'failed';
      await this.saveRun(tx, run);
      return run;
    });
  }
  async read(scope: MemoryScope) {
    return this.locked(scope, async (tx, state) => {
      const inputs = await tx.query<
        Row<{
          source_id: string;
          version: string;
          valid: boolean;
          current: boolean;
          processed: boolean;
        }>
      >(
        'SELECT source_id,version,valid,current,processed FROM learner_memory_sources WHERE namespace=$1 AND learner_key=$2 ORDER BY source_id,version',
        key(scope),
      );
      return {
        scope,
        snapshot: state.snapshot,
        usable: projectMemory(state.snapshot),
        markdown: renderMemory(state.snapshot),
        coverage: inputs.rows,
        maintenancePending: state.maintenance,
      };
    });
  }
  async deleteExperiment(scope: MemoryScope) {
    await this.locked(scope, async (tx) => {
      await tx.query(
        'DELETE FROM learner_memory_states WHERE namespace=$1 AND learner_key=$2',
        key(scope),
      );
    });
  }
}
