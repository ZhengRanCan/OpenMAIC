import { describe, expect, it } from 'vitest';
import {
  parseDialogueBindings,
  matchDialogueBinding,
} from '@/lib/server/dialogue-evidence-provenance';
import type { DialogueSourceWindow } from '@/lib/dialogue/trace-types';

const binding = {
  ownerId: 'owner',
  stageId: 'stage',
  chatSessionId: 'chat',
  sourceDigest: 'a'.repeat(64),
  generationRunId: 'run',
  student: 'A',
  sourceNature: 'synthetic',
  conditions: ['authored fixture'],
  memoryEnvironmentId: '00000000-0000-4000-8000-000000000001',
};
const source = {
  ownerId: 'owner',
  stageId: 'stage',
  chatSessionId: 'chat',
  contentDigest: 'a'.repeat(64),
} as DialogueSourceWindow;
describe('trusted Dialogue provenance', () => {
  it('requires exact owner, session and saved content, never a supplied nickname', () => {
    const bindings = parseDialogueBindings({ version: 1, sources: [binding] });
    expect(
      matchDialogueBinding(source, { bindings, memoryEnvironmentId: binding.memoryEnvironmentId }),
    ).toEqual(binding);
    for (const changed of [
      { ownerId: 'foreign' },
      { stageId: 'other' },
      { chatSessionId: 'other' },
      { contentDigest: 'b'.repeat(64) },
    ])
      expect(
        matchDialogueBinding(
          { ...source, ...changed },
          { bindings, memoryEnvironmentId: binding.memoryEnvironmentId },
        ),
      ).toBeNull();
    expect(matchDialogueBinding(source, { bindings, memoryEnvironmentId: 'other' })).toBeNull();
  });
  it('rejects ambiguous bindings and untrusted extra fields', () => {
    for (const sources of [
      [binding, { ...binding, student: 'B' }],
      [{ ...binding, nickname: 'A' }],
      [{ ...binding, sourceNature: 'real' }],
    ])
      expect(() => parseDialogueBindings({ version: 1, sources })).toThrow(
        'INVALID_DIALOGUE_BINDINGS',
      );
  });
  it('allows distinct content versions of the same Session', () => {
    expect(
      parseDialogueBindings({
        version: 1,
        sources: [binding, { ...binding, sourceDigest: 'b'.repeat(64) }],
      }),
    ).toHaveLength(2);
  });
});
