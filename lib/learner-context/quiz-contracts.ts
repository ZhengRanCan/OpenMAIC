import type { SceneOutline } from '@/lib/types/generation';
import type { SimulatedLearnerId } from './contracts';
import type { SelectedMemoryPiece } from './selection-contracts';

/** The current course request and this confirmed quiz, never the preclass selection. */
export interface QuizMemoryTask {
  requirement: string;
  courseTitle?: string;
  outline: SceneOutline;
}

export interface FrozenQuizLearnerContext {
  schemaVersion: 'quiz-learner-context.v1';
  promptVersion: 'quiz-memory-selection.v1';
  student: SimulatedLearnerId;
  sceneIndex: number;
  outlineId: string;
  taskDigest: string;
  memoryRevision: number;
  status: 'empty' | 'no_relevant' | 'ready';
  selected: SelectedMemoryPiece[];
}
