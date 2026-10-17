import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreparedQuiz } from '@/lib/quiz/trace-types';
import {
  createQuizDraftWriter,
  loadQuizForPlay,
  prepareQuiz,
  QuizTraceRequestError,
  readPendingQuizSubmission,
  rememberPendingQuizSubmission,
  requestQuizReview,
  quizReviewRequest,
  readPendingQuizReview,
  rememberPendingQuizReview,
  submitQuiz,
} from '@/lib/quiz/trace-client';

function prepared(lastSeq = 1): PreparedQuiz {
  return {
    attemptId: 'attempt-1',
    stageId: 'stage-1',
    sceneId: 'scene-1',
    answers: {},
    lastSeq,
    reviews: [],
    version: {
      id: 'version-1',
      capturedAt: '2026-10-16T00:00:00Z',
      resources: [],
      scene: {
        id: 'scene-1',
        stageId: 'stage-1',
        type: 'quiz',
        title: 'Quiz',
        order: 0,
        content: { type: 'quiz', questions: [] },
        createdAt: 1,
        updatedAt: 1,
      },
    },
  };
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    setItem: (key: string, value: string) => values.set(key, value),
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('quiz trace HTTP client', () => {
  it('sends the full captured scene and returns only the server-frozen version', async () => {
    const server = prepared();
    const fetcher = vi.fn().mockResolvedValue(Response.json(server));
    vi.stubGlobal('fetch', fetcher);
    const input = {
      operationId: 'start-1',
      mode: 'start' as const,
      stageId: 'stage-1',
      sceneId: 'scene-1',
      scene: server.version.scene,
    };
    expect(await prepareQuiz(input)).toEqual(server);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(input);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      credentials: 'same-origin',
      cache: 'no-store',
    });
  });

  it('reuses the same formal submission after a lost response without changing identity or answers', async () => {
    const input = { operationId: 'submit-op', submissionId: 'submission-1', answers: { q1: 'A' } };
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('connection lost'))
      .mockResolvedValueOnce(Response.json({ id: input.submissionId, attemptId: 'attempt-1' }));
    vi.stubGlobal('fetch', fetcher);
    const pending = { attemptId: 'attempt-1', input };
    rememberPendingQuizSubmission('stage-1', 'scene-1', pending);
    await expect(submitQuiz(pending.attemptId, pending.input)).rejects.toThrow('connection lost');
    const recovered = readPendingQuizSubmission('stage-1', 'scene-1')!;
    await submitQuiz(recovered.attemptId, recovered.input);
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    expect(readPendingQuizSubmission('stage-1', 'scene-1')).toEqual(pending);
    expect(readPendingQuizSubmission('another-stage', 'scene-1')).toBeNull();
    rememberPendingQuizSubmission('stage-1', 'scene-1', null);
    expect(readPendingQuizSubmission('stage-1', 'scene-1')).toBeNull();
  });

  it('keeps a restored submission locked as returned, without mapping it to an editable draft', async () => {
    const state = {
      ...prepared(),
      submission: {
        id: 'submission-1',
        attemptId: 'attempt-1',
        versionId: 'version-1',
        answers: { q1: 'A' },
        recordId: 'record-1',
        seq: 2,
        savedAt: '2026-10-16T00:00:00Z',
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(state)));
    expect((await loadQuizForPlay('stage-1', 'scene-1'))?.submission).toEqual(state.submission);
  });

  it('preserves structured conflicts instead of treating them as a successful save', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: { code: 'SUBMISSION_LOCKED' } }, { status: 409 }),
        ),
    );
    await expect(
      submitQuiz('attempt-1', { operationId: 'op', submissionId: 'sub', answers: {} }),
    ).rejects.toMatchObject({ code: 'SUBMISSION_LOCKED', status: 409 });
  });

  it('passes only the bound submission identity and preserves pending review without inventing a score', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ pending: true }, { status: 202 }));
    vi.stubGlobal('fetch', fetcher);
    const input = { operationId: 'review-op', submissionId: 'submission-1', language: 'en-US' };
    expect(await requestQuizReview('attempt-1', input)).toEqual({ pending: true });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ attemptId: 'attempt-1', ...input });
  });

  it('recovers a lost review response with the original operation and language after reload', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce(Response.json({ pending: true }, { status: 202 }));
    vi.stubGlobal('fetch', fetcher);
    const pending = quizReviewRequest('attempt-1', 'submission-1', 'en-US', null);
    rememberPendingQuizReview('stage-1', 'scene-1', pending);
    await expect(requestQuizReview(pending.attemptId, pending.input)).rejects.toThrow(
      'response lost',
    );
    const recovery = quizReviewRequest(
      'attempt-1',
      'submission-1',
      'zh-CN',
      readPendingQuizReview('stage-1', 'scene-1'),
    );
    expect(await requestQuizReview(recovery.attemptId, recovery.input)).toEqual({ pending: true });
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    expect(recovery.input.language).toBe('en-US');
    expect(readPendingQuizReview('stage-1', 'scene-1')).toEqual(pending);
    expect(readPendingQuizReview('different-stage', 'scene-1')).toBeNull();
  });

  it('starts a different grading operation only for explicit re-evaluation or another submission', () => {
    const pending = quizReviewRequest('attempt-1', 'submission-1', 'en-US', null);
    expect(quizReviewRequest('attempt-1', 'submission-1', 'en-US', pending)).toBe(pending);
    const explicit = quizReviewRequest('attempt-1', 'submission-1', 'en-US', pending, true);
    expect(explicit.input.operationId).not.toBe(pending.input.operationId);
    expect(explicit.attemptId).toBe(pending.attemptId);
    expect(explicit.input.submissionId).toBe(pending.input.submissionId);
    expect(
      quizReviewRequest('attempt-2', 'submission-2', 'en-US', pending).input.operationId,
    ).not.toBe(pending.input.operationId);
    rememberPendingQuizReview('stage-1', 'scene-1', pending);
    rememberPendingQuizReview('stage-1', 'scene-1', null);
    expect(readPendingQuizReview('stage-1', 'scene-1')).toBeNull();
  });
});

describe('quiz draft CAS writer', () => {
  it('coalesces edits and serializes flushes using each returned sequence', async () => {
    vi.useFakeTimers();
    let release!: (value: PreparedQuiz) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<PreparedQuiz>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValueOnce(prepared(3));
    const writer = createQuizDraftWriter(prepared(), { save });
    writer.schedule({ q1: 'A' });
    writer.schedule({ q1: 'B' });
    const first = writer.flush();
    await Promise.resolve();
    writer.schedule({ q1: 'C' });
    const second = writer.flush();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1]).toMatchObject({ answers: { q1: 'B' }, expectedLastSeq: 1 });
    release(prepared(2));
    await first;
    await second;
    expect(save.mock.calls[1][1]).toMatchObject({ answers: { q1: 'C' }, expectedLastSeq: 2 });
    expect(save.mock.calls[0][1].operationId).not.toBe(save.mock.calls[1][1].operationId);
  });

  it('does not send a later draft with an assumed sequence after a conflict', async () => {
    const failure = new QuizTraceRequestError('DRAFT_CONFLICT', 409);
    const save = vi.fn().mockRejectedValue(failure);
    const onError = vi.fn();
    const writer = createQuizDraftWriter(prepared(), { save, onError });
    writer.schedule({ q1: 'A' });
    await expect(writer.flush()).rejects.toBe(failure);
    writer.schedule({ q1: 'B' });
    await expect(writer.flush()).rejects.toBe(failure);
    expect(save).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalled();
  });
});
