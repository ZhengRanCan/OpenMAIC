import { describe, expect, it } from 'vitest';
import type { PreparedQuiz } from '@/lib/quiz/trace-types';
import {
  buildEvidenceContext,
  canonicalJson,
  provenanceFingerprint,
  validatePreparedSource,
} from '@/lib/evidence/context';
import { EVIDENCE_LIMITS } from '@/lib/evidence/contracts';

function quiz(): PreparedQuiz {
  return {
    attemptId: 'a',
    stageId: 'stage',
    sceneId: 'scene',
    lastSeq: 2,
    answers: { q: 'An answer' },
    reviews: [],
    submission: {
      id: 's',
      attemptId: 'a',
      versionId: 'v',
      answers: { q: 'An answer' },
      recordId: 'record',
      seq: 2,
      savedAt: '2026-10-20T00:00:00Z',
    },
    version: {
      id: 'v',
      capturedAt: '2026-10-20T00:00:00Z',
      resources: [],
      resourceCoverage: { taskPresentation: 'text-and-math-quiz', unavailableBackgroundRefs: [] },
      scene: {
        id: 'scene',
        stageId: 'stage',
        title: 'Synthetic',
        order: 0,
        type: 'quiz',
        content: {
          type: 'quiz',
          questions: [
            {
              id: 'q',
              type: 'short_answer',
              question: 'Explain. First check the subject.',
              analysis: 'Reference answer',
              commentPrompt: 'Correct gets five; exceptions must be preserved.',
              points: 5,
            },
          ],
        },
      },
    },
  };
}
const envelope = (anchor = quiz()) => ({
  schemaVersion: 1 as const,
  capturedAt: '2026-10-20T01:00:00Z',
  anchor,
  related: [],
  conditions: [],
  provenanceDigest: 'manifest',
});
describe('historical evidence context', () => {
  it('retains full task/rubric and separates actual answer and reference material', () => {
    const context = buildEvidenceContext(envelope());
    expect(context.text).toContain('First check the subject.');
    expect(context.text).toContain('exceptions must be preserved.');
    expect(
      Object.values(context.sourceIndex)
        .filter((x) => x.role === 'answer')
        .map((x) => x.renderedText)
        .join(''),
    ).toContain('An answer');
    expect(
      Object.values(context.sourceIndex).find((x) => x.role === 'rubric')?.renderedText,
    ).toContain('Reference answer');
    expect(buildEvidenceContext({ ...envelope(), capturedAt: '2027-01-01' }).digest).toBe(
      context.digest,
    );
  });
  it('shares task identity across same-version submissions without merging their answers', () => {
    const other = quiz();
    other.attemptId = 'a2';
    other.submission = { ...other.submission!, id: 's2', attemptId: 'a2' };
    const context = buildEvidenceContext({ ...envelope(), related: [other] });
    expect(Object.values(context.sourceIndex).filter((x) => x.role === 'task')).toHaveLength(1);
    expect(Object.values(context.sourceIndex).filter((x) => x.role === 'answer')).toHaveLength(2);
  });
  it('does not change provenance for dynamic draft/review metadata', () => {
    const before = quiz(),
      after = quiz();
    after.lastSeq = 99;
    after.answers = { q: 'draft' };
    after.pendingReview = { id: 'r', ordinal: 1 };
    expect(provenanceFingerprint(after)).toBe(provenanceFingerprint(before));
    after.submission!.answers.q = 'changed';
    expect(provenanceFingerprint(after)).not.toBe(provenanceFingerprint(before));
  });
  it('rejects drafts, broken formal identity, mismatched review and unavailable task coverage', () => {
    const draft = quiz();
    delete draft.submission;
    expect(() => validatePreparedSource(draft)).toThrow();
    const bad = quiz();
    bad.submission!.versionId = 'other';
    expect(() => validatePreparedSource(bad)).toThrow();
    const absent = quiz();
    delete absent.version.resourceCoverage;
    expect(() => validatePreparedSource(absent)).toThrow();
  });
  it('pins evaluation identity and keeps it separate from formal answer provenance', () => {
    const original = quiz(),
      changed = quiz();
    changed.reviews = [
      {
        id: 'r',
        attemptId: 'a',
        submissionId: 's',
        versionId: 'v',
        ordinal: 1,
        savedAt: '2026-10-20T01:00:00Z',
        results: [
          {
            questionId: 'q',
            correct: null,
            status: 'incorrect',
            earned: 0,
            aiComment: 'Unavailable evaluation',
            evaluation: { state: 'fallback', method: 'model', reason: 'technical failure' },
          },
        ],
        summary: {
          status: 'unavailable',
          usableEarned: 0,
          usablePossible: 0,
          quizPossible: 5,
          unusableQuestionCount: 1,
        },
      },
    ];
    changed.review = changed.reviews[0];
    expect(provenanceFingerprint(changed)).toBe(provenanceFingerprint(original));
    expect(buildEvidenceContext(envelope(changed)).digest).not.toBe(
      buildEvidenceContext(envelope(original)).digest,
    );
    expect(buildEvidenceContext(envelope(changed)).text).toContain('technical failure');
    changed.reviews[0].submissionId = 'different';
    expect(() => validatePreparedSource(changed)).toThrow();
  });
  it('retains confirmed proxy limitations and excludes unrelated technical metadata', () => {
    const source = quiz();
    Object.assign(source, {
      ownerId: 'SECRET_TECHNICAL_OWNER',
      cookie: 'SECRET_COOKIE',
      apiKey: 'SECRET_KEY',
    });
    const context = buildEvidenceContext({
      ...envelope(source),
      conditions: [
        {
          code: 'controlled-proxy',
          submissionId: 's',
          sourceFingerprint: provenanceFingerprint(source),
          origin: 'f63-review',
        },
      ],
    });
    const card = Object.values(context.sourceIndex).find((x) => x.role === 'condition');
    expect(card?.condition?.code).toBe('controlled-proxy');
    expect(context.text).not.toContain('SECRET_');
    expect(() =>
      buildEvidenceContext({
        ...envelope(source),
        conditions: [
          {
            code: 'controlled-proxy',
            submissionId: 's',
            sourceFingerprint: 'wrong',
            origin: 'f63-review',
          },
        ],
      }),
    ).toThrow();
  });
  it('enforces task count and UTF8 input budget without truncating', () => {
    const source = quiz();
    if (source.version.scene.type !== 'quiz') throw Error('fixture');
    const initialQuestion = source.version.scene.content.questions[0];
    source.version.scene.content.questions = Array.from({ length: 21 }, (_, index) => ({
      ...initialQuestion,
      id: `q${index}`,
    }));
    expect(() => buildEvidenceContext(envelope(source))).toThrow();
    const large = quiz();
    large.submission!.answers.q = '中'.repeat(45000);
    expect('中'.repeat(45000).length).toBeLessThan(EVIDENCE_LIMITS.inputBytes);
    expect(() => buildEvidenceContext(envelope(large))).toThrowError('EVIDENCE_INPUT_TOO_LARGE');
  });
  it('hashes canonical semantic JSON deterministically and rejects unsupported values', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(() => canonicalJson(Number.NaN)).toThrow();
    const changed = quiz();
    if (changed.version.scene.type !== 'quiz') throw Error('fixture');
    changed.version.scene.content.questions[0].question = 'A revised historical task';
    expect(provenanceFingerprint(changed)).not.toBe(provenanceFingerprint(quiz()));
  });
});
