import { z } from 'zod';
import {
  DIALOGUE_LIMITS,
  type DialogueEvidenceContext,
  type DialogueFact,
} from './evidence-contracts';

const envelope = z.strictObject({
  facts: z
    .array(
      z.strictObject({
        type: z.enum(['learning_performance', 'question_help']),
        evidence: z.string().refine((s) => !!s.trim() && [...s].length <= 240),
        refs: z.array(z.string().min(1)).min(1).max(200),
      }),
    )
    .max(DIALOGUE_LIMITS.maxFacts),
});

/** Structure and author checks only. Semantic support still needs separate review. */
export function validateDialogueEvidenceReply(
  reply: { text: string; finishReason: string },
  context: Pick<DialogueEvidenceContext, 'sourceIndex'>,
): {
  state: 'completed' | 'empty' | 'invalid' | 'truncated' | 'unknown';
  facts: DialogueFact[];
  diagnostics: string[];
} {
  const reject = (state: 'invalid' | 'truncated' | 'unknown', code: string) => ({
    state,
    facts: [],
    diagnostics: [code],
  });
  if (reply.finishReason === 'length') return reject('truncated', 'INCOMPLETE_OUTPUT');
  if (reply.finishReason !== 'stop') return reject('unknown', 'EXECUTION_UNKNOWN');
  if (Buffer.byteLength(reply.text) > DIALOGUE_LIMITS.outputBytes)
    return reject('invalid', 'OUTPUT_TOO_LARGE');
  let value: unknown;
  try {
    value = JSON.parse(reply.text);
  } catch {
    return reject('invalid', 'INVALID_JSON');
  }
  const parsed = envelope.safeParse(value);
  if (!parsed.success) return reject('invalid', 'INVALID_FACTS');
  for (const fact of parsed.data.facts) {
    if (new Set(fact.refs).size !== fact.refs.length) return reject('invalid', 'DUPLICATE_REF');
    if (fact.refs.some((id) => !Object.hasOwn(context.sourceIndex, id)))
      return reject('invalid', 'UNKNOWN_REF');
    if (!fact.refs.some((id) => context.sourceIndex[id].role === 'student'))
      return reject('invalid', 'STUDENT_REF_REQUIRED');
  }
  return {
    state: parsed.data.facts.length ? 'completed' : 'empty',
    facts: parsed.data.facts,
    diagnostics: [],
  };
}
