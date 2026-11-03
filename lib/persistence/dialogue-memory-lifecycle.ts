import type { Queryable } from '@openmaic/storage/document/pg';
async function exists(tx: Queryable) {
  return !!(await tx.query("SELECT to_regclass('dialogue_memory_deliveries') AS present")).rows[0]
    ?.present;
}
export async function restrictDialogueMemoryIn(
  tx: Queryable,
  owner: string,
  locator: { stageId?: string; evidenceRunId?: string },
) {
  if (!(await exists(tx))) return;
  const clause = locator.stageId ? 'stage_id=$2' : 'evidence_run_id=$2',
    value = locator.stageId ?? locator.evidenceRunId;
  await tx.query(
    `UPDATE dialogue_memory_sources SET revoked=true WHERE owner_id=$1 AND ${locator.stageId ? 'stage_id=$2' : 'id IN (SELECT source_id FROM dialogue_memory_source_links WHERE owner_id=$1 AND evidence_run_id=$2)'}`,
    [owner, value],
  );
  await tx.query(
    `UPDATE dialogue_memory_deliveries SET state='revoked',data=data || '{"state":"revoked","reason":"SOURCE_REVOKED","token":null,"memoryClaimToken":null}'::jsonb WHERE owner_id=$1 AND ${clause}`,
    [owner, value],
  );
}
export async function rekeyDialogueMemoryIn(tx: Queryable, from: string, to: string) {
  if (!(await exists(tx))) return 0;
  await tx.query('UPDATE dialogue_memory_operations SET owner_id=$2 WHERE owner_id=$1', [from, to]);
  await tx.query('UPDATE dialogue_memory_source_links SET owner_id=$2 WHERE owner_id=$1', [
    from,
    to,
  ]);
  await tx.query('UPDATE dialogue_memory_sources SET owner_id=$2,revoked=true WHERE owner_id=$1', [
    from,
    to,
  ]);
  const moved = await tx.query(
    `UPDATE dialogue_memory_deliveries SET owner_id=$2,state='revoked',data=data || '{"state":"revoked","reason":"OWNER_CHANGED","token":null,"memoryClaimToken":null}'::jsonb WHERE owner_id=$1 RETURNING id`,
    [from, to],
  );
  return moved.rows.length;
}
