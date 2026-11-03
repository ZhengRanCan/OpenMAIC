import { randomUUID } from 'node:crypto';
import type { Queryable } from '@openmaic/storage/document/pg';
import type { ServerPersistenceProvider } from './server-provider';
import { fenceOwnerWrite } from './owner-merges';
import { verifiedDialogueEvidenceIn } from '@/lib/server/dialogue-memory-authority';
import { adaptDialogueMemorySources } from '@/lib/learner-memory/dialogue-source';
import { digest } from '@/lib/learner-memory/contracts';
import type { CapturedMemoryReply } from '@/lib/learner-memory/contracts';
import type {
  DialogueEvidenceSettings,
  DialogueModelIdentity,
} from '@/lib/dialogue/evidence-contracts';
import {
  DialogueMemoryError,
  DIALOGUE_MEMORY_LIMITS,
  type DialogueMemoryDelivery,
  type DeliveryRequest,
  type DialogueMemorySourceRecord,
} from '@/lib/learner-memory/dialogue-contracts';

type Provider = Pick<ServerPersistenceProvider, 'withTransaction'>;
async function deliveryIn(
  tx: Queryable,
  owner: string,
  id: string,
  lock = false,
): Promise<DialogueMemoryDelivery> {
  const r = await tx.query(
    'SELECT data FROM dialogue_memory_deliveries WHERE id=$1 AND owner_id=$2' +
      (lock ? ' FOR UPDATE' : ''),
    [id, owner],
  );
  if (!r.rows.length) throw new DialogueMemoryError('NOT_FOUND', 404);
  return { ...(r.rows[0].data as DialogueMemoryDelivery), ownerId: owner };
}
async function save(tx: Queryable, d: DialogueMemoryDelivery) {
  await tx.query(
    'UPDATE dialogue_memory_deliveries SET state=$3,data=$4::jsonb WHERE id=$1 AND owner_id=$2',
    [d.id, d.ownerId, d.state, JSON.stringify(d)],
  );
}
async function insert(tx: Queryable, d: DialogueMemoryDelivery) {
  await tx.query(
    'INSERT INTO dialogue_memory_deliveries(id,owner_id,stage_id,evidence_run_id,student,environment_id,retry_of,state,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',
    [
      d.id,
      d.ownerId,
      d.stageId,
      d.evidenceRunId,
      d.student,
      d.environmentId,
      d.retryOf,
      d.state,
      JSON.stringify(d),
    ],
  );
}
async function receipt(tx: Queryable, owner: string, op: string, intent: string) {
  const r = await tx.query(
    'SELECT intent,delivery_id FROM dialogue_memory_operations WHERE owner_id=$1 AND operation_id=$2',
    [owner, op],
  );
  if (!r.rows.length) return null;
  if (r.rows[0].intent !== intent) throw new DialogueMemoryError('OPERATION_CONFLICT');
  return deliveryIn(tx, owner, r.rows[0].delivery_id as string);
}
async function addReceipt(tx: Queryable, d: DialogueMemoryDelivery, op: string, intent: string) {
  await tx.query(
    'INSERT INTO dialogue_memory_operations(owner_id,operation_id,intent,delivery_id) VALUES($1,$2,$3,$4)',
    [d.ownerId, op, intent, d.id],
  );
}
export class DialogueMemoryStore {
  constructor(readonly provider: Provider) {}
  async prepare(
    owner: string,
    request: DeliveryRequest,
    settings: DialogueEvidenceSettings,
    model: DialogueModelIdentity,
  ) {
    return this.provider.withTransaction(async (tx) => {
      await fenceOwnerWrite(tx, owner);
      // Serialize per Evidence, then the stage. The body never touches Memory DB.
      const run = await verifiedDialogueEvidenceIn(tx, owner, request.evidenceRunId, settings);
      await tx.query(
        'SELECT stage_id FROM stage_meta WHERE stage_id=$1 AND owner_id=$2 FOR UPDATE',
        [run.stageId, owner],
      );
      await verifiedDialogueEvidenceIn(tx, owner, request.evidenceRunId, settings);
      const intent = digest({ action: 'prepare', evidenceRunId: request.evidenceRunId });
      const prior = await receipt(tx, owner, request.operationId, intent);
      if (prior) return prior;
      const b = run.binding!;
      const existing = await tx.query(
        'SELECT data FROM dialogue_memory_deliveries WHERE owner_id=$1 AND evidence_run_id=$2 AND student=$3 AND environment_id=$4 AND retry_of IS NULL',
        [owner, run.id, b.student, b.memoryEnvironmentId],
      );
      let d: DialogueMemoryDelivery;
      if (existing.rows.length) d = existing.rows[0].data as DialogueMemoryDelivery;
      else {
        const sources = [];
        for (const candidate of adaptDialogueMemorySources(run)) {
          const found = await tx.query(
            'SELECT data,revoked FROM dialogue_memory_sources WHERE id=$1',
            [candidate.source.id],
          );
          if (found.rows[0]?.revoked) throw new DialogueMemoryError('SOURCE_WITHDRAWN');
          if (!found.rows.length)
            await tx.query(
              'INSERT INTO dialogue_memory_sources(id,owner_id,stage_id,environment_id,student,data) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
              [
                candidate.source.id,
                owner,
                run.stageId,
                b.memoryEnvironmentId,
                b.student,
                JSON.stringify(candidate.record),
              ],
            );
          const record = found.rows.length
            ? (found.rows[0].data as DialogueMemorySourceRecord)
            : candidate.record;
          sources.push(record.source);
          await tx.query(
            'INSERT INTO dialogue_memory_source_links(owner_id,evidence_run_id,source_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
            [owner, run.id, record.id],
          );
        }
        // Evidence windows may change while their canonical facts stay identical.
        // A new locator must not bypass an unresolved invocation/defer receipt.
        // Authorized retry children supersede their parent; only the leaf blocks.
        if (sources.length) {
          const pending = await tx.query(
            `SELECT d.id FROM dialogue_memory_deliveries d
             WHERE d.owner_id=$1 AND d.student=$2 AND d.environment_id=$3
               AND d.state NOT IN ('completed','empty','revoked')
               AND EXISTS (
                 SELECT 1 FROM dialogue_memory_source_links l
                 WHERE l.owner_id=d.owner_id AND l.evidence_run_id=d.evidence_run_id
                   AND l.source_id=ANY($4::text[])
               )
               AND NOT EXISTS (
                 SELECT 1 FROM dialogue_memory_deliveries child
                 WHERE child.owner_id=d.owner_id AND child.retry_of=d.id
               ) LIMIT 1`,
            [owner, b.student, b.memoryEnvironmentId, sources.map((s) => s.id)],
          );
          if (pending.rows.length) throw new DialogueMemoryError('SOURCE_DELIVERY_PENDING');
        }
        const id = randomUUID();
        d = {
          id,
          ownerId: owner,
          stageId: run.stageId,
          evidenceRunId: run.id,
          student: b.student,
          environmentId: b.memoryEnvironmentId,
          state: sources.length ? 'prepared' : 'empty',
          reason: null,
          sources,
          model,
          memoryRunId: 'f74:' + id,
          retryOf: null,
          token: null,
          memoryClaimToken: null,
          reply: null,
          leaseExpiresAt: null,
          createdAt: new Date().toISOString(),
        };
        await insert(tx, d);
      }
      await addReceipt(tx, d, request.operationId, intent);
      return d;
    });
  }
  async read(owner: string, id: string) {
    return this.provider.withTransaction((tx) => deliveryIn(tx, owner, id));
  }
  private async locked<T>(
    owner: string,
    id: string,
    body: (tx: Queryable, d: DialogueMemoryDelivery) => Promise<T>,
  ) {
    return this.provider.withTransaction(async (tx) => {
      await fenceOwnerWrite(tx, owner);
      const initial = await deliveryIn(tx, owner, id);
      await tx.query(
        'SELECT stage_id FROM stage_meta WHERE stage_id=$1 AND owner_id=$2 FOR UPDATE',
        [initial.stageId, owner],
      );
      return body(tx, await deliveryIn(tx, owner, id, true));
    });
  }
  async claim(owner: string, id: string, settings: DialogueEvidenceSettings) {
    return this.locked(owner, id, async (tx, d) => {
      if (d.state === 'updating' && Date.parse(d.leaseExpiresAt ?? '') <= Date.now()) {
        d.state = 'unknown';
        d.reason = 'INVOCATION_RESULT_UNKNOWN';
        await save(tx, d);
      }
      if (d.state !== 'prepared') return null;
      await verifiedDialogueEvidenceIn(tx, owner, d.evidenceRunId, settings);
      d.state = 'updating';
      d.token = randomUUID();
      d.leaseExpiresAt = new Date(Date.now() + DIALOGUE_MEMORY_LIMITS.leaseMs).toISOString();
      await save(tx, d);
      return d;
    });
  }
  async capture(
    owner: string,
    id: string,
    token: string,
    reply: CapturedMemoryReply,
    memoryClaimToken: string,
  ) {
    return this.locked(owner, id, async (tx, d) => {
      if (d.token === token && d.reply && digest(d.reply) === digest(reply)) return d;
      if (
        d.state !== 'updating' ||
        d.token !== token ||
        Date.parse(d.leaseExpiresAt ?? '') <= Date.now()
      )
        throw new DialogueMemoryError('INVOCATION_EXPIRED');
      d.reply = reply;
      d.memoryClaimToken = memoryClaimToken;
      await save(tx, d);
      return d;
    });
  }
  async finish(
    owner: string,
    id: string,
    token: string,
    state: DialogueMemoryDelivery['state'],
    reason: string | null = null,
  ) {
    return this.locked(owner, id, async (tx, d) => {
      if (d.state === 'revoked') return d;
      if (d.token !== token) throw new DialogueMemoryError('INVOCATION_EXPIRED');
      d.state = state;
      d.reason = reason;
      await save(tx, d);
      return d;
    });
  }
  async retry(owner: string, id: string, operationId: string) {
    return this.locked(owner, id, async (tx, d) => {
      const intent = digest({ action: 'retry', id });
      const old = await receipt(tx, owner, operationId, intent);
      if (old) return old;
      const found = await tx.query(
        'SELECT data FROM dialogue_memory_deliveries WHERE owner_id=$1 AND retry_of=$2',
        [owner, id],
      );
      let next: DialogueMemoryDelivery;
      if (found.rows.length) next = found.rows[0].data as DialogueMemoryDelivery;
      else {
        const child = randomUUID();
        next = {
          ...d,
          id: child,
          memoryRunId: 'f74:' + child,
          state: 'prepared',
          reason: null,
          retryOf: id,
          token: null,
          memoryClaimToken: null,
          reply: null,
          leaseExpiresAt: null,
          createdAt: new Date().toISOString(),
        };
        d.token = null;
        await save(tx, d);
        await insert(tx, next);
      }
      await addReceipt(tx, next, operationId, intent);
      return next;
    });
  }
}
