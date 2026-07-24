// Development Only SQLite Outbox. Never import from a browser module.
type SqliteRow = Record<string, unknown>;
type SqliteStatement = { run(...parameters: unknown[]): { changes: number }; get(...parameters: unknown[]): SqliteRow | undefined };
type SqliteDatabase = { exec(sql: string): void; prepare(sql: string): SqliteStatement };
import { DatabaseSync } from 'node:sqlite';
import type { ProfileUpdateCandidate } from '../profile-update-candidate';

export type OutboxStatus = 'pending' | 'processing' | 'delivered' | 'retry_scheduled' | 'dead_letter';
export interface OutboxRecord { candidate: ProfileUpdateCandidate; status: OutboxStatus; attempts: number; leaseUntil?: number; receipt?: { status: string; reasonCode?: string }; }
export class FusionOutboxStore {
  private readonly db: SqliteDatabase;
  constructor(path = ':memory:') { this.db = new DatabaseSync(path) as unknown as SqliteDatabase; this.db.exec('CREATE TABLE IF NOT EXISTS fusion_outbox (id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL, lease_until INTEGER, receipt TEXT)'); }
  enqueue(candidate: ProfileUpdateCandidate): boolean { const result = this.db.prepare('INSERT OR IGNORE INTO fusion_outbox VALUES (?, ?, ?, 0, NULL, NULL)').run(candidate.idempotencyKey, JSON.stringify(candidate), 'pending'); return result.changes === 1; }
  acquire(now = Date.now(), leaseMs = 30_000): OutboxRecord | undefined { this.db.prepare("UPDATE fusion_outbox SET status='pending', lease_until=NULL WHERE status='processing' AND lease_until < ?").run(now); const row = this.db.prepare("SELECT * FROM fusion_outbox WHERE status IN ('pending','retry_scheduled') ORDER BY attempts LIMIT 1").get(); if (!row) return undefined; this.db.prepare("UPDATE fusion_outbox SET status='processing', lease_until=?, attempts=attempts+1 WHERE id=?").run(now + leaseMs, row.id); return this.get(row.id); }
  complete(key: string, receipt: { status: string; reasonCode?: string }, maxAttempts = 3): void { const record = this.get(key); if (!record) return; const status: OutboxStatus = receipt.status === 'accepted' || receipt.status === 'queued' || receipt.status === 'duplicate' ? 'delivered' : record.attempts >= maxAttempts || receipt.status === 'rejected' ? 'dead_letter' : 'retry_scheduled'; this.db.prepare('UPDATE fusion_outbox SET status=?, lease_until=NULL, receipt=? WHERE id=?').run(status, JSON.stringify(receipt), key); }
  get(key: string): OutboxRecord | undefined { const row = this.db.prepare('SELECT * FROM fusion_outbox WHERE id=?').get(key); return row ? { candidate: JSON.parse(String(row.payload)) as ProfileUpdateCandidate, status: row.status as OutboxStatus, attempts: Number(row.attempts), ...(row.lease_until ? { leaseUntil: Number(row.lease_until) } : {}), ...(row.receipt ? { receipt: JSON.parse(String(row.receipt)) as { status: string; reasonCode?: string } } : {}) } : undefined; }
}
