import type { QuizAnswers } from './persistence';
import type {
  PrepareQuizInput,
  PreparedQuiz,
  QuizDraftWrite,
  QuizSubmissionInput,
  QuizSubmission,
  QuizReviewInput,
  QuizReview,
  QuizHistoryRead,
} from './trace-types';

/** A failed write may already have committed. Callers retain the operation identity. */
export class QuizTraceRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

export function createQuizOperationId(): string {
  return crypto.randomUUID();
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = data as { error?: { code?: string } };
    throw new QuizTraceRequestError(error.error?.code ?? 'QUIZ_REQUEST_FAILED', response.status);
  }
  return data as T;
}

const attemptPath = (id: string) => `/api/quiz-trace/attempts/${encodeURIComponent(id)}`;
export const prepareQuiz = (input: PrepareQuizInput): Promise<PreparedQuiz> =>
  request('/api/quiz-trace/prepare', 'POST', input);
export const saveQuizDraft = (attemptId: string, input: QuizDraftWrite): Promise<PreparedQuiz> =>
  request(`${attemptPath(attemptId)}/draft`, 'PUT', input);
export const submitQuiz = (
  attemptId: string,
  input: QuizSubmissionInput,
): Promise<QuizSubmission> => request(`${attemptPath(attemptId)}/submission`, 'POST', input);
export const requestQuizReview = (
  attemptId: string,
  input: QuizReviewInput,
): Promise<QuizReview | { pending: true }> =>
  request('/api/quiz-grade', 'POST', { attemptId, ...input });
export const readQuizHistory = (stageId: string): Promise<QuizHistoryRead> =>
  request(`/api/quiz-trace/history?${new URLSearchParams({ stageId })}`);
export const loadQuizForPlay = (stageId: string, sceneId: string): Promise<PreparedQuiz | null> =>
  request(`/api/quiz-trace/restore?${new URLSearchParams({ stageId, sceneId })}`);

export interface QuizDraftWriter {
  schedule(answers: QuizAnswers): void;
  flush(): Promise<PreparedQuiz>;
  cancel(): void;
}

/** Each CAS uses the sequence returned by the preceding write, including flush on submit. */
export function createQuizDraftWriter(
  initial: PreparedQuiz,
  options: {
    save?: typeof saveQuizDraft;
    onSaved?: (prepared: PreparedQuiz) => void;
    onError?: (error: unknown) => void;
    debounceMs?: number;
  } = {},
): QuizDraftWriter {
  let prepared = initial;
  let pending: QuizAnswers | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failure: unknown;
  let tail: Promise<PreparedQuiz> = Promise.resolve(initial);
  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const flush = (): Promise<PreparedQuiz> => {
    clearTimer();
    if (!pending) return tail;
    const answers = pending;
    pending = undefined;
    const operationId = createQuizOperationId();
    tail = tail.then(async () => {
      if (failure) throw failure;
      try {
        prepared = await (options.save ?? saveQuizDraft)(prepared.attemptId, {
          operationId,
          answers,
          expectedLastSeq: prepared.lastSeq,
        });
        options.onSaved?.(prepared);
        return prepared;
      } catch (error) {
        failure = error;
        throw error;
      }
    });
    // Do not continue with an assumed sequence after a lost response or CAS conflict.
    void tail.catch((error) => options.onError?.(error));
    return tail;
  };
  return {
    schedule(answers) {
      pending = structuredClone(answers);
      clearTimer();
      timer = setTimeout(() => {
        void flush();
      }, options.debounceMs ?? 500);
    },
    flush,
    cancel() {
      clearTimer();
      pending = undefined;
    },
  };
}

export interface PendingQuizSubmission {
  attemptId: string;
  input: QuizSubmissionInput;
}
export interface PendingQuizReview {
  attemptId: string;
  input: QuizReviewInput;
  /** Known only after a response; an operation ID alone cannot identify a Review row. */
  reviewId?: string;
}

/** Network recovery retains the original language and operation, even if locale changes. */
export function quizReviewRequest(
  attemptId: string,
  submissionId: string,
  language: string,
  pending: PendingQuizReview | null,
  explicitlyNew = false,
): PendingQuizReview {
  if (
    !explicitlyNew &&
    pending?.attemptId === attemptId &&
    pending.input.submissionId === submissionId
  )
    return pending;
  return { attemptId, input: { operationId: createQuizOperationId(), submissionId, language } };
}

const pendingReviewKey = (stageId: string, sceneId: string) =>
  `maic:quiz-review-pending:${encodeURIComponent(stageId)}:${encodeURIComponent(sceneId)}`;

export function rememberPendingQuizReview(
  stageId: string,
  sceneId: string,
  value: PendingQuizReview | null,
): void {
  try {
    if (value) sessionStorage.setItem(pendingReviewKey(stageId, sceneId), JSON.stringify(value));
    else sessionStorage.removeItem(pendingReviewKey(stageId, sceneId));
  } catch {
    /* The mounted view still retains the original operation. */
  }
}

export function readPendingQuizReview(stageId: string, sceneId: string): PendingQuizReview | null {
  try {
    const raw = sessionStorage.getItem(pendingReviewKey(stageId, sceneId));
    if (!raw) return null;
    const value = JSON.parse(raw) as PendingQuizReview;
    return typeof value.attemptId === 'string' &&
      typeof value.input?.operationId === 'string' &&
      typeof value.input?.submissionId === 'string' &&
      typeof value.input?.language === 'string' &&
      (value.reviewId === undefined || typeof value.reviewId === 'string')
      ? value
      : null;
  } catch {
    return null;
  }
}

const pendingKey = (stageId: string, sceneId: string) =>
  `maic:quiz-pending:${encodeURIComponent(stageId)}:${encodeURIComponent(sceneId)}`;

/** Device-local recovery only; a pending marker never proves the server accepted a submission. */
export function rememberPendingQuizSubmission(
  stageId: string,
  sceneId: string,
  value: PendingQuizSubmission | null,
): void {
  try {
    if (value) sessionStorage.setItem(pendingKey(stageId, sceneId), JSON.stringify(value));
    else sessionStorage.removeItem(pendingKey(stageId, sceneId));
  } catch {
    /* The current mounted view still retains its immutable request. */
  }
}

export function readPendingQuizSubmission(
  stageId: string,
  sceneId: string,
): PendingQuizSubmission | null {
  try {
    const raw = sessionStorage.getItem(pendingKey(stageId, sceneId));
    if (!raw) return null;
    const value = JSON.parse(raw) as PendingQuizSubmission;
    if (
      typeof value.attemptId !== 'string' ||
      typeof value.input?.operationId !== 'string' ||
      typeof value.input?.submissionId !== 'string' ||
      !value.input.answers ||
      typeof value.input.answers !== 'object' ||
      Array.isArray(value.input.answers)
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
