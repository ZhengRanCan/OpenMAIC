import type { Queryable } from '@openmaic/storage/document/pg';
import type { ServerPersistenceProvider } from '@/lib/persistence/server-provider';
import {
  dialogueEvidenceRunIn,
  dialogueSourceStatusIn,
} from '@/lib/persistence/dialogue-evidence-read';
import {
  matchDialogueBinding,
  verifyDialogueBindingIn,
  loadDialogueEvidenceSettings,
} from './dialogue-evidence-provenance';
import type { DialogueEvidenceSettings } from '@/lib/dialogue/evidence-contracts';
import { DialogueEvidenceError } from '@/lib/dialogue/evidence-contracts';
import { digest, invariant } from '@/lib/learner-memory/contracts';
import { simulatedScope } from '@/lib/learner-memory/simulated-seeds';
import type {
  DialogueSourceAuthority,
  DialogueMemorySourceRecord,
} from '@/lib/learner-memory/dialogue-contracts';
import { DialogueMemoryError } from '@/lib/learner-memory/dialogue-contracts';
import { adaptDialogueMemorySources } from '@/lib/learner-memory/dialogue-source';

/** Read-only binding configuration; does not enable the extraction route or invoke it. */
export const loadDialogueMemorySettings = () =>
  loadDialogueEvidenceSettings({ ...process.env, OPENMAIC_DIALOGUE_EVIDENCE_ENABLED: 'true' });
export async function verifiedDialogueEvidenceIn(
  tx: Queryable,
  owner: string,
  id: string,
  settings: DialogueEvidenceSettings,
) {
  let run;
  try {
    run = await dialogueEvidenceRunIn(tx, owner, id);
  } catch (e) {
    if (e instanceof DialogueEvidenceError && e.code === 'NOT_FOUND')
      throw new DialogueMemoryError('NOT_FOUND', 404);
    throw e;
  }
  if (!['completed', 'empty'].includes(run.state) || !run.snapshot || !run.binding)
    throw new DialogueMemoryError('DIALOGUE_NOT_AVAILABLE');
  const live = await dialogueSourceStatusIn(tx, owner, run);
  if (live.status !== 'available')
    throw new DialogueMemoryError('SOURCE_' + live.status.toUpperCase());
  const binding = matchDialogueBinding(run.snapshot, settings);
  if (
    !binding ||
    run.ownerId !== run.snapshot.ownerId ||
    digest(binding) !== digest(run.binding) ||
    !(await verifyDialogueBindingIn(tx, run.snapshot, binding))
  )
    throw new DialogueMemoryError('NOT_ELIGIBLE');
  return run;
}
/** Unknown authority failures propagate. Only confirmed revocation invalidates a support. */
export function createDialogueMemoryAuthority(
  provider?: Pick<ServerPersistenceProvider, 'withTransaction'>,
  settings: () => Promise<DialogueEvidenceSettings> = loadDialogueMemorySettings,
): DialogueSourceAuthority {
  return async (scope, source, memoryTx) => {
    const app =
      provider ??
      (await (
        await import('@/lib/persistence/server-provider')
      ).getServerPersistenceProvider(process.env.DATABASE_URL ?? ''));
    const config = await settings();
    return app.withTransaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const rows = await tx.query('SELECT data,revoked FROM dialogue_memory_sources WHERE id=$1', [
        source.id,
      ]);
      if (!rows.rows.length || rows.rows[0].revoked) return 'dialogue_source_revoked';
      const record = rows.rows[0].data as DialogueMemorySourceRecord;
      invariant(
        digest(scope) === digest(simulatedScope(record.student)),
        'SIMULATED_SOURCE_STUDENT_MISMATCH',
      );
      const env = await memoryTx.query(
        'SELECT id FROM f68_memory_environment WHERE singleton=true',
      );
      invariant(
        env.rows.length === 1 &&
          env.rows[0].id === record.environmentId &&
          config.memoryEnvironmentId === record.environmentId,
        'MEMORY_ENVIRONMENT_MISMATCH',
      );
      if (digest(source) !== digest(record.source)) return 'dialogue_source_version_mismatch';
      try {
        const evidence = await verifiedDialogueEvidenceIn(
          tx,
          record.ownerId,
          record.evidenceRunId,
          config,
        );
        const expected = adaptDialogueMemorySources(evidence).find(
          (item) => item.source.id === source.id,
        );
        if (!expected || digest(expected.source) !== digest(record.source))
          return 'dialogue_source_version_mismatch';
      } catch (e) {
        if (
          e instanceof DialogueMemoryError &&
          [
            'NOT_FOUND',
            'DIALOGUE_NOT_AVAILABLE',
            'SOURCE_MISSING',
            'SOURCE_DELETED',
            'NOT_ELIGIBLE',
          ].includes(e.code)
        )
          return 'dialogue_source_unavailable';
        throw e;
      }
      return null;
    });
  };
}
