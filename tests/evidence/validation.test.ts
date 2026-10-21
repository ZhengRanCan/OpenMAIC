import { describe, expect, it } from 'vitest';
import type {
  ConfirmedCondition,
  EvidenceCapturedReply,
  EvidenceContext,
  EvidenceSourceCard,
  ModelCandidateV1,
} from '@/lib/evidence/contracts';
import { EVIDENCE_CONTEXT_VERSION, EVIDENCE_PROMPT_VERSION } from '@/lib/evidence/contracts';
import { validateEvidenceOutput } from '@/lib/evidence/validation';
import { buildEvidencePrompt } from '@/lib/evidence/prompt';
import { buildEvidenceContext, provenanceFingerprint } from '@/lib/evidence/context';
import type { PreparedQuiz } from '@/lib/quiz/trace-types';

const condition: ConfirmedCondition = {
  code: 'controlled-proxy',
  submissionId: 'submission',
  sourceFingerprint: 'fingerprint',
  origin: 'f63-review',
};
function card(
  ref: string,
  role: EvidenceSourceCard['role'],
  extra: Partial<EvidenceSourceCard['scope']> = {},
): EvidenceSourceCard {
  return {
    ref,
    role,
    scope: {
      stageId: 'stage',
      sceneId: 'scene',
      versionId: 'version',
      questionId: 'question',
      taskDigest: 'task-digest',
      ...extra,
    },
    path: `/${ref}`,
    contentDigest: `${ref}-digest`,
    renderedText: ref === 'answer' ? 'A submitted answer\r\nCafe\u0301' : ref,
  };
}
function context(): EvidenceContext {
  const sourceIndex = {
    task: card('task', 'task'),
    // Alias has the same historical task identity and content.
    alias: {
      ...card('alias', 'task'),
      contentDigest: 'task-rendered-content',
      renderedText: 'task',
    },
    answer: card('answer', 'answer', { attemptId: 'attempt', submissionId: 'submission' }),
    otherAnswer: card('otherAnswer', 'answer', {
      attemptId: 'other',
      submissionId: 'other-submission',
    }),
    rubric: card('rubric', 'rubric'),
    condition: {
      ...card('condition', 'condition', { submissionId: 'submission' }),
      condition,
      renderedText: JSON.stringify(condition),
    },
  };
  sourceIndex.task.contentDigest = 'task-rendered-content';
  return {
    version: EVIDENCE_CONTEXT_VERSION,
    text: 'Full historical context',
    sourceIndex,
    digest: 'context',
  };
}
function candidate(): ModelCandidateV1 {
  return {
    topic: 'A bounded learning matter',
    taskScope: 'This particular task',
    observations: ['The answer contains this expression.'],
    interpretation: 'The expression supports a local observation.',
    limitations: ['Controlled proxy only.'],
    pairs: [{ taskRef: 'task', answerRef: 'answer' }],
    citations: [{ ref: 'task' }, { ref: 'answer' }],
    conditionRefs: [],
  };
}
function output(items: unknown[] = [candidate()], outcome = 'formed') {
  return {
    schemaVersion: 'quiz-evidence.v1',
    overview: {
      outcome,
      inspectedRefs: ['task', 'answer'],
      notes: ['Only this selected historical scope.'],
      unfinished: [],
    },
    items,
  };
}
function reply(value: unknown, finishReason = 'stop'): EvidenceCapturedReply {
  return {
    text: typeof value === 'string' ? value : JSON.stringify(value),
    finishReason,
    usage: {},
    receivedAt: '2026-10-20T00:00:00Z',
    modelIdentity: {
      provider: 'test',
      model: 'test-model',
      slot: 'classroom',
      endpointFingerprint: 'endpoint',
      thinking: null,
      maxOutputTokens: 16000,
      timeoutMs: 180000,
      promptVersion: EVIDENCE_PROMPT_VERSION,
      schemaVersion: 'quiz-evidence.v1',
      contextVersion: EVIDENCE_CONTEXT_VERSION,
    },
  };
}

describe('candidate Evidence delivery checks', () => {
  it('accepts bounded items and attaches confirmed conditions without claiming semantic approval', () => {
    const check = validateEvidenceOutput(reply(output()), context());
    expect(check.state).toBe('completed');
    expect(check.items[0]).toMatchObject({
      index: 0,
      submissionIds: ['submission'],
      conditions: [condition],
    });
    expect(check.items[0]).not.toHaveProperty('itemId');
    expect(check).not.toHaveProperty('adoptionAllowed');
  });
  it.each(['no-new', 'insufficient'])('accepts explicit zero %s with a reason', (outcome) => {
    expect(validateEvidenceOutput(reply(output([], outcome)), context()).state).toBe('completed');
    const noReason = output([], outcome);
    noReason.overview.notes = [];
    expect(validateEvidenceOutput(reply(noReason), context()).state).toBe('failed');
  });
  it.each([
    ['', 'stop'],
    ['   ', 'stop'],
    ['{"items":', 'stop'],
    ['{}', 'stop'],
    [JSON.stringify(output()), 'length'],
    [JSON.stringify(output()), 'content-filter'],
    [JSON.stringify(output([])), 'stop'],
    [JSON.stringify({ ...output(), approved: true }), 'stop'],
    [JSON.stringify(output([candidate()], 'no-new')), 'stop'],
  ])('does not turn an incomplete/invalid reply into legitimate zero Evidence', (text, reason) => {
    const check = validateEvidenceOutput(reply(text, reason), context());
    expect(check.state).toBe('failed');
    expect(check.items).toEqual([]);
    expect(check.errors.length).toBeGreaterThan(0);
  });
  it('checks UTF-8 raw size before parsing and does not strip JSON fences', () => {
    expect(validateEvidenceOutput(reply('中'.repeat(44000)), context()).errors).toContain(
      'OUTPUT_TOO_LARGE',
    );
    expect(
      validateEvidenceOutput(reply('```json\n' + JSON.stringify(output()) + '\n```'), context())
        .state,
    ).toBe('failed');
  });
  it('keeps original indices and rejects bad references locally', () => {
    const bad = candidate();
    bad.citations.push({ ref: 'missing' });
    const check = validateEvidenceOutput(reply(output([candidate(), bad, candidate()])), context());
    expect(check.state).toBe('partial');
    expect(check.rejected.map((x) => x.index)).toEqual([1]);
    expect(check.items.map((x) => x.index)).toEqual([0, 2]);
  });
  it('keeps all-rejected delivery partial instead of inventing no-new', () => {
    const bad = { ...candidate(), mastery: 'high' };
    const check = validateEvidenceOutput(reply(output([bad])), context());
    expect(check).toMatchObject({ state: 'partial', items: [], rejected: [{ index: 0 }] });
    expect(check.overview?.outcome).toBe('formed');
  });
  it('rejects wrong roles, uncited pairs, wrong condition roles and historical mismatch', () => {
    const values = [
      { ...candidate(), pairs: [{ taskRef: 'rubric', answerRef: 'answer' }] },
      { ...candidate(), citations: [{ ref: 'answer' }] },
      { ...candidate(), conditionRefs: ['rubric'] },
    ];
    for (const value of values)
      expect(validateEvidenceOutput(reply(output([value])), context()).state).toBe('partial');
    for (const field of ['versionId', 'questionId', 'taskDigest', 'stageId', 'sceneId'] as const) {
      const changed = context();
      changed.sourceIndex.answer.scope[field] = 'wrong';
      expect(validateEvidenceOutput(reply(output()), changed).state).toBe('partial');
    }
  });
  it('matches a task alias by actual historical identity and content, not its ref name', () => {
    const value = candidate();
    value.pairs[0].taskRef = 'alias';
    value.citations[0].ref = 'alias';
    expect(validateEvidenceOutput(reply(output([value])), context()).state).toBe('completed');
    const wrong = context();
    wrong.sourceIndex.alias.scope.taskDigest = 'changed-original-question';
    expect(validateEvidenceOutput(reply(output([value])), wrong).state).toBe('partial');
  });
  it('only normalizes CRLF and NFC for exact contiguous quotes', () => {
    const value = candidate();
    value.citations[1].quote = 'answer\nCafé';
    expect(validateEvidenceOutput(reply(output([value])), context()).state).toBe('completed');
    value.citations[1].quote = 'Answer Café';
    expect(validateEvidenceOutput(reply(output([value])), context()).state).toBe('partial');
  });
  it('preserves overlapping source identities rather than manufacturing independent performances', () => {
    const a = candidate(),
      b = candidate();
    b.interpretation = 'Another use of the same answer.';
    const check = validateEvidenceOutput(reply(output([a, b])), context());
    expect(check.items.map((x) => x.submissionIds)).toEqual([['submission'], ['submission']]);
    expect(check).not.toHaveProperty('independentPerformanceCount');
  });
  it('rejects malformed item fields/limits locally and top-level limits globally', () => {
    for (const value of [
      { ...candidate(), topic: ' ' },
      { ...candidate(), interpretation: 'x'.repeat(8001) },
      { ...candidate(), citations: [{ ref: 'task', quote: 'x'.repeat(2001) }, { ref: 'answer' }] },
      {
        ...candidate(),
        pairs: Array.from({ length: 41 }, () => ({ taskRef: 'task', answerRef: 'answer' })),
      },
      { ...candidate(), targetId: 'invented' },
      { ...candidate(), observations: Array(41).fill('observation') },
    ])
      expect(validateEvidenceOutput(reply(output([value])), context()).state).toBe('partial');
    expect(
      validateEvidenceOutput(reply(output(Array(17).fill(candidate()))), context()).state,
    ).toBe('failed');
    const badOverview = output();
    badOverview.overview.inspectedRefs = ['unknown'];
    expect(validateEvidenceOutput(reply(badOverview), context()).state).toBe('failed');
  });
  it('binds only conditions for actually used submissions, retaining both in a comparison', () => {
    const value = candidate();
    value.pairs.push({ taskRef: 'task', answerRef: 'otherAnswer' });
    value.citations.push({ ref: 'otherAnswer' });
    expect(
      validateEvidenceOutput(reply(output([value])), context()).items[0].submissionIds,
    ).toEqual(['other-submission', 'submission']);
  });
  it('rejects a broken trusted condition binding instead of silently dropping it', () => {
    const value = context();
    delete value.sourceIndex.condition.condition;
    expect(validateEvidenceOutput(reply(output()), value).rejected[0].codes).toContain(
      'INVALID_CONDITION_BINDING',
    );
  });
  it('accepts the real context builder identity and attaches its authoritative condition metadata', () => {
    const quiz: PreparedQuiz = {
      attemptId: 'attempt',
      stageId: 'stage',
      sceneId: 'scene',
      lastSeq: 1,
      answers: {},
      reviews: [],
      submission: {
        id: 'submission',
        attemptId: 'attempt',
        versionId: 'version',
        answers: { question: 'Written answer' },
        recordId: 'record',
        seq: 1,
        savedAt: '2026-10-20T00:00:00Z',
      },
      version: {
        id: 'version',
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
                id: 'question',
                type: 'short_answer',
                question: 'Explain the relation. A direction hint.',
                answer: ['Reference only'],
                points: 2,
              },
            ],
          },
        },
      },
    };
    const confirmed = { ...condition, sourceFingerprint: provenanceFingerprint(quiz) };
    const actual = buildEvidenceContext({
      schemaVersion: 1,
      capturedAt: '2026-10-20T01:00:00Z',
      anchor: quiz,
      related: [],
      conditions: [confirmed],
      provenanceDigest: 'manifest',
    });
    const task = Object.values(actual.sourceIndex).find((x) => x.role === 'task')!;
    const answer = Object.values(actual.sourceIndex).find((x) => x.role === 'answer')!;
    expect(task.contentDigest).not.toBe(task.scope.taskDigest);
    const item = {
      ...candidate(),
      pairs: [{ taskRef: task.ref, answerRef: answer.ref }],
      citations: [{ ref: task.ref }, { ref: answer.ref }],
    };
    const body = output([item]);
    body.overview.inspectedRefs = [task.ref, answer.ref];
    const check = validateEvidenceOutput(reply(body), actual);
    expect(check.state).toBe('completed');
    expect(check.items[0].conditions).toEqual([confirmed]);
  });
});

describe('versioned Evidence instructions', () => {
  it('uses the contract versions and a single JSON protocol without case-specific expected answers', () => {
    const zh = buildEvidencePrompt('zh-CN'),
      en = buildEvidencePrompt('en-US');
    expect(zh).toMatchObject({
      promptVersion: EVIDENCE_PROMPT_VERSION,
      schemaVersion: 'quiz-evidence.v1',
    });
    expect(zh.system).toContain('Simplified Chinese');
    expect(en.system).toContain('English');
    expect(zh.system).toContain('not independent learning performances');
    expect(zh.system).not.toContain('studies');
    expect(zh.system).not.toContain('watches');
  });
});
