import { digest } from '@/lib/learner-memory/contracts';
import {
  DialogueLoopError,
  projectLoopStatus,
  type LoopRecovery,
} from '@/lib/dialogue/learning-loop-contracts';
import { fenceOwnerWrite } from '@/lib/persistence/owner-merges';
import { readLoopJobIn, saveLoopJobIn } from './store';
import type { DialogueLoopDeps } from './process';
type Targets = {
  evidenceRunId: string | null;
  memoryDeliveryId: string | null;
  blockingDeliveryId: string | null;
};
export async function recoverDialogueJob(
  owner: string,
  id: string,
  request: LoopRecovery,
  d: DialogueLoopDeps,
) {
  const intent = digest({ id, request });
  const receipt = await d.jobs.provider.withTransaction(async (tx) => {
    await fenceOwnerWrite(tx, owner);
    const current = await readLoopJobIn(tx, owner, id, true);
    if (
      current.modelDigest &&
      current.modelDigest !== digest({ evidence: d.evidenceModel, memory: d.memoryModel })
    )
      throw new DialogueLoopError('CONFIG_CHANGED');
    const old = await tx.query(
      'SELECT * FROM dialogue_loop_operations WHERE owner_id=$1 AND operation_id=$2',
      [owner, request.operationId],
    );
    if (old.rows.length) {
      if (old.rows[0].intent !== intent) throw new DialogueLoopError('OPERATION_CONFLICT');
      return old.rows[0] as { targets: Targets; result: unknown };
    }
    if (['revoked', 'completed', 'not_eligible', 'running'].includes(current.state))
      throw new DialogueLoopError('RECOVERY_NOT_ALLOWED');
    const targets: Targets = {
      evidenceRunId: current.evidenceRunId,
      memoryDeliveryId: current.memoryDeliveryId,
      blockingDeliveryId: current.blockingDeliveryId,
    };
    await tx.query(
      'INSERT INTO dialogue_loop_operations(owner_id,operation_id,intent,job_id,targets) VALUES($1,$2,$3,$4,$5::jsonb)',
      [owner, request.operationId, intent, id, JSON.stringify(targets)],
    );
    return { targets, result: null };
  });
  if (receipt.result) return projectLoopStatus(await d.jobs.read(owner, id));
  const target = receipt.targets;
  let evidenceId = target.evidenceRunId,
    deliveryId = target.memoryDeliveryId,
    blockingId = target.blockingDeliveryId;
  let resumeBlockingPrepared = false;
  if (request.action === 'retry_evidence') {
    if (!evidenceId) throw new DialogueLoopError('NO_EVIDENCE_ATTEMPT');
    const old = await d.readEvidence(owner, evidenceId);
    if (old.state === 'unknown' && request.acknowledgeUnknownCost !== true)
      throw new DialogueLoopError('UNKNOWN_COST_CONFIRMATION_REQUIRED');
    const next = await d.evidence.recover(
      owner,
      evidenceId,
      {
        action: 'confirm_paid_retry',
        operationId: 'f75:er:' + request.operationId,
        acknowledgeUnknownCost: true,
      },
      await d.settings(),
    );
    evidenceId = next.id;
    deliveryId = null;
    blockingId = null;
  } else if (request.action === 'retry_memory' || request.action === 'retry_deferred') {
    const memoryId = blockingId ?? deliveryId;
    if (!memoryId) throw new DialogueLoopError('NO_MEMORY_ATTEMPT');
    const old = await d.memory.read(owner, memoryId);
    if (old.delivery.state === 'unknown' && request.acknowledgeUnknownCost !== true)
      throw new DialogueLoopError('UNKNOWN_COST_CONFIRMATION_REQUIRED');
    const next = await d.memory.recover(
      owner,
      memoryId,
      request.action === 'retry_deferred'
        ? { action: 'retry_deferred', operationId: 'f75:mr:' + request.operationId }
        : {
            action: 'confirm_paid_retry',
            operationId: 'f75:mr:' + request.operationId,
            acknowledgeAdditionalCall: true,
            acknowledgeUnknownCost: request.acknowledgeUnknownCost,
          },
    );
    if (blockingId) blockingId = next.delivery.id;
    else deliveryId = next.delivery.id;
  } else {
    if (evidenceId) {
      const e = await d.readEvidence(owner, evidenceId);
      if (e.state === 'captured') await d.evidence.finalize(owner, evidenceId);
      else if (!['prepared', 'completed', 'empty'].includes(e.state))
        throw new DialogueLoopError('EXPLICIT_RETRY_REQUIRED');
    }
    const memoryId = blockingId ?? deliveryId;
    if (memoryId) {
      const m = await d.memory.read(owner, memoryId);
      resumeBlockingPrepared = !!blockingId && m.delivery.state === 'prepared';
      if (
        m.delivery.reply &&
        m.delivery.reply.finishReason !== 'error' &&
        ['unknown', 'updating'].includes(m.delivery.state)
      )
        await d.memory.recover(owner, memoryId, {
          action: 'finalize_saved_reply',
          operationId: 'f75:mf:' + request.operationId,
        });
      else if (!['prepared', 'completed', 'empty'].includes(m.delivery.state))
        throw new DialogueLoopError('EXPLICIT_RETRY_REQUIRED');
    }
  }
  return d.jobs.provider.withTransaction(async (tx) => {
    await fenceOwnerWrite(tx, owner);
    const j = await readLoopJobIn(tx, owner, id, true);
    const applied = await tx.query(
      'SELECT result FROM dialogue_loop_operations WHERE owner_id=$1 AND operation_id=$2',
      [owner, request.operationId],
    );
    if (applied.rows[0]?.result) return projectLoopStatus(j);
    if (j.state === 'revoked') throw new DialogueLoopError('SOURCE_REVOKED');
    if (j.state === 'running') throw new DialogueLoopError('RECOVERY_NOT_ALLOWED');
    j.evidenceRunId = evidenceId;
    j.memoryDeliveryId = deliveryId;
    j.blockingDeliveryId = blockingId;
    j.blockingRetryAuthorized =
      !!blockingId && (request.action !== 'resume_saved' || resumeBlockingPrepared);
    j.state = 'queued';
    j.reason = null;
    j.token = null;
    j.leaseExpiresAt = null;
    await saveLoopJobIn(tx, j);
    const result = projectLoopStatus(j);
    await tx.query(
      'UPDATE dialogue_loop_operations SET result=$3::jsonb WHERE owner_id=$1 AND operation_id=$2',
      [owner, request.operationId, JSON.stringify(result)],
    );
    return result;
  });
}
