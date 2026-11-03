import { describe, it, expect } from 'vitest';
import { readDialogueLoopConfig } from '@/lib/server/dialogue-learning-loop/config';
import { learningClosureSchema, recoverySchema } from '@/lib/dialogue/learning-loop-contracts';

const simulation = JSON.stringify({
  sourceNature: 'synthetic',
  conditions: ['controlled isolated data'],
  memoryEnvironmentId: '00000000-0000-4000-8000-000000000075',
});
describe('automatic dialogue opt-in and recovery boundary', () => {
  it('defaults off and requires explicit isolated attribution when enabled', () => {
    expect(readDialogueLoopConfig({})).toBeNull();
    expect(() => readDialogueLoopConfig({ OPENMAIC_AUTOMATIC_DIALOGUE_LOOP: 'true' })).toThrow();
    const c = readDialogueLoopConfig({
      OPENMAIC_AUTOMATIC_DIALOGUE_LOOP: 'true',
      OPENMAIC_SIMULATED_LEARNING_LOOP: simulation,
    });
    expect(c?.memoryEnvironmentId).toBe('00000000-0000-4000-8000-000000000075');
    expect(c?.sourceNature).toBe('synthetic');
  });
  it('does not turn soft-close entry, error or arbitrary state into a completed closure', () => {
    for (const source of [
      'manual_stop',
      'scene_switch',
      'turn_complete',
      'soft_close_confirmed',
      'soft_close_timeout',
    ])
      expect(learningClosureSchema.safeParse({ id: 'close-1', source }).success).toBe(true);
    for (const source of ['soft_close_enter', 'error', 'restore'])
      expect(learningClosureSchema.safeParse({ id: 'close-1', source }).success).toBe(false);
  });
  it('rejects injected facts, identities and unacknowledged paid retry', () => {
    expect(recoverySchema.safeParse({ action: 'retry_memory', operationId: 'op' }).success).toBe(
      false,
    );
    expect(
      recoverySchema.safeParse({ action: 'resume_saved', operationId: 'op', student: 'A' }).success,
    ).toBe(false);
    expect(
      recoverySchema.safeParse({
        action: 'retry_memory',
        operationId: 'op',
        acknowledgeAdditionalCall: true,
      }).success,
    ).toBe(true);
  });
});
