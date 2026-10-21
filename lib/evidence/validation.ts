import { z } from 'zod';
import {
  conditionCodeSchema,
  EVIDENCE_LIMITS,
  EVIDENCE_SCHEMA_VERSION,
  type ConfirmedCondition,
  type EvidenceCapturedReply,
  type EvidenceContext,
  type EvidenceDeliveryCheck,
  type EvidenceSourceCard,
} from './contracts';

// Keep the envelope separate: one malformed candidate must not erase valid siblings.
const text = z
  .string()
  .max(8000)
  .refine((value) => value.trim().length > 0);
const texts = z.array(text).max(40);
const candidateSchema = z.strictObject({
  topic: text,
  taskScope: text,
  observations: texts,
  interpretation: text,
  limitations: texts,
  pairs: z
    .array(z.strictObject({ taskRef: text, answerRef: text }))
    .min(1)
    .max(40),
  citations: z
    .array(z.strictObject({ ref: text, quote: z.string().min(1).max(2000).optional() }))
    .min(1)
    .max(128),
  conditionRefs: z.array(text).max(128),
});
const envelopeSchema = z.strictObject({
  schemaVersion: z.literal(EVIDENCE_SCHEMA_VERSION),
  overview: z.strictObject({
    outcome: z.enum(['formed', 'no-new', 'insufficient']),
    inspectedRefs: texts,
    notes: texts,
    unfinished: texts,
  }),
  items: z.array(z.unknown()).max(16),
});
const conditionSchema = z.strictObject({
  code: conditionCodeSchema,
  submissionId: text,
  sourceFingerprint: text,
  origin: z.literal('f63-review'),
});

function failed(code: string): EvidenceDeliveryCheck {
  return { state: 'failed', overview: null, items: [], rejected: [], errors: [code] };
}

function source(context: EvidenceContext, ref: string): EvidenceSourceCard | undefined {
  return Object.hasOwn(context.sourceIndex, ref) ? context.sourceIndex[ref] : undefined;
}

function normalizeQuote(value: string): string {
  return value.replace(/\r\n/g, '\n').normalize('NFC');
}

function taskMatchesAnswer(task: EvidenceSourceCard, answer: EvidenceSourceCard): boolean {
  const left = task.scope,
    right = answer.scope;
  return Boolean(
    right.attemptId &&
    right.submissionId &&
    left.questionId &&
    left.taskDigest &&
    left.stageId === right.stageId &&
    left.sceneId === right.sceneId &&
    left.versionId === right.versionId &&
    left.questionId === right.questionId &&
    // taskDigest hashes the entire original question; contentDigest hashes only
    // the role-specific rendered card (which excludes reference answers).
    left.taskDigest === right.taskDigest,
  );
}

/**
 * Checks delivery and trace correspondence only. Natural-language support,
 * omissions, attribution and learning meaning remain semantically unreviewed.
 */
export function validateEvidenceOutput(
  reply: EvidenceCapturedReply,
  context: EvidenceContext,
): EvidenceDeliveryCheck {
  if (new TextEncoder().encode(reply.text).byteLength > EVIDENCE_LIMITS.outputBytes)
    return failed('OUTPUT_TOO_LARGE');
  if (!reply.text.trim()) return failed('EMPTY_OUTPUT');
  if (reply.finishReason !== 'stop') return failed('INCOMPLETE_OUTPUT');

  let decoded: unknown;
  try {
    decoded = JSON.parse(reply.text);
  } catch {
    return failed('INVALID_JSON');
  }
  const envelope = envelopeSchema.safeParse(decoded);
  if (!envelope.success) return failed('INVALID_OUTPUT_ENVELOPE');
  const { overview, items } = envelope.data;
  if (overview.inspectedRefs.some((ref) => !source(context, ref)))
    return failed('UNKNOWN_INSPECTED_REF');
  if (overview.outcome === 'formed' && items.length === 0) return failed('FORMED_WITHOUT_ITEMS');
  if (overview.outcome !== 'formed' && items.length !== 0) return failed('ZERO_OUTCOME_WITH_ITEMS');
  if (
    overview.outcome !== 'formed' &&
    overview.notes.length === 0 &&
    overview.unfinished.length === 0
  )
    return failed('ZERO_OUTCOME_WITHOUT_REASON');

  const check: EvidenceDeliveryCheck = {
    state: 'completed',
    overview,
    items: [],
    rejected: [],
    errors: [],
  };
  items.forEach((value, index) => {
    const parsed = candidateSchema.safeParse(value);
    if (!parsed.success) {
      check.rejected.push({ index, codes: ['INVALID_CANDIDATE'] });
      return;
    }
    const item = parsed.data,
      codes = new Set<string>(),
      submissionIds = new Set<string>();
    const cited = new Set(item.citations.map((citation) => citation.ref));
    for (const pair of item.pairs) {
      const task = source(context, pair.taskRef),
        answer = source(context, pair.answerRef);
      if (!task || !answer) {
        codes.add('UNKNOWN_PAIR_REF');
        continue;
      }
      if (task.role !== 'task' || answer.role !== 'answer') {
        codes.add('INVALID_PAIR_ROLE');
        continue;
      }
      if (!taskMatchesAnswer(task, answer)) codes.add('TASK_ANSWER_MISMATCH');
      if (answer.scope.submissionId) submissionIds.add(answer.scope.submissionId);
      if (!cited.has(pair.taskRef) || !cited.has(pair.answerRef)) codes.add('UNCITED_PAIR');
    }
    for (const citation of item.citations) {
      const card = source(context, citation.ref);
      if (!card) {
        codes.add('UNKNOWN_CITATION_REF');
        continue;
      }
      if (
        citation.quote !== undefined &&
        !normalizeQuote(card.renderedText).includes(normalizeQuote(citation.quote))
      )
        codes.add('QUOTE_NOT_IN_SOURCE');
    }
    for (const ref of item.conditionRefs) {
      const card = source(context, ref);
      if (!card) codes.add('UNKNOWN_CONDITION_REF');
      else if (card.role !== 'condition') codes.add('INVALID_CONDITION_ROLE');
      else if (!card.scope.submissionId || !submissionIds.has(card.scope.submissionId))
        codes.add('CONDITION_SCOPE_MISMATCH');
    }

    // These are trusted source bindings, not model-discovered semantic conditions.
    const conditions: ConfirmedCondition[] = [];
    const seenConditions = new Set<string>();
    for (const card of Object.values(context.sourceIndex)) {
      if (
        card.role !== 'condition' ||
        !card.scope.submissionId ||
        !submissionIds.has(card.scope.submissionId)
      )
        continue;
      const binding = conditionSchema.safeParse(card.condition);
      if (!binding.success || binding.data.submissionId !== card.scope.submissionId) {
        codes.add('INVALID_CONDITION_BINDING');
        continue;
      }
      const key = JSON.stringify(binding.data);
      if (!seenConditions.has(key)) {
        conditions.push(binding.data);
        seenConditions.add(key);
      }
    }
    if (codes.size) check.rejected.push({ index, codes: [...codes] });
    else check.items.push({ ...item, index, submissionIds: [...submissionIds].sort(), conditions });
  });
  if (check.rejected.length) check.state = 'partial';
  return check;
}
