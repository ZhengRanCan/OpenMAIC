import { randomUUID } from 'node:crypto';
import type { Queryable } from '@openmaic/storage/document/pg';
import type { ServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { fenceOwnerWrite } from '@/lib/persistence/owner-merges';
import {
  DialogueLoopError,
  LOOP_LEASE_MS,
  type DialogueLoopJob,
} from '@/lib/dialogue/learning-loop-contracts';
export type LoopProvider = Pick<ServerPersistenceProvider, 'withTransaction'>;
export async function readLoopJobIn(
  tx: Queryable,
  owner: string,
  id: string,
  lock = false,
): Promise<DialogueLoopJob> {
  const r = await tx.query(
    'SELECT data FROM dialogue_loop_jobs WHERE id=$1 AND owner_id=$2' + (lock ? ' FOR UPDATE' : ''),
    [id, owner],
  );
  if (!r.rows.length) throw new DialogueLoopError('NOT_FOUND', 404);
  return r.rows[0].data as DialogueLoopJob;
}
export async function saveLoopJobIn(tx: Queryable, job: DialogueLoopJob) {
  await tx.query(
    'UPDATE dialogue_loop_jobs SET state=$3,data=$4::jsonb WHERE id=$1 AND owner_id=$2',
    [job.id, job.ownerId, job.state, JSON.stringify(job)],
  );
}
/** Read stage facts after a lost outer checkpoint; never claims or invokes a stage. */
export async function refreshLoopStageStatesIn(
  tx: Queryable,
  job: DialogueLoopJob,
): Promise<DialogueLoopJob> {
  if (job.state === 'revoked' || job.state === 'not_eligible') return job;
  const result = { ...job };
  for (const [id, table, field, calling] of [
    [job.evidenceRunId, 'dialogue_evidence_runs', 'evidenceState', 'calling'],
    [
      job.blockingDeliveryId ?? job.memoryDeliveryId,
      'dialogue_memory_deliveries',
      'memoryState',
      'updating',
    ],
  ] as const) {
    if (!id) continue;
    const r = await tx.query(`SELECT data FROM ${table} WHERE id=$1 AND owner_id=$2`, [
      id,
      job.ownerId,
    ]);
    const stage = r.rows[0]?.data as { state: string; leaseExpiresAt?: string } | undefined;
    if (stage)
      result[field] =
        stage.state === calling && Date.parse(stage.leaseExpiresAt ?? '') <= Date.now()
          ? 'unknown'
          : stage.state;
  }
  return result;
}
export class DialogueLoopStore {
  constructor(readonly provider: LoopProvider) {}
  read(owner: string, id: string) {
    return this.provider.withTransaction(async (tx) =>
      refreshLoopStageStatesIn(tx, await readLoopJobIn(tx, owner, id)),
    );
  }
  async claim(): Promise<DialogueLoopJob | null> {
    return this.provider.withTransaction(async (tx) => {
      // Serialize coordination, not the external model work. Also prevents two
      // ready rows for the same simulated student racing the partial index.
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('dialogue-loop-claims'))");
      const expired = await tx.query(
        "SELECT data FROM dialogue_loop_jobs WHERE state='running' AND (data->>'leaseExpiresAt')::timestamptz<=now()",
      );
      for (const row of expired.rows) {
        const candidate = row.data as DialogueLoopJob;
        await fenceOwnerWrite(tx, candidate.ownerId);
        const j = await refreshLoopStageStatesIn(
          tx,
          await readLoopJobIn(tx, candidate.ownerId, candidate.id, true),
        );
        if (j.state !== 'running' || Date.parse(j.leaseExpiresAt ?? '') > Date.now()) continue;
        j.state = 'unknown';
        j.reason = 'EXECUTION_UNKNOWN';
        j.token = null;
        await saveLoopJobIn(tx, j);
      }
      const next = await tx.query(
        `SELECT j.data FROM dialogue_loop_jobs j WHERE j.state='queued' AND NOT EXISTS(SELECT 1 FROM dialogue_loop_jobs a WHERE a.state='running' AND a.environment_id=j.environment_id AND a.student=j.student) ORDER BY j.created_at,j.id LIMIT 1`,
      );
      if (!next.rows.length) return null;
      const candidate = next.rows[0].data as DialogueLoopJob;
      await fenceOwnerWrite(tx, candidate.ownerId);
      const locked = await tx.query(
        "SELECT data FROM dialogue_loop_jobs WHERE id=$1 AND owner_id=$2 AND state='queued' FOR UPDATE SKIP LOCKED",
        [candidate.id, candidate.ownerId],
      );
      if (!locked.rows.length) return null;
      const j = locked.rows[0].data as DialogueLoopJob;
      j.state = 'running';
      j.token = randomUUID();
      j.leaseExpiresAt = new Date(Date.now() + LOOP_LEASE_MS).toISOString();
      await saveLoopJobIn(tx, j);
      return j;
    });
  }
  async checkpoint(job: DialogueLoopJob): Promise<void> {
    return this.provider.withTransaction(async (tx) => {
      await fenceOwnerWrite(tx, job.ownerId);
      const current = await readLoopJobIn(tx, job.ownerId, job.id, true);
      if (
        current.state !== 'running' ||
        !job.token ||
        current.token !== job.token ||
        Date.parse(current.leaseExpiresAt ?? '') <= Date.now()
      )
        throw new DialogueLoopError('JOB_CLAIM_EXPIRED');
      await saveLoopJobIn(tx, job);
    });
  }
}
