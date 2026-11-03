import type { DialogueEvidenceStore } from '@/lib/persistence/dialogue-evidence-store';
import type {
  DialogueEvidenceRun,
  DialogueEvidenceSettings,
  DialogueModelIdentity,
  DialogueCapturedReply,
} from '@/lib/dialogue/evidence-contracts';
import { DialogueEvidenceError } from '@/lib/dialogue/evidence-contracts';
import { DialogueMemoryError } from '@/lib/learner-memory/dialogue-contracts';
import {
  DialogueLoopError,
  type DialogueLoopJob,
  type LoopState,
} from '@/lib/dialogue/learning-loop-contracts';
import { digest, MemoryError, type PreparedMemoryRun } from '@/lib/learner-memory/contracts';
import { adaptDialogueMemorySources } from '@/lib/learner-memory/dialogue-source';
import { extractDialogueEvidence } from '../dialogue-evidence';
import type { DialogueMemoryService } from '../dialogue-memory';
import type { MemoryInvoker } from '../learner-memory';
import type { DialogueLoopConfig } from './config';
import type { DialogueLoopStore } from './store';
export interface DialogueLoopDeps {
  jobs: DialogueLoopStore;
  evidence: DialogueEvidenceStore;
  memory: DialogueMemoryService;
  config: DialogueLoopConfig;
  settings(): Promise<DialogueEvidenceSettings>;
  evidenceModel: DialogueModelIdentity;
  memoryModel: DialogueModelIdentity;
  readEvidence(owner: string, id: string): Promise<DialogueEvidenceRun>;
  invokeEvidence(run: DialogueEvidenceRun): Promise<DialogueCapturedReply>;
  invokeMemory: MemoryInvoker;
  checkEvidence(run: DialogueEvidenceRun): void;
  checkMemory(run: PreparedMemoryRun): void;
}
export function stageOutcome(state: string): LoopState {
  if (['completed', 'empty'].includes(state)) return 'completed';
  if (state === 'deferred') return 'waiting';
  if (['unknown', 'calling', 'updating'].includes(state)) return 'unknown';
  if (state === 'revoked') return 'revoked';
  if (state === 'blocked') return 'blocked';
  return 'failed';
}
export async function processDialogueJob(job: DialogueLoopJob, d: DialogueLoopDeps): Promise<void> {
  const checkpoint = () => d.jobs.checkpoint(job);
  try {
    if (job.configDigest !== digest(d.config)) throw new DialogueLoopError('CONFIG_CHANGED');
    if (!job.snapshot || !job.binding) throw new DialogueLoopError('NOT_ELIGIBLE');
    const modelDigest = digest({ evidence: d.evidenceModel, memory: d.memoryModel });
    if (job.modelDigest && job.modelDigest !== modelDigest)
      throw new DialogueLoopError('CONFIG_CHANGED');
    job.modelDigest = modelDigest;
    await checkpoint(); // revoked/stale outer leases never start a new phase.
    if (!job.evidenceRunId) {
      const run = await d.evidence.prepareSnapshot(
        job.ownerId,
        { operationId: 'f75:e:' + job.id, stageId: job.stageId, chatSessionId: job.chatSessionId },
        job.snapshot,
        await d.settings(),
        d.evidenceModel,
      );
      job.evidenceRunId = run.id;
      job.evidenceState = run.state;
      await checkpoint();
    }
    const id = job.evidenceRunId;
    let evidence = await d.readEvidence(job.ownerId, id);
    if (evidence.state === 'prepared') d.checkEvidence(evidence);
    evidence = await extractDialogueEvidence(
      job.ownerId,
      id,
      d.evidenceModel,
      d.evidence,
      () => d.readEvidence(job.ownerId, id),
      d.invokeEvidence,
      d.settings,
    );
    job.evidenceState = evidence.state;
    if (evidence.state === 'empty') {
      job.state = 'completed';
      job.memoryState = 'empty';
      await checkpoint();
      return;
    }
    if (evidence.state !== 'completed') {
      job.state = stageOutcome(evidence.state);
      job.reason = evidence.reason;
      await checkpoint();
      return;
    }
    await checkpoint();
    if (job.blockingDeliveryId) {
      const leaf = await d.memory.store.findBlockingDelivery(
        job.ownerId,
        job.binding.student,
        job.binding.memoryEnvironmentId,
        adaptDialogueMemorySources(evidence).map((x) => x.source.id),
      );
      if (leaf !== job.blockingDeliveryId) {
        job.blockingDeliveryId = leaf;
        job.blockingRetryAuthorized = false;
        await checkpoint();
      }
    }
    if (job.blockingDeliveryId) {
      let prior = await d.memory.read(job.ownerId, job.blockingDeliveryId);
      if (job.blockingRetryAuthorized && prior.delivery.state === 'prepared') {
        if (prior.memoryRun) d.checkMemory(prior.memoryRun);
        prior = await d.memory.update(
          job.ownerId,
          job.blockingDeliveryId,
          d.memoryModel,
          d.invokeMemory,
        );
      }
      if (prior.delivery.state !== 'completed' && prior.delivery.state !== 'empty') {
        job.memoryState = prior.delivery.state;
        job.state = prior.delivery.state === 'unknown' ? 'unknown' : 'waiting';
        job.reason = 'SOURCE_DELIVERY_PENDING';
        await checkpoint();
        return;
      }
      job.blockingDeliveryId = null;
      job.blockingRetryAuthorized = false;
      await checkpoint();
    }
    if (!job.memoryDeliveryId) {
      try {
        const delivery = await d.memory.prepare(
          job.ownerId,
          { operationId: 'f75:m:' + job.id + ':' + id, evidenceRunId: id },
          d.memoryModel,
        );
        job.memoryDeliveryId = delivery.delivery.id;
        job.memoryState = delivery.delivery.state;
        await checkpoint();
      } catch (e) {
        if (
          e instanceof DialogueMemoryError &&
          ['SOURCE_DELIVERY_PENDING', 'MEMORY_PENDING_SOURCES'].includes(e.code)
        ) {
          job.state = 'waiting';
          job.reason = e.code;
          job.memoryState = 'waiting';
          if (e.code === 'SOURCE_DELIVERY_PENDING') {
            job.blockingDeliveryId = await d.memory.store.findBlockingDelivery(
              job.ownerId,
              job.binding.student,
              job.binding.memoryEnvironmentId,
              adaptDialogueMemorySources(evidence).map((x) => x.source.id),
            );
            if (job.blockingDeliveryId) {
              const old = await d.memory.read(job.ownerId, job.blockingDeliveryId);
              job.memoryState = old.delivery.state;
              if (old.delivery.state === 'unknown') job.state = 'unknown';
            }
          }
          await checkpoint();
          return;
        }
        throw e;
      }
    }
    let view = await d.memory.read(job.ownerId, job.memoryDeliveryId);
    if (view.delivery.state === 'prepared') {
      if (view.memoryRun) d.checkMemory(view.memoryRun);
      await checkpoint();
      view = await d.memory.update(
        job.ownerId,
        job.memoryDeliveryId,
        d.memoryModel,
        d.invokeMemory,
      );
    }
    job.memoryState = view.delivery.state;
    job.reason = view.delivery.reason ?? (view.delivery.state === 'deferred' ? 'deferred' : null);
    job.state = stageOutcome(view.delivery.state);
    await checkpoint();
  } catch (e) {
    if (e instanceof DialogueLoopError && e.code === 'JOB_CLAIM_EXPIRED') return;
    const known =
      e instanceof DialogueLoopError ||
      e instanceof DialogueEvidenceError ||
      e instanceof DialogueMemoryError ||
      e instanceof MemoryError;
    job.reason = known ? e.code : 'PROCESSING_UNCERTAIN';
    job.state = known ? 'blocked' : 'unknown';
    try {
      await checkpoint();
    } catch {
      /* A revoked or expired job cannot be revived by its old worker. */
    }
  }
}
