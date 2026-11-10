export type QuizFeedbackLocator = {
  attemptId: string;
  versionId: string;
  submissionId: string;
  reviewId: string;
};

export type QuizFeedback = {
  summary: string;
  practiceDirection: string | null;
};

export type QuizFeedbackStatus =
  | { status: 'disabled' | 'idle' | 'pending' | 'unknown' | 'currentOnly' }
  | { status: 'failed'; retryToken: string }
  | { status: 'ready'; feedback: QuizFeedback; partial: boolean };
