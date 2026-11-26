import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { configSchema, type Invoker } from '@/eval/learner-profile/contracts';
import { validateInputs, runExperiment, rawHistoryContext } from '@/eval/learner-profile/engine';
import { ModelSession } from '@/eval/learner-profile/model';
import { summarize } from '@/eval/learner-profile/report';

const input = () =>
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
describe('F114 three-arm architecture pilot', () => {
  it('preserves F113 defaults and rejects repeated method configurations', () => {
    expect(configSchema.parse({}).methods).toEqual(['direct', 'two-stage']);
    expect(() => configSchema.parse({ methods: ['raw-history', 'raw-history'] })).toThrow();
  });
  it('uses the same answer system and exact source history for the reference arm', async () => {
    const d = input(),
      c = configSchema.parse({ methods: ['direct', 'two-stage', 'raw-history'] }),
      s = new ModelSession(c, fixture);
    const r = await runExperiment(d.events, d.questions, c, s);
    expect(r.results).toHaveLength(6);
    const raw = s.calls.filter((c) => c.method === 'raw-history');
    expect(raw.every((c) => c.stage === 'answer' || c.stage === 'judge')).toBe(true);
    expect(raw.filter((c) => c.stage === 'answer')).toHaveLength(4);
    expect(new Set(s.calls.filter((c) => c.stage === 'answer').map((c) => c.system)).size).toBe(1);
    const first = raw.find((c) => c.stage === 'answer')!;
    const context = JSON.parse(first.user).learningContext;
    expect(context).toBe(rawHistoryContext(d.events.filter((e) => e.learnerId === 'synthetic-a')));
    expect(context).not.toContain(d.questions[0].gold + 'GOLD_SENTINEL');
    expect(
      r.results
        .filter((a) => a.method === 'raw-history')
        .every((a) => a.steps.length === 0 && a.snapshot.pieces.length === 0),
    ).toBe(true);
    const report = summarize(r.results, d.questions, s.calls);
    expect(report.methods).toHaveLength(3);
    expect(report.comparisons).toHaveLength(9);
    expect(report.paired[0].commonScored).toBe(2);
    expect(report.methods[2].stages.memory.calls).toBe(0);
  });
  it('does not expose labels or another learner to raw history answering', async () => {
    const d = input();
    d.questions[0].gold = 'GOLD_SENTINEL';
    const c = configSchema.parse({ methods: ['raw-history'] }),
      s = new ModelSession(c, fixture);
    await runExperiment(d.events, d.questions, c, s);
    expect(
      s.calls.filter((c) => c.stage === 'answer').every((c) => !c.user.includes('GOLD_SENTINEL')),
    ).toBe(true);
    expect(
      s.calls
        .filter((c) => c.learnerId === 'synthetic-b' && c.stage === 'answer')
        .every((c) => !c.user.includes('接下来这一周')),
    ).toBe(true);
  });
  it('fails rather than truncates full history when the fixed answer budget is exceeded', async () => {
    const d = input(),
      c = configSchema.parse({ methods: ['raw-history'], maxAnswerInputBytes: 1000 }),
      s = new ModelSession(c, fixture);
    d.events[0].parts[0].question = '长题面'.repeat(500);
    const r = await runExperiment(d.events, d.questions, c, s);
    expect(r.results[0].answers.every((a) => a.error === 'ANSWER_INPUT_CAPACITY_EXCEEDED')).toBe(
      true,
    );
    expect(s.calls.filter((c) => c.learnerId === 'synthetic-a')).toHaveLength(0);
    expect(summarize(r.results, d.questions, s.calls).methods[0].categories[0].expected).toBe(2);
  });
});
