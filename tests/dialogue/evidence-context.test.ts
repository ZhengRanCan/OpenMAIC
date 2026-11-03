import { describe, expect, it } from 'vitest';
import type { DialogueSourceWindow } from '@/lib/dialogue/trace-types';
import {
  buildDialogueEvidenceContext,
  dialogueCandidateFingerprint,
} from '@/lib/dialogue/evidence-context';
import { DIALOGUE_EVIDENCE_SYSTEM } from '@/lib/dialogue/evidence-prompt';

function source(): DialogueSourceWindow {
  return {
    sourceVersion: 'dialogue-source.v1',
    ownerId: 'owner',
    stageId: 'stage',
    chatSessionId: 'chat',
    runtimeSessionId: 'runtime',
    generation: 0,
    type: 'qa',
    title: 'QA',
    status: 'completed',
    createdAt: 1,
    updatedAt: 2,
    initialContext: null,
    window: { maxMessages: 200, historyCompleteness: 'window-only' },
    contentDigest: 'a'.repeat(64),
    messages: [
      {
        message: {
          id: '__proto__',
          role: 'user',
          parts: [{ type: 'text', text: ' 为什么？\n' }],
          metadata: { createdAt: 1 },
        },
        text: ' 为什么？\n',
      },
      {
        message: {
          id: 't',
          role: 'assistant',
          parts: [{ type: 'text', text: '提示' }],
          metadata: {
            originalRole: 'teacher',
            senderAvatar: 'private',
            interrupted: true,
            agentId: 'tutor',
          },
        },
        text: '提示',
      },
    ],
  };
}
describe('Dialogue Evidence input', () => {
  it('keeps exact text, unknown context, role, order and interruption without avatar/tool metadata', () => {
    const context = buildDialogueEvidenceContext(source());
    const input = JSON.parse(context.text);
    expect(input.initialContext).toBeNull();
    expect(input.messages[0]).toMatchObject({
      id: '__proto__',
      role: 'student',
      content: ' 为什么？\n',
      sequence: 1,
    });
    expect(input.messages[1]).toMatchObject({
      role: 'agent',
      interrupted: true,
      authorId: 'tutor',
    });
    expect(context.text).not.toContain('private');
    expect(Object.hasOwn(context.sourceIndex, '__proto__')).toBe(true);
    expect(context.sourceIndex.__proto__.role).toBe('student');
  });
  it('ignores generation and technical timestamps in message version identities', () => {
    const original = source(),
      changed = structuredClone(original);
    changed.generation++;
    changed.updatedAt++;
    changed.messages[0].message.metadata!.createdAt = 99;
    expect(buildDialogueEvidenceContext(changed).messageVersions).toEqual(
      buildDialogueEvidenceContext(original).messageVersions,
    );
    changed.messages[0].message.parts = [{ type: 'text', text: '修订' }];
    changed.messages[0].text = '修订';
    expect(buildDialogueEvidenceContext(changed).messageVersions).not.toEqual(
      buildDialogueEvidenceContext(original).messageVersions,
    );
  });
  it('does not silently trim 201 messages or duplicated message IDs', () => {
    const s = source();
    s.messages = Array.from({ length: 201 }, (_, i) => ({
      ...s.messages[0],
      message: { ...s.messages[0].message, id: String(i) },
    }));
    expect(() => buildDialogueEvidenceContext(s)).toThrow('SOURCE_MESSAGE_LIMIT');
    s.messages = [source().messages[0], source().messages[0]];
    expect(() => buildDialogueEvidenceContext(s)).toThrow('DUPLICATE_MESSAGE_ID');
  });
  it('checks the full system plus user byte size without clipping', () => {
    const s = source();
    s.messages[0].text = 'x';
    s.messages[0].message.parts = [{ type: 'text', text: 'x' }];
    const c = buildDialogueEvidenceContext(s);
    const padding = 128 * 1024 - c.inputBytes;
    s.messages[0].text += 'x'.repeat(padding);
    s.messages[0].message.parts = [{ type: 'text', text: s.messages[0].text }];
    expect(buildDialogueEvidenceContext(s).inputBytes).toBe(128 * 1024);
    s.messages[0].text += 'x';
    const over = buildDialogueEvidenceContext(s);
    expect(over.tooLarge).toBe(true);
    expect(over.text).toContain(s.messages[0].text);
    expect(over.inputBytes).toBe(
      Buffer.byteLength(DIALOGUE_EVIDENCE_SYSTEM) + Buffer.byteLength(over.text),
    );
  });
  it('gives stable candidate identity for the same actual message versions regardless of reference order', () => {
    const c = buildDialogueEvidenceContext(source());
    const f = {
      type: 'question_help' as const,
      evidence: '学生求助，教师给出提示。',
      refs: ['__proto__', 't'],
    };
    expect(dialogueCandidateFingerprint(f, c)).toBe(
      dialogueCandidateFingerprint({ ...f, refs: ['t', '__proto__'] }, c),
    );
    expect(dialogueCandidateFingerprint({ ...f, evidence: '其他' }, c)).not.toBe(
      dialogueCandidateFingerprint(f, c),
    );
  });
});
