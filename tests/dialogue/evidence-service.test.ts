import { describe, expect, it, vi } from 'vitest';
import { extractDialogueEvidence } from '@/lib/server/dialogue-evidence';
import type {
  DialogueEvidenceRun,
  DialogueClaim,
  DialogueCapturedReply,
  DialogueEvidenceSettings,
} from '@/lib/dialogue/evidence-contracts';

const run = {
  id: 'run',
  state: 'prepared',
  model: { provider: 'p' },
  system: 'system',
  context: { text: 'user' },
} as unknown as DialogueEvidenceRun;
function setup(state = 'prepared') {
  const current = { ...run, state } as DialogueEvidenceRun;
  const store = {
    claim: vi.fn(async (): Promise<DialogueClaim | null> => ({ runId: 'run', token: 'token' })),
    capture: vi.fn(
      async (
        _owner: string,
        _claim: DialogueClaim,
        _reply: DialogueCapturedReply,
        _settings: DialogueEvidenceSettings,
      ) => {},
    ),
    finalize: vi.fn(async () => current),
  };
  const read = vi.fn(async () => current);
  const invoke = vi.fn(async () => ({
    text: '{"facts":[]}',
    finishReason: 'stop',
    usage: null,
    actualModel: 'p',
    receivedAt: '2026-11-03T00:00:00Z',
    durationMs: 1,
  }));
  const settings = vi.fn(async () => ({ bindings: [], memoryEnvironmentId: '' }));
  return { current, store, read, invoke, settings };
}
describe('Dialogue extraction single invocation', () => {
  it('retries saving the same reply, never the model', async () => {
    const f = setup();
    f.store.capture.mockRejectedValueOnce(new Error('db connection lost'));
    await extractDialogueEvidence(
      'owner',
      run.id,
      run.model,
      f.store,
      f.read,
      f.invoke,
      f.settings,
    );
    expect(f.invoke).toHaveBeenCalledTimes(1);
    expect(f.store.capture).toHaveBeenCalledTimes(2);
    expect(f.store.capture.mock.calls[0][2]).toBe(f.store.capture.mock.calls[1][2]);
  });
  it.each([
    'unknown',
    'completed',
    'empty',
    'invalid',
    'truncated',
    'blocked',
    'revoked',
    'calling',
  ])('does not invoke for %s', async (state) => {
    const f = setup(state);
    await extractDialogueEvidence(
      'owner',
      run.id,
      run.model,
      f.store,
      f.read,
      f.invoke,
      f.settings,
    );
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it('finalizes a captured reply with zero external calls', async () => {
    const f = setup('captured');
    await extractDialogueEvidence(
      'owner',
      run.id,
      run.model,
      f.store,
      f.read,
      f.invoke,
      f.settings,
    );
    expect(f.store.finalize).toHaveBeenCalled();
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it('blocks model changes before claim and no-op claim before network', async () => {
    const f = setup();
    await expect(
      extractDialogueEvidence(
        'owner',
        run.id,
        { ...run.model, provider: 'changed' },
        f.store,
        f.read,
        f.invoke,
        f.settings,
      ),
    ).rejects.toMatchObject({ code: 'MODEL_CONFIG_CHANGED' });
    expect(f.store.claim).not.toHaveBeenCalled();
    f.store.claim.mockResolvedValueOnce(null!);
    await extractDialogueEvidence(
      'owner',
      run.id,
      run.model,
      f.store,
      f.read,
      f.invoke,
      f.settings,
    );
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it('captures an exception as unknown with unknown usage and hides raw error details', async () => {
    const f = setup();
    f.invoke.mockRejectedValueOnce(new Error('secret endpoint'));
    await extractDialogueEvidence(
      'owner',
      run.id,
      run.model,
      f.store,
      f.read,
      f.invoke,
      f.settings,
    );
    const captured = f.store.capture.mock.calls[0][2];
    expect(captured).toMatchObject({ text: '', finishReason: 'unknown', usage: null });
    expect(JSON.stringify(captured)).not.toContain('secret');
  });
});
