import type { Queryable } from '@openmaic/storage/document/pg';

async function exists(tx: Queryable): Promise<boolean> {
  const result = await tx.query<{ present: boolean } & Record<string, unknown>>(
    "SELECT to_regclass('quiz_evidence_runs') IS NOT NULL AS present",
  );
  return !!result.rows[0]?.present;
}

/** The caller owns the identity/stage locks and transaction. */
export async function deleteQuizEvidenceIn(
  tx: Queryable,
  owner: string,
  stageId: string,
): Promise<void> {
  if (!(await exists(tx))) return;
  await tx.query('DELETE FROM quiz_evidence_requests WHERE owner_id=$1 AND stage_id=$2', [
    owner,
    stageId,
  ]);
  await tx.query('DELETE FROM quiz_evidence_runs WHERE owner_id=$1 AND stage_id=$2', [
    owner,
    stageId,
  ]);
}

/** A receipt collision aborts the encompassing claim instead of merging different operations. */
export async function rekeyQuizEvidenceIn(
  tx: Queryable,
  from: string,
  to: string,
): Promise<number> {
  if (!(await exists(tx))) return 0;
  await tx.query('UPDATE quiz_evidence_requests SET owner_id=$2 WHERE owner_id=$1', [from, to]);
  const moved = await tx.query(
    'UPDATE quiz_evidence_runs SET owner_id=$2 WHERE owner_id=$1 RETURNING id',
    [from, to],
  );
  return moved.rows.length;
}
