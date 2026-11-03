import type { ServerPersistenceProvider } from '@/lib/persistence/server-provider';
import type { Queryable } from '@openmaic/storage/document/pg';
import { DialogueMemoryStore } from '@/lib/persistence/dialogue-memory-store';
import { verifiedDialogueEvidenceIn } from './dialogue-memory-authority';
import { updateMemory, readMemory, type MemoryInvoker } from './learner-memory';
import { LearnerMemoryStore } from '@/lib/persistence/learner-memory-store';
import type { SimulatedMemoryEnvironment } from '@/lib/learner-memory/simulated-environment';
import { simulatedScope } from '@/lib/learner-memory/simulated-seeds';
import {
  digest,
  sourceKey,
  invariant,
  type PreparedMemoryRun,
  type CapturedMemoryReply,
} from '@/lib/learner-memory/contracts';
import {
  DialogueMemoryError,
  type DialogueMemoryDelivery,
  type DeliveryRequest,
  type DeliveryRecovery,
} from '@/lib/learner-memory/dialogue-contracts';
import type {
  DialogueModelIdentity,
  DialogueEvidenceSettings,
} from '@/lib/dialogue/evidence-contracts';

/** This bridge preserves the existing Memory transaction/decision protocol. No scheduler lives here. */
export class DialogueMemoryService {
  readonly store: DialogueMemoryStore;
  constructor(
    readonly app: Pick<ServerPersistenceProvider, 'withTransaction'>,
    readonly memory: SimulatedMemoryEnvironment,
    readonly settings: () => Promise<DialogueEvidenceSettings>,
  ) {
    this.store = new DialogueMemoryStore(app);
  }
  private async verify(d: DialogueMemoryDelivery) {
    return this.app.withTransaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      return verifiedDialogueEvidenceIn(tx, d.ownerId, d.evidenceRunId, await this.settings());
    });
  }
  private async target(tx: Queryable, d: DialogueMemoryDelivery) {
    const env = await tx.query('SELECT id FROM f68_memory_environment WHERE singleton=true');
    invariant(
      env.rows.length === 1 && env.rows[0].id === d.environmentId,
      'MEMORY_ENVIRONMENT_MISMATCH',
    );
    const scope = simulatedScope(d.student);
    const state = await tx.query(
      'SELECT learner_key FROM learner_memory_states WHERE namespace=$1 AND learner_key=$2',
      [scope.namespace, scope.learnerKey],
    );
    invariant(state.rows.length === 1, 'SIMULATED_MEMORY_NOT_INITIALIZED');
    return scope;
  }
  private async prepareMemory(d: DialogueMemoryDelivery): Promise<PreparedMemoryRun | null> {
    return this.memory.provider.withTransaction(async (tx) => {
      const scope = await this.target(tx, d),
        keys = [scope.namespace, scope.learnerKey];
      await tx.query(
        'SELECT learner_key FROM learner_memory_states WHERE namespace=$1 AND learner_key=$2 FOR UPDATE',
        keys,
      );
      const prior = await tx.query(
        'SELECT data FROM learner_memory_runs WHERE namespace=$1 AND learner_key=$2 AND id=$3',
        [...keys, d.memoryRunId],
      );
      if (prior.rows.length) return prior.rows[0].data as PreparedMemoryRun;
      if (!d.sources.length) return null;
      const rows = await tx.query(
        'SELECT source_id,version,valid,current,processed FROM learner_memory_sources WHERE namespace=$1 AND learner_key=$2',
        keys,
      );
      const allowed = new Set(d.sources.map(sourceKey));
      if (
        rows.rows.some(
          (r) =>
            r.current && r.valid && !r.processed && !allowed.has(r.source_id + ':' + r.version),
        )
      )
        throw new DialogueMemoryError('MEMORY_PENDING_SOURCES');
      for (const s of d.sources) {
        const existing = rows.rows.find((r) => r.source_id === s.id && r.version === s.version);
        if (existing && !existing.valid) throw new DialogueMemoryError('SOURCE_WITHDRAWN');
      }
      if (
        d.sources.every((s) =>
          rows.rows.some(
            (r) =>
              r.source_id === s.id &&
              r.version === s.version &&
              r.current &&
              r.valid &&
              r.processed,
          ),
        )
      )
        return null;
      const same = new LearnerMemoryStore({
        ...this.memory.provider,
        withTransaction: (body) => body(tx),
      });
      await same.ingest(scope, d.sources);
      const run = await same.prepare(scope, d.memoryRunId);
      const expected = d.sources.filter(
        (s) =>
          !rows.rows.some((r) => r.source_id === s.id && r.version === s.version && r.processed),
      );
      if (
        run.batch.length !== expected.length ||
        run.batch.some((s) => !expected.some((e) => sourceKey(e) === sourceKey(s)))
      )
        throw new DialogueMemoryError('MEMORY_BATCH_MISMATCH');
      return run;
    });
  }
  async prepare(owner: string, request: DeliveryRequest, model: DialogueModelIdentity) {
    const d = await this.store.prepare(owner, request, await this.settings(), model);
    await this.memory.provider.withTransaction((tx) => this.target(tx, d));
    if (d.state === 'prepared') await this.prepareMemory(d);
    return this.read(owner, d.id);
  }
  async read(owner: string, id: string) {
    let d = await this.store.read(owner, id);
    if (d.state !== 'revoked') {
      try {
        await this.verify(d);
      } catch (e) {
        if (
          e instanceof DialogueMemoryError &&
          [
            'NOT_FOUND',
            'SOURCE_MISSING',
            'SOURCE_DELETED',
            'DIALOGUE_NOT_AVAILABLE',
            'NOT_ELIGIBLE',
          ].includes(e.code)
        )
          d = { ...d, state: 'revoked', reason: e.code };
        else throw e;
      }
    }
    if (d.state === 'revoked')
      return {
        delivery: { ...d, sources: [], reply: null, token: null, memoryClaimToken: null },
        memoryRun: null,
        memory: null,
      };
    const scope = await this.memory.provider.withTransaction((tx) => this.target(tx, d));
    const memory = await readMemory(this.memory.store, scope);
    let memoryRun: PreparedMemoryRun | null = null;
    const rows = await this.memory.provider.withTransaction((tx) =>
      tx.query(
        'SELECT data FROM learner_memory_runs WHERE namespace=$1 AND learner_key=$2 AND id=$3',
        [scope.namespace, scope.learnerKey, d.memoryRunId],
      ),
    );
    if (rows.rows.length) memoryRun = rows.rows[0].data as PreparedMemoryRun;
    else if (!['prepared', 'empty'].includes(d.state) && d.reason !== 'already_delivered')
      throw new DialogueMemoryError('TARGET_RESET');
    if (
      d.sources.length &&
      ['completed', 'deferred'].includes(d.state) &&
      d.sources.some(
        (s) => !memory.coverage.some((r) => r.source_id === s.id && r.version === s.version),
      )
    )
      throw new DialogueMemoryError('TARGET_RESET');
    if (d.state === 'updating' && Date.parse(d.leaseExpiresAt ?? '') <= Date.now())
      d = { ...d, state: 'unknown', reason: 'INVOCATION_RESULT_UNKNOWN' };
    return {
      delivery: { ...d, token: null, memoryClaimToken: null },
      memoryRun: memoryRun ? { ...memoryRun, claimToken: undefined } : null,
      memory,
    };
  }
  private classify(run: PreparedMemoryRun): DialogueMemoryDelivery['state'] {
    if (run.state === 'completed' || run.state === 'noop')
      return run.decisions?.some((x) => x.action === 'defer') ? 'deferred' : 'completed';
    if (run.state === 'calling' || run.errorCode === 'INVOCATION_RESULT_UNKNOWN') return 'unknown';
    return run.state === 'conflict' ? 'blocked' : 'failed';
  }
  async update(owner: string, id: string, model: DialogueModelIdentity, invoke: MemoryInvoker) {
    const view = await this.read(owner, id);
    if (view.delivery.state !== 'prepared') return view;
    if (digest(view.delivery.model) !== digest(model))
      throw new DialogueMemoryError('MODEL_CONFIG_CHANGED');
    const prepared = await this.prepareMemory(view.delivery);
    const d = await this.store.claim(owner, id, await this.settings());
    if (!d) return this.read(owner, id);
    if (!prepared) {
      await this.store.finish(owner, id, d.token!, 'completed', 'already_delivered');
      return this.read(owner, id);
    }
    try {
      const run = await updateMemory(
        this.memory.store,
        simulatedScope(d.student),
        d.memoryRunId,
        async (claim) => {
          let reply: CapturedMemoryReply;
          try {
            reply = await invoke(claim);
            invariant(reply.origin === 'model', 'INVALID_INVOCATION_ORIGIN');
          } catch {
            reply = {
              text: '',
              finishReason: 'error',
              usage: null,
              model: 'unavailable',
              origin: 'model',
            };
          }
          for (let retry = 0; ; retry++) {
            try {
              await this.store.capture(owner, id, d.token!, reply, claim.claimToken!);
              break;
            } catch (e) {
              if (e instanceof DialogueMemoryError || retry >= 2) throw e;
            }
          }
          return reply;
        },
      );
      await this.store.finish(owner, id, d.token!, this.classify(run), run.errorCode ?? null);
    } catch (e) {
      if (e instanceof DialogueMemoryError && e.code === 'INVOCATION_EXPIRED') throw e;
      await this.store.finish(owner, id, d.token!, 'unknown', 'MEMORY_PERSISTENCE_UNCERTAIN');
    }
    return this.read(owner, id);
  }
  async recover(owner: string, id: string, request: DeliveryRecovery) {
    const d = await this.store.read(owner, id);
    await this.verify(d);
    const scope = await this.memory.provider.withTransaction((tx) => this.target(tx, d));
    const run = await this.memory.store.getRun(scope, d.memoryRunId);
    if (request.action === 'finalize_saved_reply') {
      if (!d.reply || !d.memoryClaimToken || !d.token)
        throw new DialogueMemoryError('NO_SAVED_REPLY');
      if (run.state === 'calling')
        await this.memory.store.capture(scope, d.memoryRunId, d.reply, d.memoryClaimToken);
      const current = await this.memory.store.getRun(scope, d.memoryRunId);
      const result =
        current.state === 'captured'
          ? await this.memory.store.commit(scope, d.memoryRunId)
          : current;
      await this.store.finish(owner, id, d.token, this.classify(result), result.errorCode ?? null);
      return this.read(owner, id);
    }
    const state = (await this.read(owner, id)).delivery.state;
    if (request.action === 'retry_deferred') {
      if (state !== 'deferred') throw new DialogueMemoryError('RETRY_NOT_ALLOWED');
    } else {
      if (
        d.reply &&
        d.reply.finishReason !== 'error' &&
        ['calling', 'captured'].includes(run.state)
      )
        throw new DialogueMemoryError('SAVED_REPLY_AVAILABLE');
      if (!['failed', 'unknown', 'blocked'].includes(state))
        throw new DialogueMemoryError('RETRY_NOT_ALLOWED');
      if (state === 'unknown' && request.acknowledgeUnknownCost !== true)
        throw new DialogueMemoryError('UNKNOWN_COST_CONFIRMATION_REQUIRED');
      if (['prepared', 'calling', 'captured'].includes(run.state))
        await this.memory.store.abandon(scope, d.memoryRunId);
    }
    const child = await this.store.retry(owner, id, request.operationId);
    await this.prepareMemory(child);
    return this.read(owner, child.id);
  }
}
