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

/** Shared by the production queue and the file-based evaluation adapter. */
export function prepareClassroomMemory(
  snapshot: ProfileMemorySnapshot,
  increments: ClassroomMemorySource[],
  oldSources: ClassroomMemorySource[],
) {
  const batch = increments.slice(0, DEFAULT_BUDGETS.batchSize);
  let available = oldSources.map((s) => ({ ...s, text: sourcePreview(s.text) }));
  while (batch.length) {
    try {
      return {
        ...buildMemoryPrompt(
          snapshot,
          batch,
          DEFAULT_BUDGETS,
          available,
          CLASSROOM_MEMORY_SYSTEM,
          true,
        ),
        snapshot,
        budgets: DEFAULT_BUDGETS,
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
  const transition = validateTransition(prepared, JSON.parse(reply));
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
