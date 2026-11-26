import { eventSources, type ArmResult } from './engine';
import type { CallRecord, Event, Question } from './contracts';

export function summarize(results: ArmResult[], questions: Question[], calls: CallRecord[]) {
  return {
    scoring: calls.every((c) => c.model === 'fixture-protocol-only')
      ? 'fixture-exact-v1'
      : 'local-semantic-v1',
    calls: calls.length,
    failedCalls: calls.filter((c) => c.error).length,
    inputTokens: sumUsage(calls, 'inputTokens'),
    outputTokens: sumUsage(calls, 'outputTokens'),
    missingUsageCalls: calls.filter((c) => c.inputTokens === null || c.outputTokens === null)
      .length,
    durationMs: calls.reduce((sum, c) => sum + c.durationMs, 0),
    byStage: Object.fromEntries(
      ['extract', 'memory', 'answer', 'judge'].map((stage) => [
        stage,
        {
          calls: calls.filter((c) => c.stage === stage).length,
          failures: calls.filter((c) => c.stage === stage && c.error).length,
        },
      ]),
    ),
    methods: ['direct', 'two-stage'].map((method) => {
      const arms = results.filter((r) => r.method === method),
        answers = arms.flatMap((r) => r.answers);
      const costs = calls.filter((c) => c.method === method);
      return {
        method,
        learners: arms.length,
        completed: arms.filter((a) => a.complete).length,
        calls: costs.length,
        inputTokens: sumUsage(costs, 'inputTokens'),
        outputTokens: sumUsage(costs, 'outputTokens'),
        durationMs: costs.reduce((s, c) => s + c.durationMs, 0),
        categories: ['IE', 'MR', 'HC'].map((category) => {
          const rows = answers.filter((a) => a.category === category),
            scored = rows.filter((a) => a.correct !== null);
          return {
            category,
            expected: questions.filter((q) => q.category === category).length,
            answered: rows.filter((a) => a.answer !== null).length,
            scored: scored.length,
            correct: scored.filter((a) => a.correct).length,
            accuracy: scored.length ? scored.filter((a) => a.correct).length / scored.length : null,
            failures: rows.filter((a) => a.error).length,
          };
        }),
      };
    }),
    paired: ['IE', 'MR', 'HC'].map((category) => {
      const differences: number[] = [];
      for (const q of questions.filter((q) => q.category === category)) {
        const pair = results
          .filter((a) => a.learnerId === q.learnerId)
          .map((a) => a.answers.find((r) => r.id === q.id));
        if (pair.length === 2 && pair.every((a) => a && a.correct !== null))
          differences.push(Number(pair[1]!.correct) - Number(pair[0]!.correct));
      }
      return {
        category,
        commonScored: differences.length,
        twoStageMinusDirect: differences.length
          ? differences.reduce((a, b) => a + b, 0) / differences.length
          : null,
      };
    }),
  };
}

function sumUsage(calls: CallRecord[], key: 'inputTokens' | 'outputTokens') {
  // Partial sums are separately labelled; an unavailable count is never zero.
  return {
    known: calls.some((c) => c[key] !== null) ? calls.reduce((s, c) => s + (c[key] ?? 0), 0) : null,
    missing: calls.filter((c) => c[key] === null).length,
  };
}

export function reviewRows(results: ArmResult[], events: Event[]) {
  return results.flatMap((arm) =>
    arm.snapshot.pieces.map((piece) => ({
      learnerId: arm.learnerId,
      method: arm.method,
      pieceId: piece.id,
      statement: piece.text,
      sections: Object.entries(arm.snapshot.sections)
        .filter(([, ids]) => ids.includes(piece.id))
        .map(([s]) => s),
      supports: piece.supports,
      // A local reviewer can locate original records. This file never enters the answer prompt.
      sourceEvents: events.filter(
        (e) =>
          e.learnerId === arm.learnerId &&
          eventSources(e).some((s) =>
            piece.supports.some((p) => p.id === s.id && p.version === s.version),
          ),
      ),
      judgment: null as null | 'supported' | 'contradicted' | 'insufficient',
      reviewer: null as string | null,
      reason: null as string | null,
    })),
  );
}

export function reviewSummary(raw: unknown) {
  if (!Array.isArray(raw)) throw new Error('REVIEW_FORMAT_INVALID');
  const counts = { supported: 0, contradicted: 0, insufficient: 0, pending: 0 };
  for (const item of raw) {
    if (!item || typeof item !== 'object') throw new Error('REVIEW_FORMAT_INVALID');
    if (item.judgment === null) {
      counts.pending++;
      continue;
    }
    if (
      !['supported', 'contradicted', 'insufficient'].includes(item.judgment) ||
      typeof item.reason !== 'string' ||
      !item.reason.trim() ||
      typeof item.reviewer !== 'string' ||
      !item.reviewer.trim()
    )
      throw new Error('REVIEW_FORMAT_INVALID');
    counts[item.judgment as 'supported' | 'contradicted' | 'insufficient']++;
  }
  const reviewed = counts.supported + counts.contradicted + counts.insufficient;
  return { ...counts, reviewed, supportRate: reviewed ? counts.supported / reviewed : null };
}
