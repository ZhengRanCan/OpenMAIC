import { createHash } from 'node:crypto';
import {
  PreclassLearnerContextError,
  type FrozenLearnerContext,
  type PreclassSelectionPrompt,
  type SimulatedLearnerId,
} from '@/lib/learner-context/contracts';
import { buildPreclassSelectionPrompt } from '@/lib/learner-context/prompt';
import {
  assertMemorySelectionCurrent,
  selectLearnerMemory,
} from '@/lib/server/learner-memory-selection';
import {
  readSimulatedLearnerMemory,
  type LearnerMemoryRead,
  type LearnerMemoryReader,
} from '@/lib/server/simulated-learner-memory';

export { renderPreclassLearnerContext } from '@/lib/learner-context/render';
export type PreclassMemoryRead = LearnerMemoryRead;
export type PreclassMemoryReader = LearnerMemoryReader;

const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function buildPreclassLearnerContext(
  input: {
    student: SimulatedLearnerId;
    task: string;
    content: { pdfText?: string; researchContext?: string };
  },
  deps: {
    read?: PreclassMemoryReader;
    select: (prompt: PreclassSelectionPrompt) => Promise<string>;
  },
): Promise<FrozenLearnerContext> {
  if (!['A', 'B', 'C'].includes(input.student))
    throw new PreclassLearnerContextError('UNKNOWN_SIMULATED_STUDENT');
  const view = await (deps.read ?? readSimulatedLearnerMemory)(input.student);
  const base = {
    schemaVersion: 'learner-context.v1' as const,
    promptVersion: 'learner-context-selection.v1' as const,
    student: input.student,
    memoryRevision: view.usable.revision,
    taskDigest: fingerprint(input.task),
    contentDigest: fingerprint({
      pdfText: input.content.pdfText ?? '',
      researchContext: input.content.researchContext ?? '',
    }),
  };
  const result = await selectLearnerMemory(view, {
    buildPrompt: (candidates) => buildPreclassSelectionPrompt({ ...input, candidates }),
    select: deps.select,
  });
  return { ...base, status: result.status, selected: result.selected };
}

/** Revision changes alone do not reselect; only validity of frozen dependencies matters. */
export async function assertPreclassContextCurrent(
  context: FrozenLearnerContext,
  deps: { read?: PreclassMemoryReader } = {},
): Promise<void> {
  const view = await (deps.read ?? readSimulatedLearnerMemory)(context.student);
  assertMemorySelectionCurrent(view, context.selected);
}
