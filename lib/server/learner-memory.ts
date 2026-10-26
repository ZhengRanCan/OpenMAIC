import { LearnerMemoryStore } from '@/lib/persistence/learner-memory-store';
import {
  invariant,
  SECTIONS,
  type MemoryPiece,
  type MemorySection,
  type CapturedMemoryReply,
  type MemoryScope,
  type PreparedMemoryRun,
} from '@/lib/learner-memory/contracts';

export type MemoryInvoker = (run: PreparedMemoryRun) => Promise<CapturedMemoryReply>;

/** Server-side read contract shared by consumers and the simulated environment. */
export async function readMemory(store: LearnerMemoryStore, scope: MemoryScope) {
  const view = await store.read(scope);
  const sections = Object.fromEntries(
    SECTIONS.map((section) => [
      section,
      view.usable.sections[section].map((id) => view.usable.pieces.find((p) => p.id === id)!),
    ]),
  ) as Record<MemorySection, MemoryPiece[]>;
  return { ...view, sections };
}
/** Paid execution is never retried; an already captured reply can be committed again. */
export async function updateMemory(
  store: LearnerMemoryStore,
  scope: MemoryScope,
  operationId: string,
  invoke: MemoryInvoker,
) {
  let run = await store.getRun(scope, operationId);
  if (run.state === 'prepared') {
    const claim = await store.claim(scope, operationId);
    if (!claim) return store.getRun(scope, operationId);
    let reply: CapturedMemoryReply;
    try {
      reply = await invoke(claim);
      invariant(reply.origin === 'model', 'INVALID_INVOCATION_ORIGIN');
    } catch {
      reply = {
        text: '',
        finishReason: 'error',
        usage: null,
        model: 'unavailable',
        origin: 'model',
      };
    }
    // A capture/save failure propagates; it must not start a second paid call.
    run = await store.capture(scope, operationId, reply, claim.claimToken);
  }
  if (run.state === 'captured') return store.commit(scope, operationId);
  return run;
}
