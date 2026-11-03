import type { Queryable } from '@openmaic/storage/document/pg';
import type { ServerPersistenceProvider } from './server-provider';
import { readDialogueSourceIn } from './dialogue-trace-read';
import { DialogueEvidenceError, type DialogueEvidenceRun } from '@/lib/dialogue/evidence-contracts';

export async function dialogueEvidenceRunIn(
  tx: Queryable,
  owner: string,
  id: string,
  lock = false,
): Promise<DialogueEvidenceRun> {
  const rows = await tx.query(
    'SELECT data FROM dialogue_evidence_runs WHERE id=$1 AND owner_id=$2' +
      (lock ? ' FOR UPDATE' : ''),
    [id, owner],
  );
  if (!rows.rows.length) throw new DialogueEvidenceError('NOT_FOUND', 404);
  // owner may change on a claim; the immutable snapshot retains its original provenance.
  return { ...(rows.rows[0].data as DialogueEvidenceRun), ownerId: owner };
}
export async function dialogueSourceStatusIn(
  tx: Queryable,
  owner: string,
  run: DialogueEvidenceRun,
) {
  return readDialogueSourceIn(tx, owner, {
    stageId: run.stageId,
    chatSessionId: run.chatSessionId,
  });
}
export function redactDialogueRun(run: DialogueEvidenceRun, reason: string): DialogueEvidenceRun {
  return {
    ...run,
    state: 'revoked',
    reason,
    snapshot: null,
    context: null,
    system: '',
    reply: null,
    facts: [],
    binding: null,
    token: null,
  };
}
export async function readDialogueEvidenceRun(
  provider: Pick<ServerPersistenceProvider, 'withTransaction'>,
  owner: string,
  id: string,
): Promise<DialogueEvidenceRun> {
  return provider.withTransaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const run = await dialogueEvidenceRunIn(tx, owner, id);
    const live = await dialogueSourceStatusIn(tx, owner, run);
    if (live.status === 'deleted' || live.status === 'missing')
      return redactDialogueRun(run, 'source_' + live.status);
    if (live.status !== 'available')
      return { ...redactDialogueRun(run, 'source_' + live.status), state: 'blocked' };
    if (run.state === 'revoked') return redactDialogueRun(run, run.reason ?? 'revoked');
    if (run.state === 'calling' && Date.parse(run.leaseExpiresAt ?? '') <= Date.now())
      return { ...run, state: 'unknown', reason: 'EXECUTION_UNKNOWN', token: null };
    return { ...run, token: null };
  });
}
