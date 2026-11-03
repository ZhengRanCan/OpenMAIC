import type { Queryable } from '@openmaic/storage/document/pg';
import type { ServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { fenceOwnerWrite } from '@/lib/persistence/owner-merges';
import { digest } from '@/lib/learner-memory/contracts';
import { DialogueLoopError } from '@/lib/dialogue/learning-loop-contracts';
import type { DialogueSourceWindow } from '@/lib/dialogue/trace-types';
import type { DialogueBinding } from '@/lib/dialogue/evidence-contracts';
import { verifyDialogueBindingIn } from '../dialogue-evidence-provenance';
import type { DialogueLoopConfig } from './config';

export function chatIdFromRuntime(id: string, stage: string, owner: string): string | null {
  const prefix = `chat:${encodeURIComponent(stage)}:${encodeURIComponent(owner)}:`;
  if (!id.startsWith(prefix)) return null;
  const encoded = id.slice(prefix.length).split(':generation:')[0];
  try {
    const chat = decodeURIComponent(encoded);
    return chat && encodeURIComponent(chat) === encoded ? chat : null;
  } catch {
    return null;
  }
}
export async function activateDialogueLoop(
  provider: Pick<ServerPersistenceProvider, 'withTransaction'>,
  config: DialogueLoopConfig,
) {
  return provider.withTransaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('dialogue-loop-activation'))");
    const current = await tx.query(
      'SELECT config_digest FROM dialogue_loop_activation WHERE singleton=true',
    );
    if (current.rows.length) {
      if (current.rows[0].config_digest !== digest(config))
        throw new DialogueLoopError('CONFIG_CHANGED');
      return;
    }
    const old = await tx.query(
      "SELECT id,stage_id,learner_key FROM runtime_sessions WHERE kind='chat'",
    );
    for (const row of old.rows) {
      const id = chatIdFromRuntime(
        row.id as string,
        row.stage_id as string,
        row.learner_key as string,
      );
      if (id)
        await tx.query(
          "INSERT INTO dialogue_loop_sessions(owner_id,stage_id,chat_session_id,is_new,reason) VALUES($1,$2,$3,false,'historical_baseline') ON CONFLICT DO NOTHING",
          [row.learner_key, row.stage_id, id],
        );
    }
    await tx.query(
      'INSERT INTO dialogue_loop_activation(singleton,config_digest) VALUES(true,$1)',
      [digest(config)],
    );
  });
}
export async function assertDialogueActivationIn(tx: Queryable, config: DialogueLoopConfig) {
  await tx.query("SELECT pg_advisory_xact_lock_shared(hashtext('dialogue-loop-activation'))");
  const row = await tx.query(
    'SELECT config_digest FROM dialogue_loop_activation WHERE singleton=true',
  );
  if (row.rows[0]?.config_digest !== digest(config))
    throw new DialogueLoopError('ACTIVATION_REQUIRED');
}
/** Called only when the runtime row did not exist before this server create. */
export async function noteDialogueSessionCreatedIn(
  tx: Queryable,
  owner: string,
  stageId: string,
  chatSessionId: string,
  config: DialogueLoopConfig,
) {
  await fenceOwnerWrite(tx, owner);
  await assertDialogueActivationIn(tx, config);
  await tx.query(
    'INSERT INTO dialogue_loop_sessions(owner_id,stage_id,chat_session_id,is_new) VALUES($1,$2,$3,true) ON CONFLICT DO NOTHING',
    [owner, stageId, chatSessionId],
  );
}
export async function registerDialogueSessionIn(
  tx: Queryable,
  source: DialogueSourceWindow,
  runId: string | undefined,
  config: DialogueLoopConfig,
): Promise<DialogueBinding | null> {
  const keys = [source.ownerId, source.stageId, source.chatSessionId];
  const r = await tx.query(
    'SELECT * FROM dialogue_loop_sessions WHERE owner_id=$1 AND stage_id=$2 AND chat_session_id=$3 FOR UPDATE',
    keys,
  );
  const row = r.rows[0];
  if (!row?.is_new || row.revoked || !runId) return null;
  if (row.run_id && row.run_id !== runId) return null;
  const g = await tx.query(
    "SELECT input->>'simulatedLearner' AS student FROM generation_runs WHERE id=$1 AND owner_id=$2 AND stage_id=$3",
    [runId, source.ownerId, source.stageId],
  );
  if (!['A', 'B', 'C'].includes(g.rows[0]?.student as string) || !source.initialContext?.sceneId)
    return null;
  const binding: DialogueBinding = {
    ownerId: source.ownerId,
    stageId: source.stageId,
    chatSessionId: source.chatSessionId,
    sourceDigest: source.contentDigest,
    generationRunId: runId,
    student: g.rows[0].student as 'A' | 'B' | 'C',
    ...config,
  };
  if (!(await verifyDialogueBindingIn(tx, source, binding))) return null;
  if (row.binding) {
    const previous = row.binding as DialogueBinding;
    if (digest({ ...previous, sourceDigest: '' }) !== digest({ ...binding, sourceDigest: '' }))
      return null;
  }
  await tx.query(
    'UPDATE dialogue_loop_sessions SET run_id=$4,binding=$5::jsonb,reason=NULL WHERE owner_id=$1 AND stage_id=$2 AND chat_session_id=$3',
    [...keys, runId, JSON.stringify(binding)],
  );
  return binding;
}
