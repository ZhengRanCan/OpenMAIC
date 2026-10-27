import type { Formation, MemorySource } from '@/lib/learner-memory/contracts';

export type { LearnerMemoryRead, LearnerMemoryReader } from '@/lib/server/simulated-learner-memory';

/** Caller-defined task prompt; the selection service does not define a teaching task. */
export interface MemorySelectionPrompt {
  system: string;
  user: string;
  inputBytes: number;
}

export interface SelectedMemoryPiece {
  pieceId: string;
  reason: string;
  text: string;
  formation: Formation;
  conditions: string[];
  supports: MemorySource[];
}

export interface MemorySelectionResult {
  memoryRevision: number;
  status: 'empty' | 'no_relevant' | 'ready';
  selected: SelectedMemoryPiece[];
}
