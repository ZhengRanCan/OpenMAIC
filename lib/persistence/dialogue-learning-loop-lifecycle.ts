import type { Queryable } from '@openmaic/storage/document/pg';
import type { DialogueLoopJob } from '@/lib/dialogue/learning-loop-contracts';
import { saveLoopJobIn } from '@/lib/server/dialogue-learning-loop/store';
async function exists(tx: Queryable) {
  return !!(await tx.query("SELECT to_regclass('dialogue_loop_jobs') AS present")).rows[0]?.present;
}
export async function restrictDialogueLoopIn(
  tx: Queryable,
  owner: string,
  locator: { stageId?: string; chatSessionId?: string; evidenceRunId?: string },
) {
  if (!(await exists(tx))) return;
  const keys: unknown[] = [owner];
  let clause = 'owner_id=$1';
  if (locator.stageId) {
    keys.push(locator.stageId);
    clause += ` AND stage_id=$${keys.length}`;
  }
  if (locator.chatSessionId) {
    keys.push(locator.chatSessionId);
    clause += ` AND chat_session_id=$${keys.length}`;
  }
  if (locator.evidenceRunId) {
    keys.push(locator.evidenceRunId);
    clause += ` AND data->>'evidenceRunId'=$${keys.length}`;
  }
  const jobs = await tx.query(
    `SELECT data FROM dialogue_loop_jobs WHERE ${clause} FOR UPDATE`,
    keys,
  );
  for (const row of jobs.rows) {
    const j = row.data as DialogueLoopJob;
    j.state = 'revoked';
    j.reason = 'SOURCE_REVOKED';
    j.snapshot = null;
    j.binding = null;
    j.token = null;
    await saveLoopJobIn(tx, j);
  }
  if (locator.evidenceRunId) return; // deleting an explanation does not delete the whole Session.
  await tx.query(
    `UPDATE dialogue_loop_sessions SET revoked=true,binding=NULL,reason='SOURCE_REVOKED' WHERE ${clause}`,
    keys,
  );
  await tx.query(`UPDATE dialogue_loop_bindings SET revoked=true WHERE ${clause}`, keys);
}
/** Identity locks are owned by the claim coordinator. No old identity is silently rebound. */
export async function rekeyDialogueLoopIn(tx: Queryable, from: string, to: string) {
  if (!(await exists(tx))) return 0;
  await restrictDialogueLoopIn(tx, from, {});
  // Existing target baseline/session receipts take precedence, both remain ineligible.
  await tx.query(
    'DELETE FROM dialogue_loop_sessions a USING dialogue_loop_sessions b WHERE a.owner_id=$1 AND b.owner_id=$2 AND a.stage_id=b.stage_id AND a.chat_session_id=b.chat_session_id',
    [from, to],
  );
  await tx.query('UPDATE dialogue_loop_sessions SET owner_id=$2 WHERE owner_id=$1', [from, to]);
  await tx.query('DELETE FROM dialogue_loop_bindings WHERE owner_id=$1', [from]);
  await tx.query('DELETE FROM dialogue_loop_operations WHERE owner_id=$1', [from]);
  const r = await tx.query(
    "UPDATE dialogue_loop_jobs SET owner_id=$2,data=jsonb_set(data,'{ownerId}',to_jsonb($2::text)) WHERE owner_id=$1 RETURNING id",
    [from, to],
  );
  return r.rows.length;
}
