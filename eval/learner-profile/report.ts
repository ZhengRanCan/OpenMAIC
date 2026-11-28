import { eventSources, type ArmResult } from './engine';
import type { CallRecord, Event, Question, Method } from './contracts';
import { explicitUnknown } from './prompts';

export function validationSummary(calls: CallRecord[]) {
  const identified = calls.filter(
    (c) => c.logicalCallId !== undefined && c.validationAttempt !== undefined,
  );
  const attempts = new Map<string, CallRecord>();
  for (const c of identified) attempts.set(`${c.logicalCallId}:${c.validationAttempt}`, c);
  const first = [...attempts.values()].filter((c) => c.validationAttempt === 0);
  const corrected = [...attempts.values()].filter((c) => (c.validationAttempt ?? 0) > 0);
  const firstRequests = identified.filter(
    (c) => c.validationAttempt === 0 && (c.transportAttempt ?? 0) === 0,
  );
  return {
    firstAttempts: first.length,
    firstPasses: first.filter((c) => c.validationOutcome === 'passed').length,
    firstFailures: first.filter((c) => c.validationOutcome === 'failed').length,
    firstUnavailable: first.filter((c) => c.validationOutcome === undefined).length,
    firstRequestPasses: firstRequests.filter((c) => !c.error || c.errorPhase === 'response').length,
    firstRequestFailures: firstRequests.filter((c) => c.errorPhase === 'transport').length,
    transportRetries: calls.filter((c) => (c.transportAttempt ?? 0) > 0).length,
    transportFailures: calls.filter((c) => c.errorPhase === 'transport').length,
    responseFailures: calls.filter((c) => c.errorPhase === 'response').length,
    correctionAttempts: corrected.length,
    correctionPasses: corrected.filter((c) => c.validationOutcome === 'passed').length,
    correctionFailures: corrected.filter((c) => c.validationOutcome === 'failed').length,
    correctionUnavailable: corrected.filter((c) => c.validationOutcome === undefined).length,
    validationFailures: calls.filter((c) => c.validationError).length,
    legacyUnidentifiedCalls: calls.filter((c) => c.logicalCallId === undefined).length,
  };
}

function pairwise(
  results: ArmResult[],
  questions: Question[],
  baseline: Method,
  comparison: Method,
) {
  return ['IE', 'MR', 'HC'].map((category) => {
    const differences: number[] = [];
    for (const q of questions.filter((q) => q.category === category)) {
      const find = (method: Method) =>
        results
          .find((a) => a.learnerId === q.learnerId && a.method === method)
          ?.answers.find((a) => a.id === q.id);
      const a = find(baseline),
        b = find(comparison);
      if (a && b && a.correct !== null && b.correct !== null)
        differences.push(Number(b.correct) - Number(a.correct));
    }
    return {
      baseline,
      comparison,
      category,
      commonScored: differences.length,
      difference: differences.length
        ? differences.reduce((a, b) => a + b, 0) / differences.length
        : null,
    };
  });
}

export function summarize(results: ArmResult[], questions: Question[], calls: CallRecord[]) {
  return {
    scoring: calls.every((c) => c.model === 'fixture-protocol-only')
      ? 'fixture-exact-v1'
      : 'local-semantic-v1',
    calls: calls.length,
    reportVersion: 'profile-eval-v3',
    metricPolicy:
      'accuracy = correct/scored; confirmedCorrectOverExpected is a conservative full-denominator result, not adjudication of unknown scores; explicitUnknown is a lexical signal, not a correctness rule',
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
    methods: [...new Set(results.map((r) => r.method))].map((method) => {
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
        stages: Object.fromEntries(
          ['extract', 'memory', 'answer', 'judge'].map((stage) => {
            const rows = costs.filter((c) => c.stage === stage);
            return [
              stage,
              {
                calls: rows.length,
                inputTokens: sumUsage(rows, 'inputTokens'),
                outputTokens: sumUsage(rows, 'outputTokens'),
                durationMs: rows.reduce((s, c) => s + c.durationMs, 0),
                validation: validationSummary(rows),
              },
            ];
          }),
        ),
        maintenance: {
          ...validationSummary(costs.filter((c) => c.stage === 'memory')),
          learnersWithoutCorrection: arms.filter(
            (a) =>
              a.complete &&
              !costs.some(
                (c) =>
                  c.learnerId === a.learnerId &&
                  (c.stage === 'memory' || c.stage === 'extract') &&
                  (c.validationError || (c.validationAttempt ?? 0) > 0),
              ),
          ).length,
          successfulSteps: arms.flatMap((a) => a.steps).filter((s) => s.status !== 'failed').length,
          failedSteps: arms.flatMap((a) => a.steps).filter((s) => s.status === 'failed').length,
        },
        categories: ['IE', 'MR', 'HC'].map((category) => {
          const expected = questions.filter((q) => q.category === category).length;
          const rows = answers.filter((a) => a.category === category),
            scored = rows.filter((a) => a.correct !== null);
          const correct = scored.filter((a) => a.correct).length;
          return {
            category,
            expected,
            answered: rows.filter((a) => a.answer !== null).length,
            scored: scored.length,
            correct,
            accuracy: scored.length ? correct / scored.length : null,
            confirmedCorrectOverExpected: expected ? correct / expected : null,
            scoringCoverage: expected ? scored.length / expected : null,
            unresolved: expected - scored.length,
            explicitUnknownAnswers: rows.filter((a) => explicitUnknown(a.answer)).length,
            explicitUnknownOverExpected: expected
              ? rows.filter((a) => explicitUnknown(a.answer)).length / expected
              : null,
            failures: rows.filter((a) => a.error).length,
          };
        }),
      };
    }),
    paired: pairwise(results, questions, 'direct', 'two-stage').map((r) => ({
      ...r,
      twoStageMinusDirect: r.difference,
    })),
    comparisons: (
      [
        ['direct', 'two-stage'],
        ['direct', 'raw-history'],
        ['two-stage', 'raw-history'],
      ] as const
    )
      .filter((pair) => pair.every((m) => results.some((r) => r.method === m)))
      .flatMap(([a, b]) => pairwise(results, questions, a, b)),
  };
}

function sumUsage(calls: CallRecord[], key: 'inputTokens' | 'outputTokens') {
  // Partial sums are separately labelled; an unavailable count is never zero.
  return {
    known: !calls.length
      ? 0
      : calls.some((c) => c[key] !== null)
        ? calls.reduce((s, c) => s + (c[key] ?? 0), 0)
        : null,
    missing: calls.filter((c) => c[key] === null).length,
  };
}

export function reviewRows(results: ArmResult[], events: Event[]) {
  return results.flatMap((arm) =>
    arm.snapshot.pieces.map((piece) => ({
      learnerId: arm.learnerId,
      method: arm.method,
      complete: arm.complete,
      lastCompletedCheckpoint:
        arm.steps.filter((s) => s.status !== 'failed').at(-1)?.checkpoint ?? 0,
      stoppedAt: arm.steps.at(-1)?.checkpoint ?? 0,
      snapshotRevision: arm.snapshot.revision,
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
  const groups = new Map<string, unknown[]>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') throw new Error('REVIEW_FORMAT_INVALID');
    const method = 'method' in item ? String(item.method) : 'legacy-unknown';
    const complete =
      'complete' in item && typeof item.complete === 'boolean' ? item.complete : null;
    const key = JSON.stringify({ method, complete });
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return {
    ...reviewCounts(raw),
    groups: [...groups].map(([key, rows]) => ({ ...JSON.parse(key), ...reviewCounts(rows) })),
  };
}

function reviewCounts(raw: unknown[]) {
  const counts = { supported: 0, contradicted: 0, insufficient: 0, pending: 0 };
  for (const value of raw) {
    if (!value || typeof value !== 'object') throw new Error('REVIEW_FORMAT_INVALID');
    const item = value as Record<string, unknown>;
    if (item.judgment === null) {
      counts.pending++;
      continue;
    }
    if (
      typeof item.judgment !== 'string' ||
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
