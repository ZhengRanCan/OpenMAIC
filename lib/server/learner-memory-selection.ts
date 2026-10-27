import { z } from 'zod';
import type { MemoryPiece } from '@/lib/learner-memory/contracts';
import {
  LEARNER_CONTEXT_MAX_REPLY_BYTES,
  PreclassLearnerContextError,
} from '@/lib/learner-context/contracts';
import type {
  MemorySelectionPrompt,
  MemorySelectionResult,
  SelectedMemoryPiece,
} from '@/lib/learner-context/selection-contracts';
import type { LearnerMemoryRead } from '@/lib/server/simulated-learner-memory';

function requireUsable(view: LearnerMemoryRead) {
  if (view.maintenancePending || view.usable.restricted.length)
    throw new PreclassLearnerContextError('LEARNER_MEMORY_RECHECK_REQUIRED');
}

function requireValidSupports(selected: Pick<MemoryPiece, 'supports'>[], view: LearnerMemoryRead) {
  const valid = new Set(
    view.coverage
      .filter((source) => source.valid)
      .map((source) => `${source.source_id}:${source.version}`),
  );
  if (
    selected.some(
      (piece) =>
        !piece.supports.length ||
        piece.supports.some((source) => !valid.has(`${source.id}:${source.version}`)),
    )
  )
    throw new PreclassLearnerContextError('LEARNER_MEMORY_RECHECK_REQUIRED');
}

const selectionSchema = z.strictObject({
  selected: z
    .array(
      z.strictObject({
        pieceId: z.string().min(1).max(160),
        reason: z.string().trim().min(1).max(1000),
      }),
    )
    .max(64),
});

function parseSelection(reply: string, candidates: MemoryPiece[]) {
  if (Buffer.byteLength(reply, 'utf8') > LEARNER_CONTEXT_MAX_REPLY_BYTES)
    throw new PreclassLearnerContextError('LEARNER_CONTEXT_SELECTION_INVALID');
  let parsed: z.infer<typeof selectionSchema>;
  try {
    parsed = selectionSchema.parse(JSON.parse(reply));
  } catch {
    throw new PreclassLearnerContextError('LEARNER_CONTEXT_SELECTION_INVALID');
  }
  const byId = new Map(candidates.map((piece) => [piece.id, piece]));
  const seen = new Set<string>();
  return parsed.selected.map(({ pieceId, reason }) => {
    const piece = byId.get(pieceId);
    if (!piece || seen.has(pieceId))
      throw new PreclassLearnerContextError('LEARNER_CONTEXT_SELECTION_INVALID');
    seen.add(pieceId);
    return {
      pieceId,
      reason,
      text: piece.text,
      formation: piece.formation,
      conditions: structuredClone(piece.conditions),
      supports: structuredClone(piece.supports),
    };
  });
}

/** Validate the caller's fresh view against exact frozen source dependencies. */
export function assertMemorySelectionCurrent(
  view: LearnerMemoryRead,
  selected: Pick<SelectedMemoryPiece, 'supports'>[],
): void {
  requireUsable(view);
  requireValidSupports(selected, view);
}

/** Select for a caller-defined task, using only the formal trusted section projection. */
export async function selectLearnerMemory(
  view: LearnerMemoryRead,
  deps: {
    buildPrompt: (candidates: MemoryPiece[]) => MemorySelectionPrompt;
    select: (prompt: MemorySelectionPrompt) => Promise<string>;
  },
): Promise<MemorySelectionResult> {
  requireUsable(view);
  const candidates = [
    ...new Map(
      Object.values(view.sections)
        .flat()
        .map((piece) => [piece.id, piece]),
    ).values(),
  ];
  requireValidSupports(candidates, view);
  const memoryRevision = view.usable.revision;
  if (!candidates.length) return { memoryRevision, status: 'empty', selected: [] };
  const prompt = deps.buildPrompt(candidates);
  const selected = parseSelection(await deps.select(prompt), candidates);
  return { memoryRevision, status: selected.length ? 'ready' : 'no_relevant', selected };
}
