import type { Queryable, WithTransaction } from '../reliability/postgres';
import type { FusionJsonObject } from '../session-store/types';

export type ProductionOutboxKind = 'classroom_event' | 'profile_update_candidate';
export type ProductionOutboxStatus =
  | 'pending'
  | 'processing'
  | 'delivered'
  | 'retry_scheduled'
  | 'dead_letter';
export type OutboxFailureKind = 'transient' | 'permanent';

export interface ProductionOutboxMessage {
  idempotencyKey: string;
  kind: ProductionOutboxKind;
  lessonSessionId: string;
  learnerKey: string;
  credentialRef: string;
  payload: FusionJsonObject;
  eventId?: string;
  candidateId?: string;
}

export interface LeasedOutboxMessage extends ProductionOutboxMessage {
  status: 'processing';
  attemptCount: number;
  leaseOwner: string;
  leaseExpiresAt: string;
}

export interface OutboxReceipt {
  status: 'accepted' | 'queued' | 'duplicate' | 'rejected';
  reasonCode?: string;
}

/** Sanitized delivery state for classroom summaries; payload and credentials stay hidden. */
export interface OutboxDeliveryState {
  status: ProductionOutboxStatus;
  receipt?: OutboxReceipt;
  reasonCode?: string;
}

export interface OutboxOperatorAction {
  operatorId: string;
  reason: string;
  action: 'replay' | 'discard';
}

type StoredRow = {
  idempotency_key: string;
  kind: ProductionOutboxKind;
  lesson_session_id: string;
  learner_key: string;
  credential_ref: string;
  payload: unknown;
  event_id: string | null;
  candidate_id: string | null;
  attempt_count: number | string;
  lease_owner: string | null;
  lease_expires_at: string | null;
};

type DeliveryRow = {
  status: ProductionOutboxStatus;
  receipt: unknown;
  last_reason_code: string | null;
};

export const FUSION_OUTBOX_PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS fusion_outbox (
  idempotency_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  lesson_session_id TEXT NOT NULL,
  learner_key TEXT NOT NULL,
  credential_ref TEXT NOT NULL,
  event_id TEXT,
  candidate_id TEXT,
  payload JSONB NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_reason_code TEXT,
  receipt JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS fusion_outbox_ready_idx
  ON fusion_outbox (status, next_attempt_at, attempt_count);
CREATE INDEX IF NOT EXISTS fusion_outbox_learner_idx ON fusion_outbox (learner_key);
CREATE TABLE IF NOT EXISTS fusion_outbox_operator_actions (
  id BIGSERIAL PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE fusion_outbox_operator_actions
  DROP CONSTRAINT IF EXISTS fusion_outbox_operator_actions_idempotency_key_fkey;
`;

export async function ensureFusionOutboxSchema(queryable: Queryable): Promise<void> {
  for (const statement of FUSION_OUTBOX_PG_SCHEMA.split(';')) {
    if (statement.trim()) await queryable.query(statement);
  }
}

function assertNoCredentialMaterial(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoCredentialMaterial(item);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (/token|secret|private.?key|authorization|password/i.test(key)) {
      throw new Error('Outbox payload must not contain credential material');
    }
    assertNoCredentialMaterial(nested);
  }
}

function encodedPayload(payload: FusionJsonObject): string {
  assertNoCredentialMaterial(payload);
  return JSON.stringify(payload);
}

function messageFrom(
  row: StoredRow,
  leaseOwner: string,
  leaseExpiresAt: string,
): LeasedOutboxMessage {
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  return {
    idempotencyKey: row.idempotency_key,
    kind: row.kind,
    lessonSessionId: row.lesson_session_id,
    learnerKey: row.learner_key,
    credentialRef: row.credential_ref,
    payload: payload as FusionJsonObject,
    ...(row.event_id ? { eventId: row.event_id } : {}),
    ...(row.candidate_id ? { candidateId: row.candidate_id } : {}),
    status: 'processing',
    attemptCount: Number(row.attempt_count),
    leaseOwner,
    leaseExpiresAt,
  };
}

/** The approved, PostgreSQL-only production Outbox implementation. */
export class PgFusionOutboxStore {
  constructor(
    private readonly queryable: Queryable,
    private readonly transactionHook: WithTransaction,
  ) {}

  async enqueue(message: ProductionOutboxMessage, now = new Date()): Promise<boolean> {
    return this.enqueueInTransaction(this.queryable, message, now);
  }

  async getDelivery(idempotencyKey: string): Promise<OutboxDeliveryState | undefined> {
    const result = await this.queryable.query<DeliveryRow>(
      `SELECT status, receipt, last_reason_code
         FROM fusion_outbox
        WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const receipt = typeof row.receipt === 'string' ? JSON.parse(row.receipt) : row.receipt;
    const status = receipt && typeof receipt === 'object' ? (receipt as Record<string, unknown>).status : undefined;
    const validReceipt: OutboxReceipt | undefined =
      status === 'accepted' || status === 'queued' || status === 'duplicate' || status === 'rejected'
        ? {
            status: status as OutboxReceipt['status'],
            ...(typeof (receipt as Record<string, unknown>).reasonCode === 'string'
              ? { reasonCode: (receipt as Record<string, string>).reasonCode }
              : {}),
          }
        : undefined;
    return {
      status: row.status,
      ...(validReceipt ? { receipt: validReceipt } : {}),
      ...(row.last_reason_code ? { reasonCode: row.last_reason_code } : {}),
    };
  }

  async enqueueInTransaction(
    queryable: Queryable,
    message: ProductionOutboxMessage,
    now = new Date(),
  ): Promise<boolean> {
    const result = await queryable.query<{ idempotency_key: string }>(
      `INSERT INTO fusion_outbox
        (idempotency_key, kind, lesson_session_id, learner_key, credential_ref, event_id, candidate_id, payload, status, attempt_count, next_attempt_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'pending', 0, $9::timestamptz, $9::timestamptz, $9::timestamptz)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING idempotency_key`,
      [
        message.idempotencyKey,
        message.kind,
        message.lessonSessionId,
        message.learnerKey,
        message.credentialRef,
        message.eventId ?? null,
        message.candidateId ?? null,
        encodedPayload(message.payload),
        now.toISOString(),
      ],
    );
    return result.rows.length === 1;
  }

  /** Lets a classroom fact/runtime-state update and its Outbox row commit together. */
  async transaction<T>(body: (queryable: Queryable) => Promise<T>): Promise<T> {
    return this.transactionHook(body);
  }

  async acquire(
    workerId: string,
    leaseMs: number,
    now = new Date(),
  ): Promise<LeasedOutboxMessage | undefined> {
    if (!workerId || leaseMs < 1)
      throw new Error('Worker id and positive lease duration are required');
    return this.transactionHook(async (queryable) => {
      await queryable.query(
        `UPDATE fusion_outbox SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL, updated_at = $1::timestamptz
          WHERE status = 'processing' AND lease_expires_at <= $1::timestamptz`,
        [now.toISOString()],
      );
      const selected = await queryable.query<StoredRow>(
        `SELECT idempotency_key, kind, lesson_session_id, learner_key, credential_ref, event_id, candidate_id, payload, attempt_count, lease_owner, lease_expires_at
           FROM fusion_outbox
          WHERE status IN ('pending', 'retry_scheduled') AND next_attempt_at <= $1::timestamptz
          ORDER BY next_attempt_at ASC, created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
        [now.toISOString()],
      );
      const row = selected.rows[0];
      if (!row) return undefined;
      const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
      const updated = await queryable.query<StoredRow>(
        `UPDATE fusion_outbox
            SET status = 'processing', attempt_count = attempt_count + 1, lease_owner = $2,
                lease_expires_at = $3::timestamptz, updated_at = $1::timestamptz
          WHERE idempotency_key = $4
          RETURNING idempotency_key, kind, lesson_session_id, learner_key, credential_ref, event_id, candidate_id, payload, attempt_count, lease_owner, lease_expires_at`,
        [now.toISOString(), workerId, leaseExpiresAt, row.idempotency_key],
      );
      const leased = updated.rows[0];
      return leased ? messageFrom(leased, workerId, leaseExpiresAt) : undefined;
    });
  }

  async complete(
    message: LeasedOutboxMessage,
    receipt: OutboxReceipt,
    failureKind?: OutboxFailureKind,
    nextAttemptAt?: Date,
    now = new Date(),
  ): Promise<'delivered' | 'retry_scheduled' | 'dead_letter'> {
    const delivered =
      failureKind === undefined &&
      (receipt.status === 'accepted' ||
        receipt.status === 'queued' ||
        receipt.status === 'duplicate');
    const terminal =
      failureKind === 'permanent' ||
      (failureKind === undefined && receipt.status === 'rejected') ||
      message.attemptCount >= 4;
    const status = delivered ? 'delivered' : terminal ? 'dead_letter' : 'retry_scheduled';
    const result = await this.queryable.query<{
      status: 'delivered' | 'retry_scheduled' | 'dead_letter';
    }>(
      `UPDATE fusion_outbox
          SET status = $1, receipt = $2::jsonb, last_reason_code = $3, next_attempt_at = $4::timestamptz,
              lease_owner = NULL, lease_expires_at = NULL, updated_at = $5::timestamptz
        WHERE idempotency_key = $6 AND status = 'processing' AND lease_owner = $7
        RETURNING status`,
      [
        status,
        JSON.stringify(receipt),
        receipt.reasonCode ?? null,
        (nextAttemptAt ?? now).toISOString(),
        now.toISOString(),
        message.idempotencyKey,
        message.leaseOwner,
      ],
    );
    if (!result.rows[0]) throw new Error('Outbox lease was lost before completion');
    return result.rows[0].status;
  }

  async replay(
    idempotencyKey: string,
    action: OutboxOperatorAction,
    now = new Date(),
  ): Promise<boolean> {
    if (action.action !== 'replay') throw new Error('Expected replay action');
    return this.transactionHook(async (queryable) => {
      const updated = await queryable.query<{ idempotency_key: string }>(
        `UPDATE fusion_outbox
            SET status = 'pending', next_attempt_at = $2::timestamptz, lease_owner = NULL, lease_expires_at = NULL,
                last_reason_code = NULL, updated_at = $2::timestamptz
          WHERE idempotency_key = $1 AND status = 'dead_letter'
          RETURNING idempotency_key`,
        [idempotencyKey, now.toISOString()],
      );
      if (!updated.rows[0]) return false;
      await queryable.query(
        `INSERT INTO fusion_outbox_operator_actions (idempotency_key, operator_id, action, reason, created_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz)`,
        [idempotencyKey, action.operatorId, action.action, action.reason, now.toISOString()],
      );
      return true;
    });
  }

  async discard(
    idempotencyKey: string,
    action: OutboxOperatorAction,
    now = new Date(),
  ): Promise<boolean> {
    if (action.action !== 'discard') throw new Error('Expected discard action');
    return this.transactionHook(async (queryable) => {
      const updated = await queryable.query<{ idempotency_key: string }>(
        `UPDATE fusion_outbox SET last_reason_code = 'operator_discarded', updated_at = $2::timestamptz
          WHERE idempotency_key = $1 AND status = 'dead_letter' RETURNING idempotency_key`,
        [idempotencyKey, now.toISOString()],
      );
      if (!updated.rows[0]) return false;
      await queryable.query(
        `INSERT INTO fusion_outbox_operator_actions (idempotency_key, operator_id, action, reason, created_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz)`,
        [idempotencyKey, action.operatorId, action.action, action.reason, now.toISOString()],
      );
      return true;
    });
  }

  async deleteForLearner(learnerKey: string): Promise<number> {
    const result = await this.queryable.query<{ count: string }>(
      'WITH deleted AS (DELETE FROM fusion_outbox WHERE learner_key = $1 RETURNING 1) SELECT COUNT(*)::text AS count FROM deleted',
      [learnerKey],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async purgeExpired(now = new Date()): Promise<{ messages: number; auditActions: number }> {
    const deliveredBefore = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const deadLetterBefore = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const auditBefore = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    return this.transactionHook(async (queryable) => {
      const messages = await queryable.query<{ count: string }>(
        `WITH deleted AS (
           DELETE FROM fusion_outbox
            WHERE (status = 'delivered' AND updated_at <= $1::timestamptz)
               OR (status = 'dead_letter' AND updated_at <= $2::timestamptz)
            RETURNING 1
         ) SELECT COUNT(*)::text AS count FROM deleted`,
        [deliveredBefore, deadLetterBefore],
      );
      const auditActions = await queryable.query<{ count: string }>(
        `WITH deleted AS (
           DELETE FROM fusion_outbox_operator_actions
            WHERE created_at <= $1::timestamptz
            RETURNING 1
         ) SELECT COUNT(*)::text AS count FROM deleted`,
        [auditBefore],
      );
      return {
        messages: Number(messages.rows[0]?.count ?? 0),
        auditActions: Number(auditActions.rows[0]?.count ?? 0),
      };
    });
  }
}
