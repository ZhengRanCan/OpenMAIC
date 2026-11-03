import type { Queryable } from '@openmaic/storage/document/pg';

async function exists(tx: Queryable) {
  return !!(await tx.query("SELECT to_regclass('dialogue_evidence_runs') AS present")).rows[0]
    ?.present;
}
export async function deleteDialogueEvidenceIn(tx: Queryable, owner: string, stageId: string) {
  if (!(await exists(tx))) return;
  for (const table of [
    'dialogue_evidence_requests',
    'dialogue_evidence_revocations',
    'dialogue_evidence_runs',
  ])
    await tx.query(`DELETE FROM ${table} WHERE owner_id=$1 AND stage_id=$2`, [owner, stageId]);
}
/** Caller holds both identity locks. Pending work cannot carry an old identity into a paid call. */
export async function rekeyDialogueEvidenceIn(
  tx: Queryable,
  from: string,
  to: string,
): Promise<number> {
  if (!(await exists(tx))) return 0;
  await tx.query('UPDATE dialogue_evidence_requests SET owner_id=$2 WHERE owner_id=$1', [from, to]);
  await tx.query('UPDATE dialogue_evidence_revocations SET owner_id=$2 WHERE owner_id=$1', [
    from,
    to,
  ]);
  const moved = await tx.query(
    `UPDATE dialogue_evidence_runs SET owner_id=$2,
    state=CASE WHEN state IN ('prepared','calling') THEN 'blocked' ELSE state END,
    data=CASE WHEN state IN ('prepared','calling') THEN data || '{"state":"blocked","reason":"OWNER_CHANGED","token":null}'::jsonb ELSE data END
    WHERE owner_id=$1 RETURNING id`,
    [from, to],
  );
  return moved.rows.length;
}
