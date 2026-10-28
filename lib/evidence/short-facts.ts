import { createHash } from 'node:crypto';
import { canonicalJson, versionSource, type MemorySource } from '@/lib/learner-memory/contracts';

export const SHORT_FACTS_PROTOCOL = 'memory-evidence-v0.1';
const TYPES = [
  'correct_performance',
  'error_performance',
  'error_pattern',
  'performance_contrast',
] as const;
export type ShortFact = { type: (typeof TYPES)[number]; evidence: string; refs: string[] };
export type TraceRef = { questionIdentity: string; traceRef: string; conditions: string[] };
type Rejected = { sourceIndex: number; fact: unknown; codes: string[] };
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((key) => Object.hasOwn(v, key));

/** Structure and reference checks only; they do not establish semantic correctness. */
export function validateShortFacts(text: string, refs: Record<string, TraceRef>) {
  const invalid = (code: string) => ({
    status: 'invalid' as const,
    accepted: [] as { sourceIndex: number; fact: ShortFact }[],
    rejected: [] as Rejected[],
    diagnostics: [code],
  });
  if (typeof text !== 'string' || Buffer.byteLength(text) > 256000)
    return invalid('REPLY_SIZE_OR_TYPE');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalid('INVALID_JSON');
  }
  if (!exact(parsed, ['facts']) || !Array.isArray(parsed.facts)) return invalid('ENVELOPE');
  if (parsed.facts.length > 1000) return invalid('FACT_RESOURCE_LIMIT');
  const accepted: { sourceIndex: number; fact: ShortFact }[] = [],
    rejected: Rejected[] = [];
  parsed.facts.forEach((value: unknown, sourceIndex: number) => {
    const codes: string[] = [];
    if (!exact(value, ['type', 'evidence', 'refs'])) codes.push('FACT_SHAPE');
    const fact = value as Partial<ShortFact> | null;
    if (!TYPES.includes(fact?.type as ShortFact['type'])) codes.push('FACT_TYPE');
    if (
      typeof fact?.evidence !== 'string' ||
      !fact.evidence.trim() ||
      [...fact.evidence].length > 240
    )
      codes.push('EVIDENCE_LENGTH');
    if (
      !Array.isArray(fact?.refs) ||
      !fact.refs.length ||
      fact.refs.some((ref) => typeof ref !== 'string')
    )
      codes.push('REF_SHAPE');
    else {
      if (new Set(fact.refs).size !== fact.refs.length) codes.push('DUPLICATE_REF');
      if (fact.refs.some((ref) => !Object.hasOwn(refs, ref))) codes.push('UNKNOWN_REF');
      const valid = fact.refs.filter((ref) => Object.hasOwn(refs, ref));
      if (!valid.length) codes.push('ANSWER_REF_REQUIRED');
      if (
        fact.type === 'error_pattern' &&
        new Set(valid.map((ref) => refs[ref].questionIdentity)).size < 2
      )
        codes.push('TWO_DISTINCT_QUESTIONS_REQUIRED');
    }
    if (codes.length) rejected.push({ sourceIndex, fact: value, codes });
    else accepted.push({ sourceIndex, fact: fact as ShortFact });
  });
  return {
    status: rejected.length
      ? accepted.length
        ? ('partial' as const)
        : ('invalid' as const)
      : ('complete' as const),
    accepted,
    rejected,
    diagnostics: [] as string[],
  };
}

/** Caller supplies a saved immutable snapshot and trusted, question-level Trace bindings. */
export function shortFactSources(input: {
  student: 'A' | 'B' | 'C';
  runId: string;
  snapshotFile: string;
  snapshotBytes: Uint8Array;
  reply: string;
  refs: Record<string, TraceRef>;
  sourceNature: 'synthetic' | 'proxy';
  occurredAt: string | null;
}): { sources: MemorySource[]; validation: ReturnType<typeof validateShortFacts> } {
  if (!/^[\w-]{1,80}$/.test(input.runId)) throw new Error('INVALID_RUN_ID');
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(Buffer.from(input.snapshotBytes).toString('utf8'));
  } catch {
    throw new Error('INVALID_SNAPSHOT');
  }
  if (
    !exact(snapshot, ['facts', 'refs', 'student', 'runId', 'sourceNature', 'occurredAt']) ||
    canonicalJson(snapshot.refs) !== canonicalJson(input.refs) ||
    snapshot.student !== input.student ||
    snapshot.runId !== input.runId ||
    snapshot.sourceNature !== input.sourceNature ||
    snapshot.occurredAt !== input.occurredAt
  )
    throw new Error('SNAPSHOT_BINDING_MISMATCH');
  let replyFacts: unknown;
  try {
    replyFacts = JSON.parse(input.reply);
  } catch {
    throw new Error('INVALID_SNAPSHOT_REPLY');
  }
  if (
    !exact(replyFacts, ['facts']) ||
    canonicalJson(snapshot.facts) !== canonicalJson(replyFacts.facts)
  )
    throw new Error('SNAPSHOT_REPLY_MISMATCH');
  const validation = validateShortFacts(input.reply, input.refs);
  const sha256 = createHash('sha256').update(input.snapshotBytes).digest('hex');
  const sources = validation.accepted.map(({ sourceIndex, fact }) => {
    const trace = fact.refs.map((ref) => input.refs[ref]);
    return versionSource({
      id: `sim:${input.student}:f68:${input.runId}:${sourceIndex}`,
      kind: 'quiz_evidence',
      text: fact.evidence,
      refs: [...new Set(trace.map((item) => item.traceRef))],
      conditions: [...new Set(trace.flatMap((item) => item.conditions))],
      sourceNature: input.sourceNature,
      occurredAt: input.occurredAt,
      provenance: {
        file: input.snapshotFile,
        sha256,
        pointer: `/facts/${sourceIndex}`,
        bindings: fact.refs.map((ref) => `${ref}=${input.refs[ref].traceRef}`),
      },
    });
  });
  return { sources, validation };
}
