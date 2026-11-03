import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { DIALOGUE_MEMORY_SYSTEM } from '@/lib/learner-memory/dialogue-prompt';
import {
  SIMULATED_MEMORY_SYSTEM,
  SIMULATED_PROMPT_SHA256,
} from '@/lib/learner-memory/simulated-prompt';
describe('Dialogue-compatible Memory prompt', () => {
  it('keeps the frozen previous System and extends memory.v2 without forcing adoption', () => {
    expect(createHash('sha256').update(SIMULATED_MEMORY_SYSTEM).digest('hex')).toBe(
      SIMULATED_PROMPT_SHA256,
    );
    expect(DIALOGUE_MEMORY_SYSTEM).toContain(SIMULATED_MEMORY_SYSTEM);
    for (const text of [
      'dialogue_evidence',
      'question_help',
      'learning_performance',
      'synthesis',
      '共同',
      '帮助',
      'defer',
    ])
      expect(DIALOGUE_MEMORY_SYSTEM).toContain(text);
  });
});
