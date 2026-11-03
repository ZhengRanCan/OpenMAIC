import type { LoopProvider } from './store';
import type { DialogueLoopConfig } from './config';
import { enqueueClosedDialogueIn } from './enqueue';
import { fenceOwnerWrite } from '@/lib/persistence/owner-merges';
/** Repair only registered post-activation Sessions. Never enumerate historic chats as new work. */
export async function discoverClosedDialogues(provider: LoopProvider, config: DialogueLoopConfig) {
  const candidates = await provider.withTransaction((tx) =>
    tx.query(
      `SELECT owner_id,stage_id,chat_session_id FROM dialogue_loop_sessions WHERE is_new AND NOT revoked ORDER BY last_checked_at,owner_id,stage_id,chat_session_id LIMIT 50`,
    ),
  );
  let count = 0;
  // Session enumeration is bounded per transaction; no persistent cursor can
  // permanently hide new content in a Session which was processed earlier.
  for (let offset = 0; offset < candidates.rows.length; offset += 50) {
    for (const row of candidates.rows.slice(offset, offset + 50)) {
      const j = await provider.withTransaction(async (tx) => {
        const job = await enqueueClosedDialogueIn(
          tx,
          row.owner_id as string,
          { stageId: row.stage_id as string, chatSessionId: row.chat_session_id as string },
          config,
        );
        await tx.query(
          'UPDATE dialogue_loop_sessions SET last_checked_at=clock_timestamp() WHERE owner_id=$1 AND stage_id=$2 AND chat_session_id=$3',
          [row.owner_id, row.stage_id, row.chat_session_id],
        );
        return job;
      });
      if (j) count++;
    }
  }
  const waiting = await provider.withTransaction((tx) =>
    tx.query(
      "SELECT id,owner_id FROM dialogue_loop_jobs WHERE (state='waiting' AND data->>'reason' IN ('SOURCE_DELIVERY_PENDING','MEMORY_PENDING_SOURCES')) OR (state='unknown' AND data->>'reason'='SOURCE_DELIVERY_PENDING') ORDER BY created_at LIMIT 50",
    ),
  );
  for (const row of waiting.rows)
    await provider.withTransaction(async (tx) => {
      await fenceOwnerWrite(tx, row.owner_id as string);
      await tx.query(
        `UPDATE dialogue_loop_jobs SET state='queued',data=data || '{"state":"queued","token":null}'::jsonb WHERE id=$1 AND ((state='waiting' AND data->>'reason' IN ('SOURCE_DELIVERY_PENDING','MEMORY_PENDING_SOURCES')) OR (state='unknown' AND data->>'reason'='SOURCE_DELIVERY_PENDING'))`,
        [row.id],
      );
    });
  return count;
}
