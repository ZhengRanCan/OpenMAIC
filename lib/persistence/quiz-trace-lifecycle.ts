import type { Queryable } from '@openmaic/storage/document/pg';
import { releaseRetentionsIn } from '@openmaic/storage/asset/pg';

/** Caller holds owner identity + stage row locks. No independent transaction. */
export async function deleteQuizTraceIn(
  tx: Queryable,
  owner: string,
  scope: { stageId: string; attemptId?: string },
) {
  const exists = await tx.query<{ present: boolean } & Record<string, unknown>>(
    "SELECT to_regclass('quiz_trace_attempts') IS NOT NULL AS present",
  );
  if (!exists.rows[0]?.present) return;
  const rows = await tx.query<{ id: string; version_id: string } & Record<string, unknown>>(
    'SELECT id,version_id FROM quiz_trace_attempts WHERE owner_id=$1 AND stage_id=$2 AND ($3::text IS NULL OR id=$3) ORDER BY id FOR UPDATE',
    [owner, scope.stageId, scope.attemptId ?? null],
  );
  // Delete operation receipts for this course: deleted operations cannot resurrect activities.
  await tx.query('DELETE FROM quiz_trace_operations WHERE owner_id=$1 AND stage_id=$2', [
    owner,
    scope.stageId,
  ]);
  for (const row of rows.rows) {
    await tx.query('DELETE FROM quiz_trace_attempts WHERE id=$1', [row.id]);
    await tx.query('DELETE FROM runtime_sessions WHERE id=$1 AND learner_key=$2', [row.id, owner]);
  }
  const unused: string[] = [];
  for (const versionId of [...new Set(rows.rows.map((r) => r.version_id))].sort()) {
    const refs = await tx.query('SELECT id FROM quiz_trace_attempts WHERE version_id=$1 LIMIT 1', [
      versionId,
    ]);
    if (!refs.rows.length) {
      unused.push(versionId);
    }
  }
  await releaseRetentionsIn(
    tx,
    unused.map((id) => ({ kind: 'scene-history', id })),
  );
  for (const id of unused)
    await tx.query('DELETE FROM scene_history_versions WHERE id=$1 AND owner_id=$2', [id, owner]);
}
export async function rekeyQuizTraceIn(tx: Queryable, from: string, to: string) {
  const exists = await tx.query<{ present: boolean } & Record<string, unknown>>(
    "SELECT to_regclass('quiz_trace_attempts') IS NOT NULL AS present",
  );
  if (!exists.rows[0]?.present) return 0;
  // UUID operations are owner-scoped; collision means incompatible receipts and aborts the claim.
  let moved = 0;
  for (const table of ['scene_history_versions', 'quiz_trace_attempts', 'quiz_trace_operations']) {
    const updated = await tx.query(
      `UPDATE ${table} SET owner_id=$2 WHERE owner_id=$1 RETURNING id`,
      [from, to],
    );
    if (table === 'quiz_trace_attempts') moved = updated.rows.length;
  }
  return moved;
}
