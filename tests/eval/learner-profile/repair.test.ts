import { describe, it, expect } from 'vitest';
import { configSchema, type Event, type Invoker } from '@/eval/learner-profile/contracts';
import {
  eventSources,
  replay,
  prepareExtractedBatch,
  rawHistoryContext,
  type ArmResult,
} from '@/eval/learner-profile/engine';
import { ModelSession } from '@/eval/learner-profile/model';
import {
  extractSources,
  memoryText,
  JUDGE_SYSTEM,
  parseModelJSON,
} from '@/eval/learner-profile/prompts';
import { summarize, reviewRows, reviewSummary } from '@/eval/learner-profile/report';
import { emptySnapshot, sourceKey } from '@/lib/learner-memory/contracts';
import { prepareClassroomMemory } from '@/lib/learner-memory/classroom-transition';

const event: Event = {
  id: 'e1',
  learnerId: 'synthetic',
  ordinal: 1,
  occurredAt: null,
  origin: 'public',
  kind: 'quiz',
  questionId: 'q1',
  recordedTime: '2020-01-01',
  concepts: ['加法'],
  parts: [
    { question: '合成题干', options: ['A: 一'], review: 'correct', help: 'practice-requested' },
  ],
};
const fixture: Invoker = async (r) => ({
  text: r.fixtureReply,
  model: 'fixture-protocol-only',
  inputTokens: null,
  outputTokens: null,
  finishReason: 'stop',
});

describe('F115 experiment repairs', () => {
  it('marks actual-answer availability separately for mixed public quiz parts', () => {
    const sources = eventSources({
      ...event,
      parts: [{ ...event.parts[0], answer: '学生的实际回答' }, event.parts[0]],
    });
    expect(sources.map((s) => JSON.parse(s.text).answerAvailable)).toEqual([true, false]);
    const extracted = extractSources(
      JSON.stringify({
        facts: [
          { source: 'e1', text: '实际回答观察' },
          { source: 'e2', text: null },
        ],
      }),
      sources,
    );
    expect(extracted.map((s) => JSON.parse(s.text).answerAvailable)).toEqual([true, false]);
  });
  it('preserves common locators, outcomes and conditions when extracting and revisiting sources', async () => {
    const s = new ModelSession(configSchema.parse({ batchSize: 1 }), async (r, signal) =>
      r.stage === 'extract'
        ? {
            ...(await fixture(r, signal)),
            text: '{"facts":[{"source":"e1","text":"平台评为正确。"}]}',
          }
        : fixture(r, signal),
    );
    await replay([event, { ...event, id: 'e2', ordinal: 2 }], 'two-stage', s);
    const source = eventSources(event)[0];
    const compressed = extractSources('{"facts":[{"source":"e1","text":"平台评为正确。"}]}', [
      source,
    ])[0];
    const value = JSON.parse(compressed.text);
    expect(value).toMatchObject({
      ordinal: 1,
      questionId: 'q1',
      recordedTime: '2020-01-01',
      review: 'correct',
      answerAvailable: false,
      concepts: ['加法'],
    });
    expect(compressed.conditions).toEqual(source.conditions);
    const second = s.calls.filter((c) => c.stage === 'memory')[1];
    expect(second.user.split('# 可引用的已有依据（s）')[1]).toContain('extractedFact');
    expect(second.user.split('# 可引用的已有依据（s）')[1]).not.toContain('合成题干');
  });

  it('keeps dropped old text dropped when replacing new evidence and admits a slightly longer fact', () => {
    const source = eventSources(event)[0];
    const old = Array.from({ length: 64 }, (_, i) => ({
      ...source,
      id: `old:${i}`,
      text: '界'.repeat(512),
    }));
    const p = prepareClassroomMemory(emptySnapshot(), [source], old);
    expect(p.aliases.s1.text).toBe('');
    const extracted = extractSources(
      JSON.stringify({ facts: [{ source: 'e1', text: '观察'.repeat(200) }] }),
      [source],
    );
    const after = prepareExtractedBatch(p, extracted);
    expect(after.aliases.s1.text).toBe('');
    expect(sourceKey(after.aliases.e1)).toBe(sourceKey(p.aliases.e1));
    expect(after.batch).toHaveLength(1);
  });

  it('includes conditions without exposing support bodies and encodes raw source bodies once', () => {
    const source = eventSources(event)[0],
      snap = emptySnapshot<typeof source>();
    snap.sections.learning_experiences = ['p'];
    snap.pieces = [
      {
        id: 'p',
        text: '完成练习',
        formation: 'synthesis',
        supports: [source],
        conditions: ['提示后'],
        restrictions: [],
      },
    ];
    expect(memoryText(snap)).toContain('条件：提示后');
    expect(memoryText(snap)).not.toContain('合成题干');
    const request = JSON.parse(JSON.stringify({ learningContext: rawHistoryContext([event]) }));
    expect(request.learningContext[0].content).toMatchObject({
      question: '合成题干',
      ordinal: 1,
      answerAvailable: false,
    });
  });

  it('records invalid attempts, retries only validation and includes correction cost', async () => {
    let count = 0;
    const s = new ModelSession(configSchema.parse({ validationRetries: 1 }), async (r, signal) => ({
      ...(await fixture(r, signal)),
      text: ++count === 1 ? 'bad-json' : '{"ok":true}',
    }));
    const result = await s.callValidated(
      { stage: 'answer', system: 's', user: 'u', fixtureReply: '{}' },
      parseModelJSON,
    );
    expect(result).toEqual({ ok: true });
    expect(s.calls.map((c) => c.validationAttempt)).toEqual([0, 1]);
    expect(s.calls[0].validationError).toBe('INVALID_JSON');
    expect(s.calls[1].user).toContain('INVALID_JSON');
    expect(s.calls).toHaveLength(2);
  });

  it('does not turn timeouts into validation retries', async () => {
    const s = new ModelSession(
      configSchema.parse({ validationRetries: 2, timeoutMs: 100 }),
      async () => new Promise(() => {}),
    );
    await expect(
      s.callValidated(
        { stage: 'memory', system: 's', user: 'u', fixtureReply: '{}' },
        parseModelJSON,
      ),
    ).rejects.toThrow('CALL_TIMEOUT');
    expect(s.calls).toHaveLength(1);
    const arms: ArmResult[] = [
      {
        learnerId: event.learnerId,
        method: 'direct',
        complete: false,
        steps: [],
        snapshot: emptySnapshot(),
        answers: [],
      },
    ];
    s.calls[0].method = 'direct';
    expect(summarize(arms, [], s.calls).methods[0].maintenance).toMatchObject({
      firstAttempts: 1,
      firstFailures: 1,
      firstPasses: 0,
      correctionAttempts: 0,
    });
  });

  it('does not count transport retries as additional first validation attempts', async () => {
    let attempts = 0;
    const s = new ModelSession(configSchema.parse({ maxRetries: 1 }), async (r, signal) => {
      if (++attempts === 1) throw new Error('CONNECTION_FAILED');
      return fixture(r, signal);
    });
    s.context = { learnerId: event.learnerId, method: 'direct' };
    await s.callValidated(
      { stage: 'memory', system: 's', user: 'u', fixtureReply: '{}' },
      parseModelJSON,
    );
    const arms: ArmResult[] = [
      {
        learnerId: event.learnerId,
        method: 'direct',
        complete: true,
        steps: [],
        snapshot: emptySnapshot(),
        answers: [],
      },
    ];
    expect(s.calls.map((c) => c.transportAttempt)).toEqual([0, 1]);
    expect(summarize(arms, [], s.calls).methods[0].maintenance).toMatchObject({
      firstAttempts: 1,
      firstFailures: 1,
      firstPasses: 0,
      correctionAttempts: 0,
    });
  });

  it('keeps unresolved judgments visible in full denominators and separates review groups', () => {
    const source = eventSources(event)[0],
      snapshot = emptySnapshot<typeof source>();
    const arms: ArmResult[] = [
      {
        learnerId: event.learnerId,
        method: 'direct',
        complete: true,
        steps: [],
        snapshot,
        answers: [
          {
            id: 'Q1',
            category: 'IE',
            answer: '不知道',
            correct: null,
            reason: 'judge error',
            error: 'SCORING_UNDETERMINED',
          },
        ],
      },
    ];
    const questions = [
      {
        id: 'Q1',
        learnerId: event.learnerId,
        category: 'IE' as const,
        question: '事实？',
        gold: '明确事实',
        sourceIds: [],
      },
    ];
    const report = summarize(arms, questions, []);
    expect(report.methods[0].categories[0]).toMatchObject({
      expected: 1,
      scored: 0,
      accuracy: null,
      confirmedCorrectOverExpected: 0,
      scoringCoverage: 0,
      unresolved: 1,
      explicitUnknownAnswers: 1,
    });
    expect(report.methods[0].stages.memory.inputTokens).toEqual({ known: 0, missing: 0 });
    const review = reviewSummary([
      {
        method: 'direct',
        complete: true,
        judgment: 'supported',
        reviewer: 'human',
        reason: 'source supports it',
      },
      { method: 'two-stage', complete: false, judgment: null },
    ]);
    expect(review.groups).toHaveLength(2);
    expect(review.groups[1]).toMatchObject({
      method: 'two-stage',
      complete: false,
      pending: 1,
      supportRate: null,
    });
    expect(JUDGE_SYSTEM).toContain('不得因回答缺少信息判null');
    snapshot.sections.learning_experiences = ['p'];
    snapshot.pieces = [
      {
        id: 'p',
        text: '事实',
        formation: 'synthesis',
        supports: [source],
        conditions: [],
        restrictions: [],
      },
    ];
    expect(reviewRows(arms, [event])[0]).toMatchObject({
      complete: true,
      lastCompletedCheckpoint: 0,
      snapshotRevision: 0,
    });
  });
});
