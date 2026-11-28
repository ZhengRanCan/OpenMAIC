import { DEFAULT_BUDGETS, MemoryError, SECTIONS, sourceKey } from './contracts';
import {
  CLASSROOM_MEMORY_SYSTEM,
  type ClassroomMemorySource,
  type ProfileMemorySnapshot,
} from './profile-memory-snapshot';
import { omitUnknownHelpFromExperience } from './profile-memory-content';
import { buildMemoryPrompt } from './prompt';
import { validateTransition } from './transition';
import { sourcePreview } from './source-preview';
import { parseModelJSON } from './model-json';

/** Shared by the production queue and the file-based evaluation adapter. */
export function prepareClassroomMemory(
  snapshot: ProfileMemorySnapshot,
  increments: ClassroomMemorySource[],
  oldSources: ClassroomMemorySource[],
  inputReserveBytes = 0,
) {
  if (!Number.isInteger(inputReserveBytes) || inputReserveBytes < 0 || inputReserveBytes > 8192)
    throw new MemoryError('INVALID_INPUT_RESERVE');
  const budgets = {
    ...DEFAULT_BUDGETS,
    inputBytes: DEFAULT_BUDGETS.inputBytes - inputReserveBytes,
  };
  const batch = increments.slice(0, DEFAULT_BUDGETS.batchSize);
  let available = oldSources.map((s) => ({ ...s, text: sourcePreview(s.text) }));
  while (batch.length) {
    try {
      return {
        ...buildMemoryPrompt(snapshot, batch, budgets, available, CLASSROOM_MEMORY_SYSTEM, true),
        snapshot,
        budgets,
        batch,
      };
    } catch (error) {
      if (!(error instanceof MemoryError) || error.code !== 'REQUEST_CAPACITY_EXCEEDED')
        throw error;
      if (available.some(({ text }) => text))
        available = available.map((s) => ({ ...s, text: '' }));
      else if (batch.length === 1) throw error;
      else batch.pop();
    }
  }
  throw new MemoryError('EMPTY_CLASSROOM_BATCH');
}

export function applyClassroomMemory(
  prepared: ReturnType<typeof prepareClassroomMemory>,
  reply: string,
) {
  if (Buffer.byteLength(reply, 'utf8') > 64_000) throw new Error('PROFILE_MEMORY_REPLY_LIMIT');
  const transition = validateTransition(prepared, parseModelJSON(reply));
  for (const decision of transition.decisions.filter((d) => d.action === 'already_represented')) {
    const current = prepared.aliases[decision.source];
    if (current.kind !== 'quiz_evidence') continue;
    const parse = (text: string): Record<string, unknown> => {
      try {
        const v = JSON.parse(text);
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
      } catch {
        return {};
      }
    };
    const incoming = parse(current.text);
    if (incoming.review !== 'correct' && incoming.review !== 'incorrect') continue;
    for (const id of decision.pieceIds) {
      const piece = transition.snapshot.pieces.find((p) => p.id === id)!;
      const records = piece.supports
        .map((s) =>
          parse(
            Object.values(prepared.aliases).find((a) => sourceKey(a) === sourceKey(s))?.text ?? '',
          ),
        )
        .filter((old) =>
          incoming.questionId
            ? old.questionId === incoming.questionId
            : typeof incoming.question === 'string' && old.question === incoming.question,
        );
      if (
        records.some(
          (s) =>
            (s.review === 'correct' || s.review === 'incorrect') && s.review !== incoming.review,
        ) &&
        !records.some((s) => s.review === incoming.review)
      )
        throw new MemoryError('PROFILE_MEMORY_CHANGED_REVIEW_IGNORED');
    }
  }
  const supports = transition.snapshot.pieces.flatMap((piece) => piece.supports.map(sourceKey));
  if (new Set(supports).size > 64 || supports.length > 96)
    throw new Error('PROFILE_MEMORY_SUPPORT_CAPACITY');
  for (const piece of transition.snapshot.pieces) {
    const hasQuiz = piece.supports.some(({ kind }) => kind === 'quiz_evidence');
    const hasQa = piece.supports.some(({ refs }) => refs[0] === 'qa');
    if (
      SECTIONS.some(
        (section) =>
          transition.snapshot.sections[section].includes(piece.id) &&
          ((hasQuiz && section !== 'learning_experiences') ||
            (hasQa && section !== 'goals' && section !== 'teaching_requirements')),
      )
    ) {
      throw new Error('PROFILE_MEMORY_SOURCE_SECTION');
    }
    piece.text = omitUnknownHelpFromExperience(piece.text);
    if (!piece.text) throw new Error('PROFILE_MEMORY_EMPTY_PIECE');
    piece.supports = piece.supports.map((support) => ({ ...support, text: '' }));
  }
  return transition;
}
