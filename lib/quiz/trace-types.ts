import type { Scene, QuizQuestion } from '@/lib/types/stage';
import type { QuizAnswers } from './persistence';
import type { QuestionResult } from './grading';

export type EvaluationState = 'normal' | 'failed' | 'fallback';
export interface TraceQuestionResult extends QuestionResult {
  evaluation: {
    state: EvaluationState;
    method: 'exact-key' | 'model';
    reason?: string;
    configuredModel?: string;
    rule?: string;
  };
}
export interface QuizScoreSummary {
  status: 'complete' | 'partial' | 'unavailable';
  usableEarned: number;
  usablePossible: number;
  quizPossible: number;
  unusableQuestionCount: number;
}
export interface SceneHistoryVersion {
  id: string;
  scene: Scene;
  planning?: Record<string, unknown>;
  capturedAt: string;
  resources: { sourceId: string; assetId: string }[];
  resourceCoverage?: {
    taskPresentation: 'text-and-math-quiz';
    unavailableBackgroundRefs: string[];
  };
}
export interface PrepareQuizInput {
  operationId: string;
  mode: 'start' | 'retry';
  stageId: string;
  sceneId: string;
  previousAttemptId?: string;
  scene?: Scene;
  planning?: Record<string, unknown>;
}
export interface QuizDraftWrite {
  operationId: string;
  answers: QuizAnswers;
  expectedLastSeq: number;
}
export interface QuizSubmissionInput {
  operationId: string;
  submissionId: string;
  answers: QuizAnswers;
}
export interface QuizReviewInput {
  operationId: string;
  submissionId: string;
  language: string;
}
export interface QuizSubmission {
  id: string;
  attemptId: string;
  versionId: string;
  answers: QuizAnswers;
  recordId: string;
  seq: number;
  savedAt: string;
}
export interface QuizEvaluation {
  results: TraceQuestionResult[];
  summary: QuizScoreSummary;
}
export interface QuizReview extends QuizEvaluation {
  id: string;
  attemptId: string;
  submissionId: string;
  versionId: string;
  ordinal: number;
  savedAt: string;
}
export interface PreparedQuiz {
  attemptId: string;
  stageId: string;
  sceneId: string;
  version: SceneHistoryVersion;
  answers: QuizAnswers;
  lastSeq: number;
  submission?: QuizSubmission;
  review?: QuizReview;
  previousUsableReview?: QuizReview;
  reviews: QuizReview[];
  pendingReview?: { id: string; ordinal: number };
}
export interface QuizReviewReservation {
  id: string;
  attemptId: string;
  submissionId: string;
  versionId: string;
  ordinal: number;
  language: string;
  existing?: QuizReview;
  pending?: boolean;
  questions: QuizQuestion[];
  answers: QuizAnswers;
}
export interface LegacyQuizRead {
  attemptId: string;
  provenance: 'legacy-unverified';
  records: unknown[];
  missing: ['historical-question-version'];
}
export interface QuizHistoryRead {
  stageId: string;
  attempts: PreparedQuiz[];
  legacy: LegacyQuizRead[];
  completeness: 'complete' | 'partial' | 'not-confirmed';
  checkedAttemptIds: string[];
  failures: { attemptId: string; code: string }[];
}
