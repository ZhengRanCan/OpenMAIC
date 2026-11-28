import { describe, it, expect } from 'vitest';
import {
  eventSources,
  replay,
  answerQuestions,
  validateInputs,
  runExperiment,
} from '@/eval/learner-profile/engine';
import { configSchema, type Event, type Invoker } from '@/eval/learner-profile/contracts';
import { ModelSession } from '@/eval/learner-profile/model';
import { validationSummary } from '@/eval/learner-profile/report';
import { extractSources, parseModelJSON } from '@/eval/learner-profile/prompts';
import { emptySnapshot, MemoryError, DEFAULT_BUDGETS } from '@/lib/learner-memory/contracts';
import {
  prepareClassroomMemory,
  applyClassroomMemory,
} from '@/lib/learner-memory/classroom-transition';

const event: Event = {
  id: 'e1',
  learnerId: 'synthetic',
  ordinal: 1,
  occurredAt: null,
  kind: 'quiz',
  origin: 'synthetic',
  questionId: 'same-question',
  parts: [
    {
      question: '单选: 结果是多少？',
      options: ['A: 一', 'B: 二'],
      answer: 'A',
      review: 'incorrect',
      help: 'unknown',
    },
  ],
};
const fixture: Invoker = async (r) => ({
  text: r.fixtureReply,
  model: 'fixture-protocol-only',
  inputTokens: null,
  outputTokens: null,
  finishReason: 'stop',
});
const request = { stage: 'memory' as const, system: 's', user: 'u', fixtureReply: '{}' };

describe('F116 semantic and budget fixes', () => {
  it('counts a truncated returned reply as a model rejection and uses correction rather than transport retry', async () => {
    let count = 0;
    const s = new ModelSession(
      configSchema.parse({ maxRetries: 1, validationRetries: 1 }),
      async (r, signal) => ({
        ...(await fixture(r, signal)),
        finishReason: count++ === 0 ? 'length' : 'stop',
      }),
    );
    await s.callValidated(request, parseModelJSON);
    expect(s.calls.map((c) => c.transportAttempt)).toEqual([0, 0]);
    expect(s.calls.map((c) => c.validationAttempt)).toEqual([0, 1]);
    expect(validationSummary(s.calls)).toMatchObject({
      firstAttempts: 1,
      firstFailures: 1,
      firstUnavailable: 0,
      firstRequestPasses: 1,
      firstRequestFailures: 0,
      transportRetries: 0,
      transportFailures: 0,
      responseFailures: 1,
      correctionAttempts: 1,
      correctionPasses: 1,
    });
  });
  it('reports the validated candidate code point excess without modifying the snapshot', () => {
    const p = prepareClassroomMemory(emptySnapshot(), eventSources(event), []);
    const reply = JSON.stringify({
      status: 'ready',
      sections: [{ section: 'learning_experiences', pieceIds: ['new:1'] }],
      pieces: [{ id: 'new:1', text: '界'.repeat(1005), formation: 'synthesis', supports: ['e1'] }],
      retired: [],
      decisions: [{ source: 'e1', action: 'adopt', pieceIds: ['new:1'], reason: 'test' }],
    });
    let failure: unknown;
    try {
      applyClassroomMemory(p, reply);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(MemoryError);
    expect(
      (failure as MemoryError).details?.sections.find((s) => s.section === 'learning_experiences'),
    ).toEqual({ section: 'learning_experiences', actual: 1005, limit: 1000, overBy: 5 });
    expect(p.snapshot.pieces).toHaveLength(0);
  });
  it('keeps quiz type through extraction, without restoring the full question', () => {
    const sources = eventSources(event);
    const value = JSON.parse(
      extractSources('{"facts":[{"source":"e1","text":"结果错误。"}]}', sources)[0].text,
    );
    expect(value.questionType).toBe('单选');
    expect(value.question).toBeUndefined();
  });
  it('rejects a reversed outcome claimed to be already represented and accepts explicit adoption', () => {
    const old = eventSources(event)[0],
      snap = emptySnapshot<typeof old>();
    snap.sections.learning_experiences = ['old'];
    snap.pieces = [
      {
        id: 'old',
        text: '该题曾答错。',
        formation: 'synthesis',
        conditions: [],
        restrictions: [],
        supports: [old],
      },
    ];
    const fresh = eventSources({
      ...event,
      id: 'e2',
      ordinal: 2,
      parts: [{ ...event.parts[0], review: 'correct' }],
    });
    const p = prepareClassroomMemory(snap, fresh, [old]);
    expect(() =>
      applyClassroomMemory(
        p,
        JSON.stringify({
          status: 'ready',
          sections: [],
          pieces: [],
          retired: [],
          decisions: [
            { source: 'e1', action: 'already_represented', pieceIds: ['old'], reason: '同题' },
          ],
        }),
      ),
    ).toThrow('PROFILE_MEMORY_CHANGED_REVIEW_IGNORED');
    const reply = JSON.stringify({
      status: 'ready',
      sections: [{ section: 'learning_experiences', pieceIds: ['old'] }],
      pieces: [
        { id: 'old', text: '曾答错，后来答对。', formation: 'synthesis', supports: ['s1', 'e1'] },
      ],
      retired: [],
      decisions: [{ source: 'e1', action: 'adopt', pieceIds: ['old'], reason: '保留变化' }],
    });
    expect(
      applyClassroomMemory(p, '```json\n' + reply + '\n```').snapshot.pieces[0].text,
    ).toContain('后来答对');
    expect(snap.pieces[0].text).toBe('该题曾答错。');
  });
  it('gives exact candidate budget feedback and keeps the rejected candidate for repair', async () => {
    const s = new ModelSession(configSchema.parse({ validationRetries: 1 }), fixture);
    let count = 0;
    await s.callValidated(request, () => {
      if (count++ === 0)
        throw new MemoryError('SECTION_BUDGET_EXCEEDED', {
          sections: [{ section: 'learning_experiences', actual: 1005, limit: 1000, overBy: 5 }],
          total: { actual: 1005, limit: 2000, overBy: 0 },
        });
      return true;
    });
    expect(s.calls[1].user).toContain('"actual":1005');
    expect(s.calls[1].user).toContain('"overBy":5');
    expect(s.calls[1].user).toContain('前次候选');
    expect(s.calls[0].logicalCallId).toBe(s.calls[1].logicalCallId);
    expect(validationSummary(s.calls)).toMatchObject({
      firstAttempts: 1,
      firstFailures: 1,
      correctionAttempts: 1,
      correctionPasses: 1,
    });
  });
  it('keeps repeated stages distinct and separates recovered transport from first response validation', async () => {
    let count = 0;
    const s = new ModelSession(configSchema.parse({ maxRetries: 1 }), async (r, signal) => {
      if (count++ === 0) throw new Error('CONNECTION_FAILED');
      return fixture(r, signal);
    });
    await s.callValidated(request, parseModelJSON);
    await s.callValidated(request, parseModelJSON);
    expect(validationSummary(s.calls)).toMatchObject({
      firstAttempts: 2,
      firstPasses: 2,
      firstFailures: 0,
      firstRequestFailures: 1,
      transportRetries: 1,
    });
    expect(new Set(s.calls.map((c) => c.logicalCallId)).size).toBe(2);
    expect(validationSummary(s.calls.map(({ logicalCallId: _id, ...c }) => c))).toMatchObject({
      firstAttempts: 0,
      legacyUnidentifiedCalls: 3,
    });
  });
  it('omits an oversized previous candidate explicitly while respecting the full input limit', async () => {
    let seen = 0;
    const s = new ModelSession(configSchema.parse({ validationRetries: 1 }), async (r, signal) => ({
      ...(await fixture(r, signal)),
      text: seen++ === 0 ? 'x'.repeat(12000) : '{}',
    }));
    let validate = 0;
    await s.callValidated({ ...request, user: 'u'.repeat(45900) }, () => {
      if (validate++ === 0) throw new Error('INVALID_JSON');
      return true;
    });
    expect(s.calls[1].user).toContain('候选因输入容量不足已省略');
    expect(Buffer.byteLength(s.calls[1].system + s.calls[1].user)).toBeLessThanOrEqual(48000);
    const source = eventSources(event)[0];
    expect(prepareClassroomMemory(emptySnapshot(), [source], [], 2048).budgets.inputBytes).toBe(
      DEFAULT_BUDGETS.inputBytes - 2048,
    );
  });
  it('answers only a declared successful prefix even when final replay fails', async () => {
    const s: ModelSession = new ModelSession(
      configSchema.parse({ batchSize: 1 }),
      async (r, signal) =>
        s.calls.filter((c) => c.stage === 'memory').length === 2 && r.stage === 'memory'
          ? { ...(await fixture(r, signal)), text: 'invalid' }
          : fixture(r, signal),
    );
    const arm = await replay(
      [
        event,
        {
          ...event,
          id: 'e2',
          ordinal: 2,
          parts: [{ ...event.parts[0], answer: 'FUTURE_SENTINEL' }],
        },
      ],
      'direct',
      s,
    );
    const q = {
      id: 'q1',
      learnerId: event.learnerId,
      category: 'IE' as const,
      question: 'prefix?',
      gold: 'GOLD_SENTINEL',
      sourceIds: ['e1'],
      checkpoint: 1,
    };
    const answers = await answerQuestions(arm, [q, { ...q, id: 'q2', checkpoint: undefined }], s);
    expect(arm.complete).toBe(false);
    expect(answers[0].answer).not.toBeNull();
    expect(answers[1].error).toBe('INCOMPLETE_REPLAY');
    expect(s.calls.filter((c) => c.stage === 'answer')[0].user).not.toMatch(
      /FUTURE_SENTINEL|GOLD_SENTINEL/,
    );
    expect(() => validateInputs([event], [{ ...q, checkpoint: 2 }])).toThrow(
      'QUESTION_CHECKPOINT_INVALID',
    );
  });
  it('gives raw-history the same prefix and rejects Gold sources beyond the checkpoint', async () => {
    const events = [
      event,
      { ...event, id: 'e2', ordinal: 2, parts: [{ ...event.parts[0], answer: 'FUTURE_SENTINEL' }] },
    ];
    const q = {
      id: 'q1',
      learnerId: event.learnerId,
      category: 'IE' as const,
      question: 'prefix?',
      gold: 'GOLD_SENTINEL',
      sourceIds: ['e1'],
      checkpoint: 1,
    };
    expect(() => validateInputs(events, [{ ...q, sourceIds: ['e2'] }])).toThrow(
      'QUESTION_CHECKPOINT_INVALID',
    );
    const c = configSchema.parse({ methods: ['raw-history'] }),
      s = new ModelSession(c, fixture);
    await runExperiment(events, [q], c, s);
    expect(s.calls.find((c) => c.stage === 'answer')!.user).not.toMatch(
      /FUTURE_SENTINEL|GOLD_SENTINEL/,
    );
  });
});
