import { digest } from '@/lib/learner-memory/contracts';
import {
  PreclassLearnerContextError,
  type SimulatedLearnerId,
} from '@/lib/learner-context/contracts';
import type {
  FrozenQuizLearnerContext,
  QuizMemoryTask,
} from '@/lib/learner-context/quiz-contracts';
import { buildQuizSelectionPrompt, projectQuizMemoryTask } from '@/lib/learner-context/quiz-prompt';
import type { MemorySelectionPrompt } from '@/lib/learner-context/selection-contracts';
import { assertMemorySelectionCurrent, selectLearnerMemory } from './learner-memory-selection';
import { readSimulatedLearnerMemory, type LearnerMemoryReader } from './simulated-learner-memory';

export { renderQuizLearnerContext } from '@/lib/learner-context/quiz-render';
export type {
  FrozenQuizLearnerContext,
  QuizMemoryTask,
} from '@/lib/learner-context/quiz-contracts';

/** Canonical ordering survives PostgreSQL JSONB serialization of the confirmed outline. */
export function quizTaskDigest(task: QuizMemoryTask): string {
  return digest(projectQuizMemoryTask(task));
}

export async function buildQuizLearnerContext(
  input: { student: SimulatedLearnerId; sceneIndex: number; task: QuizMemoryTask },
  deps: { read?: LearnerMemoryReader; select: (prompt: MemorySelectionPrompt) => Promise<string> },
): Promise<FrozenQuizLearnerContext> {
  if (!['A', 'B', 'C'].includes(input.student))
    throw new PreclassLearnerContextError('UNKNOWN_SIMULATED_STUDENT');
  if (
    input.task.outline.type !== 'quiz' ||
    !Number.isInteger(input.sceneIndex) ||
    input.sceneIndex < 0
  )
    throw new PreclassLearnerContextError('LEARNER_CONTEXT_TASK_INVALID');
  // Freeze the task before awaiting I/O, matching the task whose digest is saved.
  const task = structuredClone(projectQuizMemoryTask(input.task));
  const view = await (deps.read ?? readSimulatedLearnerMemory)(input.student);
  const selection = await selectLearnerMemory(view, {
    buildPrompt: (candidates) => buildQuizSelectionPrompt({ task, candidates }),
    select: deps.select,
  });
  return {
    schemaVersion: 'quiz-learner-context.v1',
    promptVersion: 'quiz-memory-selection.v1',
    student: input.student,
    sceneIndex: input.sceneIndex,
    outlineId: task.outline.id,
    taskDigest: quizTaskDigest(task),
    ...selection,
  };
}

export async function assertQuizContextCurrent(
  context: FrozenQuizLearnerContext,
  deps: { read?: LearnerMemoryReader } = {},
): Promise<void> {
  if (!['A', 'B', 'C'].includes(context.student))
    throw new PreclassLearnerContextError('UNKNOWN_SIMULATED_STUDENT');
  const view = await (deps.read ?? readSimulatedLearnerMemory)(context.student);
  assertMemorySelectionCurrent(view, context.selected);
}
