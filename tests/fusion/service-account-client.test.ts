import { describe, expect, it, vi } from 'vitest';
import { DeepTutorServiceAccountClient } from '@/lib/fusion/adapter/service-account-client';
import type { LeasedOutboxMessage } from '@/lib/fusion/outbox/postgres-store';

describe('F20 restricted service-account delivery', () => {
  it('submits the original candidate and idempotency identifiers and preserves duplicate receipts', async () => {
    const submitted: Record<string, unknown>[] = [];
    let call = 0;
    const client = new DeepTutorServiceAccountClient(
      'http://dt.local',
      { getAccessToken: vi.fn(async () => crypto.randomUUID()) },
      async (_url, init) => {
        submitted.push(JSON.parse(String(init?.body)));
        call += 1;
        return new Response(JSON.stringify({ status: call === 1 ? 'accepted' : 'duplicate' }), {
          status: 200,
        });
      },
    );
    const message: LeasedOutboxMessage = {
      idempotencyKey: 'candidate-f20',
      candidateId: 'candidate-f20',
      kind: 'profile_update_candidate',
      lessonSessionId: 'lesson-f20',
      learnerKey: 'allowlisted-synthetic-learner',
      credentialRef: 'fusion/delegations/reference-only',
      payload: {
        schemaVersion: 'v1',
        candidateId: 'candidate-f20',
        idempotencyKey: 'candidate-f20',
        observations: [],
      },
      status: 'processing',
      attemptCount: 1,
      leaseOwner: 'worker-f20',
      leaseExpiresAt: '2030-01-01T00:00:00.000Z',
    };
    await expect(client.submit(message)).resolves.toMatchObject({ status: 'accepted' });
    await expect(client.submit(message)).resolves.toMatchObject({ status: 'duplicate' });
    expect(submitted).toEqual([
      expect.objectContaining({
        candidateId: message.candidateId,
        idempotencyKey: message.idempotencyKey,
        lessonSessionId: message.lessonSessionId,
        learnerKey: message.learnerKey,
      }),
      expect.objectContaining({
        candidateId: message.candidateId,
        idempotencyKey: message.idempotencyKey,
        lessonSessionId: message.lessonSessionId,
        learnerKey: message.learnerKey,
      }),
    ]);
  });
});
