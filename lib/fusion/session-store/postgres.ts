import { createHash } from 'node:crypto';
import type { Queryable, WithTransaction } from '../reliability/postgres';
import type { CreateFusionSession, FusionSessionRecord, FusionSessionStore } from './types';

type StoredRow = { data: unknown };
type CountRow = { count: string };

export const FUSION_SESSION_PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS fusion_sessions (
  lesson_session_id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL,
  credential_ref TEXT NOT NULL,
  session_token_hash TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS fusion_sessions_learner_idx ON fusion_sessions (learner_id);
CREATE INDEX IF NOT EXISTS fusion_sessions_expiry_idx ON fusion_sessions (expires_at);
`;

export async function ensureFusionSessionSchema(queryable: Queryable): Promise<void> {
  for (const statement of FUSION_SESSION_PG_SCHEMA.split(';')) {
    if (statement.trim()) await queryable.query(statement);
  }
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function decode(value: unknown): FusionSessionRecord {
  const data = typeof value === 'string' ? JSON.parse(value) : value;
  if (!data || typeof data !== 'object') throw new Error('Corrupt Fusion session record');
  const record = data as FusionSessionRecord;
  if (
    record.schemaVersion !== 'v1' ||
    !record.lessonSessionId ||
    !record.learnerId ||
    !record.credentialRef
  ) {
    throw new Error('Invalid Fusion session record');
  }
  return record;
}

function stamp(input: CreateFusionSession): FusionSessionRecord {
  const now = (input.now ?? new Date()).toISOString();
  const { now: _now, ...record } = input;
  return { ...record, schemaVersion: 'v1', revision: 0, createdAt: now, updatedAt: now };
}

/** PostgreSQL-only authoritative store. Cookie tokens are stored as SHA-256 hashes. */
export class PgFusionSessionStore implements FusionSessionStore {
  constructor(
    private readonly queryable: Queryable,
    private readonly withTransaction: WithTransaction,
  ) {}

  async create(
    input: CreateFusionSession,
    browserSessionToken: string,
  ): Promise<FusionSessionRecord> {
    if (!browserSessionToken) throw new Error('Fusion browser session token is required');
    const record = stamp(input);
    await this.queryable.query(
      `INSERT INTO fusion_sessions
        (lesson_session_id, learner_id, credential_ref, session_token_hash, revision, expires_at, completed_at, created_at, updated_at, data)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8::timestamptz, $9::timestamptz, $10::jsonb)`,
      [
        record.lessonSessionId,
        record.learnerId,
        record.credentialRef,
        hashSessionToken(browserSessionToken),
        record.revision,
        record.expiresAt,
        record.completedAt ?? null,
        record.createdAt,
        record.updatedAt,
        JSON.stringify(record),
      ],
    );
    return record;
  }

  async recover(
    browserSessionToken: string,
    now = new Date(),
  ): Promise<FusionSessionRecord | undefined> {
    if (!browserSessionToken) return undefined;
    const result = await this.queryable.query<StoredRow>(
      `SELECT data FROM fusion_sessions
        WHERE session_token_hash = $1 AND expires_at > $2::timestamptz`,
      [hashSessionToken(browserSessionToken), now.toISOString()],
    );
    return result.rows[0] ? decode(result.rows[0].data) : undefined;
  }

  async get(lessonSessionId: string): Promise<FusionSessionRecord | undefined> {
    const result = await this.queryable.query<StoredRow>(
      'SELECT data FROM fusion_sessions WHERE lesson_session_id = $1',
      [lessonSessionId],
    );
    return result.rows[0] ? decode(result.rows[0].data) : undefined;
  }

  async compareAndSet(
    lessonSessionId: string,
    expectedRevision: number,
    update: (record: FusionSessionRecord) => FusionSessionRecord,
  ): Promise<FusionSessionRecord | undefined> {
    return this.withTransaction((queryable) =>
      this.compareAndSetInTransaction(queryable, lessonSessionId, expectedRevision, update),
    );
  }

  /**
   * Lets a related durable write share the session CAS transaction.  Callers
   * must supply the same transaction boundary used for every related write.
   */
  async compareAndSetInTransaction(
    queryable: Queryable,
    lessonSessionId: string,
    expectedRevision: number,
    update: (record: FusionSessionRecord) => FusionSessionRecord,
  ): Promise<FusionSessionRecord | undefined> {
    const found = await queryable.query<StoredRow>(
      'SELECT data FROM fusion_sessions WHERE lesson_session_id = $1 FOR UPDATE',
      [lessonSessionId],
    );
    if (!found.rows[0]) return undefined;
    const current = decode(found.rows[0].data);
    if (current.revision !== expectedRevision) return undefined;
    const next = update(current);
    if (
      next.lessonSessionId !== current.lessonSessionId ||
      next.learnerId !== current.learnerId ||
      next.credentialRef !== current.credentialRef
    ) {
      throw new Error('Fusion session identity and credentialRef are immutable');
    }
    const stamped: FusionSessionRecord = {
      ...next,
      schemaVersion: 'v1',
      revision: current.revision + 1,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };
    const result = await queryable.query<{ lesson_session_id: string }>(
      `UPDATE fusion_sessions
          SET revision = $3, expires_at = $4::timestamptz, completed_at = $5::timestamptz,
              updated_at = $6::timestamptz, data = $7::jsonb
        WHERE lesson_session_id = $1 AND revision = $2
        RETURNING lesson_session_id`,
      [
        lessonSessionId,
        expectedRevision,
        stamped.revision,
        stamped.expiresAt,
        stamped.completedAt ?? null,
        stamped.updatedAt,
        JSON.stringify(stamped),
      ],
    );
    return result.rows.length === 0 ? undefined : stamped;
  }

  async deleteForLearner(learnerId: string): Promise<number> {
    const result = await this.queryable.query<CountRow>(
      'WITH deleted AS (DELETE FROM fusion_sessions WHERE learner_id = $1 RETURNING 1) SELECT COUNT(*)::text AS count FROM deleted',
      [learnerId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async deleteForLesson(lessonSessionId: string): Promise<number> {
    const result = await this.queryable.query<CountRow>(
      'WITH deleted AS (DELETE FROM fusion_sessions WHERE lesson_session_id = $1 RETURNING 1) SELECT COUNT(*)::text AS count FROM deleted',
      [lessonSessionId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async purgeExpired(now = new Date()): Promise<number> {
    const result = await this.queryable.query<CountRow>(
      `WITH deleted AS (
         DELETE FROM fusion_sessions
          WHERE (completed_at IS NOT NULL AND completed_at <= $1::timestamptz)
             OR expires_at <= $2::timestamptz
          RETURNING 1
       ) SELECT COUNT(*)::text AS count FROM deleted`,
      [new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), now.toISOString()],
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}
