import { digest } from '@/lib/learner-memory/contracts';
import type { DialogueSourceWindow } from './trace-types';
import {
  DIALOGUE_CONTEXT_VERSION,
  DIALOGUE_EVIDENCE_PROTOCOL,
  DIALOGUE_LIMITS,
  type DialogueEvidenceContext,
  type DialogueFact,
  type DialogueReference,
} from './evidence-contracts';
import { DIALOGUE_EVIDENCE_SYSTEM } from './evidence-prompt';

export function buildDialogueEvidenceContext(
  source: DialogueSourceWindow,
): DialogueEvidenceContext {
  if (source.messages.length > 200) throw new Error('SOURCE_MESSAGE_LIMIT');
  const sourceIndex: Record<string, DialogueReference> = Object.create(null);
  const messageVersions: Record<string, string> = Object.create(null);
  const messages = source.messages.map(({ message, text }, index) => {
    if (Object.hasOwn(sourceIndex, message.id)) throw new Error('DUPLICATE_MESSAGE_ID');
    const metadata = message.metadata;
    const role =
      message.role === 'user' && (!metadata?.originalRole || metadata.originalRole === 'user')
        ? 'student'
        : message.role === 'assistant'
          ? 'agent'
          : 'unknown';
    const version = digest({
      id: message.id,
      role: message.role,
      parts: message.parts,
      originalRole: metadata?.originalRole ?? null,
      senderName: metadata?.senderName ?? null,
      agentId: metadata?.agentId ?? null,
      interrupted: metadata?.interrupted ?? null,
    });
    sourceIndex[message.id] = { role, messageId: message.id, version };
    messageVersions[message.id] = version;
    return {
      id: message.id,
      role,
      authorId: metadata?.agentId ?? null,
      authorName: metadata?.senderName ?? null,
      sequence: index + 1,
      createdAt: metadata?.createdAt ?? null,
      content: text,
      interrupted: metadata?.interrupted ?? null,
    };
  });
  const text = JSON.stringify({
    protocol: DIALOGUE_EVIDENCE_PROTOCOL,
    contextVersion: DIALOGUE_CONTEXT_VERSION,
    session: { id: source.chatSessionId, mode: source.type },
    initialContext: source.initialContext,
    window: source.window,
    messages,
    allowedRefs: messages.map((m) => m.id),
  });
  const inputBytes = Buffer.byteLength(DIALOGUE_EVIDENCE_SYSTEM) + Buffer.byteLength(text);
  return {
    text,
    sourceIndex,
    messageVersions,
    inputDigest: digest({ system: DIALOGUE_EVIDENCE_SYSTEM, text }),
    inputBytes,
    tooLarge: inputBytes > DIALOGUE_LIMITS.inputBytes,
  };
}
/** Identical source versions are shared support, never an independent performance counter. */
export function dialogueCandidateFingerprint(
  fact: DialogueFact,
  context: Pick<DialogueEvidenceContext, 'sourceIndex'>,
): string {
  return digest({
    type: fact.type,
    evidence: fact.evidence,
    refs: fact.refs
      .map((id) => context.sourceIndex[id])
      .sort((a, b) => a.messageId.localeCompare(b.messageId)),
  });
}
