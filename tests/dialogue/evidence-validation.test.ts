import { describe, expect, it } from 'vitest';
import { validateDialogueEvidenceReply } from '@/lib/dialogue/evidence-validation';
import type { DialogueEvidenceContext } from '@/lib/dialogue/evidence-contracts';

const context: Pick<DialogueEvidenceContext, 'sourceIndex'> = {
  sourceIndex: Object.fromEntries([
    ['s', { role: 'student', messageId: 's', version: 'v1' }],
    ['a', { role: 'agent', messageId: 'a', version: 'v2' }],
  ]),
};
const fact = {
  type: 'learning_performance',
  evidence: '在教师提示后正确算出4。',
  refs: ['s', 'a'],
};
const check = (facts: unknown[], finishReason = 'stop') =>
  validateDialogueEvidenceReply({ text: JSON.stringify({ facts }), finishReason }, context);
describe('Dialogue Evidence validation', () => {
  it('accepts both categories, keeps all refs and allows empty', () => {
    expect(check([fact, { ...fact, type: 'question_help' }]).state).toBe('completed');
    expect(check([])).toMatchObject({ state: 'empty', facts: [], diagnostics: [] });
  });
  it('counts Unicode code points, not UTF-16 units', () => {
    expect(check([{ ...fact, evidence: '😀'.repeat(240) }]).state).toBe('completed');
    expect(check([{ ...fact, evidence: '😀'.repeat(241) }]).state).toBe('invalid');
  });
  it.each([
    { ...fact, refs: [] },
    { ...fact, refs: ['a'] },
    { ...fact, refs: ['s', 'missing'] },
    { ...fact, refs: ['s', 's'] },
    { ...fact, refs: ['toString'] },
    { ...fact, type: 'correct_performance' },
    { ...fact, evidence: '   ' },
    { ...fact, extra: true },
  ])('rejects invalid fact as a whole, without leaking valid siblings', (bad) => {
    expect(check([fact, bad])).toMatchObject({ state: 'invalid', facts: [] });
  });
  it.each(['length', 'error', 'unknown', 'content-filter'])(
    'does not accept %s as successful empty',
    (reason) => {
      const result = check([], reason);
      expect(result.state).toBe(reason === 'length' ? 'truncated' : 'unknown');
    },
  );
  it('requires exact JSON envelope and bounded reply', () => {
    for (const text of [
      '```json\n{"facts":[]}\n```',
      '{}',
      '{"facts":[],"mastery":true}',
      'x'.repeat(256001),
    ]) {
      expect(validateDialogueEvidenceReply({ text, finishReason: 'stop' }, context).state).toBe(
        'invalid',
      );
    }
  });
});
