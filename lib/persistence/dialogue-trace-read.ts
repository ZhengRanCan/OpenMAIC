import type { ServerPersistenceProvider } from './server-provider';
import { projectDialogueSource } from '@/lib/dialogue/trace-projection';
import { DialogueTraceReadError, type DialogueSourceReadResult } from '@/lib/dialogue/trace-types';

/** Requires an already initialized provider; initialization is outside this read. */
export async function readDialogueSource(
  provider: Pick<ServerPersistenceProvider, 'withTransaction'>,
  owner: string,
  locator: { stageId: string; chatSessionId: string },
): Promise<DialogueSourceReadResult> {
  if (!owner || !locator.stageId || !locator.chatSessionId)
    throw new TypeError('Missing dialogue source locator');
  try {
    return await provider.withTransaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const stage = await tx.query(
        'SELECT stage_id, deleted_at FROM stage_meta WHERE stage_id=$1 AND owner_id=$2',
        [locator.stageId, owner],
      );
      if (!stage.rows.length) return { status: 'missing' };
      if (stage.rows[0].deleted_at != null) return { status: 'deleted' };
      const sessions = await tx.query(
        'SELECT id,stage_id,learner_key,kind,status,created_at,updated_at,data FROM runtime_sessions WHERE stage_id=$1 AND learner_key=$2',
        [locator.stageId, owner],
      );
      const records = await tx.query(
        'SELECT r.id,r.session_id,r.seq,r.scene_id,r.created_at,r.data FROM runtime_records r JOIN runtime_sessions s ON s.id=r.session_id WHERE s.stage_id=$1 AND s.learner_key=$2 ORDER BY r.session_id,r.seq',
        [locator.stageId, owner],
      );
      return projectDialogueSource(
        { sessions: sessions.rows, records: records.rows },
        { ownerId: owner, ...locator },
      );
    });
  } catch (error) {
    throw new DialogueTraceReadError(error);
  }
}
