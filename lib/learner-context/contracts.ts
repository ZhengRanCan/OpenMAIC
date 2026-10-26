import type { Formation, MemorySource } from '@/lib/learner-memory/contracts';

/** Browser-safe identity; namespace and database credentials are server-owned. */
export type SimulatedLearnerId = 'A' | 'B' | 'C';

export interface FrozenLearnerContext {
  schemaVersion: 'learner-context.v1';
  promptVersion: 'learner-context-selection.v1';
  student: SimulatedLearnerId;
  status: 'empty' | 'no_relevant' | 'ready';
  memoryRevision: number;
  taskDigest: string;
  contentDigest: string;
  selected: {
    pieceId: string;
    reason: string;
    text: string;
    formation: Formation;
    conditions: string[];
    supports: MemorySource[];
  }[];
}

export interface PreclassSelectionPrompt {
  system: string;
  user: string;
  inputBytes: number;
}

export const LEARNER_CONTEXT_MAX_INPUT_BYTES = 48_000;
export const LEARNER_CONTEXT_MAX_REPLY_BYTES = 24_000;

export class PreclassLearnerContextError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PreclassLearnerContextError';
  }
}
