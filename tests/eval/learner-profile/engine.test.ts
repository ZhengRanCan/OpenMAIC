import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { configSchema, type Invoker } from '@/eval/learner-profile/contracts';
import {
  validateInputs,
  eventSources,
  replay,
  answerQuestions,
  runExperiment,
  hasIncompleteResults,
} from '@/eval/learner-profile/engine';
import { ModelSession } from '@/eval/learner-profile/model';
import { extractSources, memoryText } from '@/eval/learner-profile/prompts';
import { summarize, reviewSummary } from '@/eval/learner-profile/report';
import { classroomMemorySources } from '@/lib/learner-memory/profile-memory-snapshot';
import { emptySnapshot, digest, DEFAULT_BUDGETS } from '@/lib/learner-memory/contracts';
import {
  prepareClassroomMemory,
  applyClassroomMemory,
} from '@/lib/learner-memory/classroom-transition';
import { buildMemoryPrompt } from '@/lib/learner-memory/prompt';
import { CLASSROOM_MEMORY_SYSTEM } from '@/lib/learner-memory/profile-memory-snapshot';

const data = () =>
  validateInputs(
    JSON.parse(readFileSync('eval/learner-profile/fixtures/events.json', 'utf8')),
    JSON.parse(readFileSync('eval/learner-profile/fixtures/questions.json', 'utf8')),
  );
const fixture: Invoker = async (r) => ({
  text: r.fixtureReply,
  model: 'fixture-protocol-only',
  inputTokens: null,
  outputTokens: null,
  finishReason: 'stop',
});
const session = (invoke = fixture, extra = {}) =>
  new ModelSession(configSchema.parse(extra), invoke);

describe('F113 offline memory experiments', () => {
  it('retains an undetermined judge reason and marks the run incomplete', async () => {
    const d = data(),
      s = session(async (r) =>
        r.stage === 'judge'
          ? {
              ...(await fixture(r, AbortSignal.abort())),
              text: '{"correct":null,"reason":"Reference cannot be adjudicated"}',
            }
          : fixture(r, AbortSignal.abort()),
      );
    const result = await runExperiment(d.events, d.questions, s.config, s);
    expect(result.results[0].answers[0]).toMatchObject({
      correct: null,
      error: 'SCORING_UNDETERMINED',
      reason: 'Reference cannot be adjudicated',
    });
    expect(hasIncompleteResults(result.results)).toBe(true);
    expect(summarize(result.results, d.questions, s.calls).methods[0].categories[0]).toMatchObject({
      expected: 2,
      scored: 0,
      accuracy: null,
      failures: 2,
    });
  });
  it('runs both arms, isolates learners, hides gold and future data, and records calls', async () => {
    const d = data(),
      s = session();
    const result = await runExperiment(d.events, d.questions, s.config, s);
    expect(result.results).toHaveLength(4);
    expect(result.results.every((a) => a.complete)).toBe(true);
    expect(s.calls.filter((c) => c.stage === 'extract')).toHaveLength(4);
    const firstMemory = s.calls.find((c) => c.stage === 'memory')!;
    expect(firstMemory.user).not.toContain('接下来这一周');
    expect(
      s.calls
        .filter((c) => c.stage === 'memory' || c.stage === 'extract')
        .every((c) => !c.user.includes(d.questions[0].question)),
    ).toBe(true);
    for (const c of s.calls.filter((c) => c.stage === 'answer')) {
      expect(Object.keys(JSON.parse(c.user)).sort()).toEqual(['learningContext', 'question']);
      expect(c.user).not.toContain('sourceDigest');
      expect(c.user).not.toContain('sourceNature');
    }
    expect(
      result.results
        .filter((a) => a.learnerId === 'synthetic-b')
        .every((a) => !memoryText(a.snapshot).includes('这一周')),
    ).toBe(true);
    expect(summarize(result.results, d.questions, s.calls).inputTokens.known).toBeNull();
  });
  it('reuses the exact native source projection and production preparation', () => {
    const e = data().events[0],
      job = `eval:${digest([e.learnerId, e.id]).slice(0, 32)}`;
    const native = classroomMemorySources(job, digest(e), null, {
      stageId: 'offline',
      title: 'offline',
      kind: 'quiz',
      occurredAt: e.occurredAt!,
      parts: e.parts.map((p) => ({ ...p, answer: p.answer! })),
    });
    expect(eventSources(e)).toEqual(native);
    const snapshot = emptySnapshot<(typeof native)[number]>();
    const prepared = prepareClassroomMemory(snapshot, native, []);
    expect(prepared.prompt).toEqual(
      buildMemoryPrompt(snapshot, native, DEFAULT_BUDGETS, [], CLASSROOM_MEMORY_SYSTEM, true)
        .prompt,
    );
  });
  it('drops old text before shrinking a capacity-limited increment batch', () => {
    const source = eventSources(data().events[0])[0];
    const old = Array.from({ length: 64 }, (_, i) => ({
      ...source,
      id: `old:${i}`,
      text: '界'.repeat(512),
    }));
    const prepared = prepareClassroomMemory(emptySnapshot(), [source], old);
    expect(prepared.batch).toHaveLength(1);
    expect(prepared.aliases.s1.text).toBe('');
  });
  it('rejects a quiz-backed goal even if model JSON is valid', () => {
    const source = eventSources(data().events[0]);
    const p = prepareClassroomMemory(emptySnapshot(), source, []);
    expect(() =>
      applyClassroomMemory(
        p,
        JSON.stringify({
          status: 'ready',
          sections: [{ section: 'goals', pieceIds: ['new:1'] }],
          pieces: [
            { id: 'new:1', text: 'Wrong global goal', formation: 'synthesis', supports: ['e1'] },
          ],
          retired: [],
          decisions: [{ source: 'e1', action: 'adopt', pieceIds: ['new:1'], reason: 'bad' }],
        }),
      ),
    ).toThrow('PROFILE_MEMORY_SOURCE_SECTION');
  });
  it('deduplicates identical events and rejects conflicting versions', () => {
    const d = data();
    expect(validateInputs([...d.events, d.events[0]], d.questions).duplicates).toBe(1);
    expect(() =>
      validateInputs([...d.events, { ...d.events[0], ordinal: 99 }], d.questions),
    ).toThrow('EVENT_VERSION_CONFLICT');
  });
  it('rejects wrong order and unknown QA source references', () => {
    const d = data();
    expect(() =>
      validateInputs([{ ...d.events[0], occurredAt: '2027-01-01T00:00:00.000Z' }, d.events[1]], []),
    ).toThrow('EVENT_ORDER_CONFLICT');
    expect(() => validateInputs(d.events, [{ ...d.questions[0], sourceIds: ['missing'] }])).toThrow(
      'QUESTION_SOURCE_UNKNOWN',
    );
  });
  it('represents public outcomes without manufacturing a submitted answer', () => {
    const e = data().events[0];
    const p = eventSources({
      ...e,
      origin: 'public',
      parts: [{ question: 'Q', review: 'incorrect', help: 'unknown' }],
    });
    const text = JSON.parse(p[0].text);
    expect(text.answer).toBeUndefined();
    expect(text.answerAvailable).toBe(false);
    expect(p[0].conditions).toEqual([]);
  });
  it('rejects duplicate, missing and invented extraction references', () => {
    const b = eventSources(data().events[0]);
    for (const facts of [
      [],
      [{ source: 'e2', text: 'x' }],
      [
        { source: 'e1', text: 'x' },
        { source: 'e1', text: 'y' },
      ],
    ])
      expect(() => extractSources(JSON.stringify({ facts }), b)).toThrow();
    const compressed = extractSources('{"facts":[{"source":"e1","text":null}]}', b);
    expect(compressed[0].conditions).toEqual(b[0].conditions);
    expect(JSON.parse(compressed[0].text).worthRetaining).toBe(false);
  });
  it('reports extraction failures without adopting old snapshots as successful', async () => {
    const s = session(async (r) =>
      r.stage === 'extract'
        ? { ...(await fixture(r, AbortSignal.abort())), text: 'not-json' }
        : fixture(r, AbortSignal.abort()),
    );
    const arm = await replay(data().events.slice(0, 3), 'two-stage', s);
    expect(arm.complete).toBe(false);
    expect(arm.steps[0].status).toBe('failed');
    expect(arm.snapshot.revision).toBe(0);
    const answers = await answerQuestions(arm, data().questions, s);
    expect(answers.every((a) => a.error === 'INCOMPLETE_REPLAY')).toBe(true);
  });
  it('fails on deferred work instead of counting the state as fully maintained', async () => {
    const s = session(async (r) =>
      r.stage === 'memory'
        ? {
            ...(await fixture(r, AbortSignal.abort())),
            text: JSON.stringify({
              status: 'ready',
              sections: [],
              pieces: [],
              retired: [],
              decisions: [{ source: 'e1', action: 'defer', pieceIds: [], reason: 'not ready' }],
            }),
          }
        : fixture(r, AbortSignal.abort()),
    );
    expect((await replay(data().events.slice(0, 1), 'direct', s)).complete).toBe(false);
  });
  it('never exposes support bodies or restricted text in Memory-only input', () => {
    const source = eventSources(data().events[0])[0];
    source.text = 'SECRET_SOURCE_BODY';
    const snap = emptySnapshot<typeof source>();
    snap.sections.goals = ['p', 'hidden'];
    snap.pieces = [
      {
        id: 'p',
        text: 'allowed',
        formation: 'synthesis',
        conditions: [],
        restrictions: [],
        supports: [source],
      },
      {
        id: 'hidden',
        text: 'RESTRICTED',
        formation: 'synthesis',
        conditions: [],
        restrictions: ['flag'],
        supports: [source],
      },
    ];
    expect(memoryText(snap)).toContain('allowed');
    expect(memoryText(snap)).not.toMatch(/SECRET_SOURCE_BODY|RESTRICTED/);
  });
  it('blocks public materials in live mode before sending any model call', async () => {
    const d = data(),
      s = session();
    await expect(
      runExperiment(
        d.events.map((e) => ({ ...e, origin: 'public' })),
        d.questions,
        configSchema.parse({ mode: 'live', model: 'x' }),
        s,
      ),
    ).rejects.toThrow('PUBLIC_EXTERNAL');
    expect(s.calls).toHaveLength(0);
  });
  it('retains missing scores and failures in expected and paired denominators', async () => {
    const d = data(),
      s = session(fixture, { maxCalls: 1 });
    const r = await runExperiment(d.events, d.questions, s.config, s);
    const report = summarize(r.results, d.questions, s.calls);
    expect(report.methods[0].categories[0].expected).toBe(2);
    expect(report.paired[0].commonScored).toBe(0);
    expect(report.methods[0].categories[0].accuracy).toBeNull();
  });
  it('does not automatically retry an unknown timeout outcome', async () => {
    const s = session(async () => new Promise(() => {}), { timeoutMs: 100, maxRetries: 2 });
    await expect(
      s.call({ stage: 'answer', system: 's', user: 'u', fixtureReply: '{}' }),
    ).rejects.toThrow('CALL_TIMEOUT');
    expect(s.calls).toHaveLength(1);
  });
  it('requires explicit human adjudication and reports pending rows', () => {
    expect(reviewSummary([{ judgment: null }])).toEqual({
      supported: 0,
      contradicted: 0,
      insufficient: 0,
      pending: 1,
      reviewed: 0,
      supportRate: null,
    });
    expect(() => reviewSummary([{ judgment: 'supported', reviewer: null }])).toThrow(
      'REVIEW_FORMAT_INVALID',
    );
  });
});
