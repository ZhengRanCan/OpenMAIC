import type { CourseTarget } from '@/lib/server/generation/run/types';

import type { MasteryEvidence, MasteryObservation } from './synthesis';

type QuizQuestionEvidence = Extract<
  MasteryEvidence,
  { type: 'quiz_performance' }
>['questions'][number];

export type MasteryCardSource =
  | {
      kind: 'quiz';
      title: string;
      occurredAt: string;
      questions: Omit<QuizQuestionEvidence, 'answerKey'>[];
    }
  | {
      kind: 'dialogue';
      title: string;
      occurredAt: string;
      messages: Extract<MasteryEvidence, { messages: unknown }>['messages'];
    };

export interface MasteryCardObservation extends MasteryObservation {
  conditions: string[];
  source: MasteryCardSource;
}

export interface MasteryCard {
  target: CourseTarget;
  update?: 'pending' | 'failed';
  status: 'empty' | 'untracked' | 'unavailable' | 'ready';
  summary?: string;
  unverified?: string[];
  observations?: MasteryCardObservation[];
}

export interface ClassroomMastery {
  courseObjective?: string;
  canUpdate?: true;
  cards: MasteryCard[];
}
