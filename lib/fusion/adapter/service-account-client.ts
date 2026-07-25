import type { ServiceAccessTokenProvider } from '../credentials/secret-manager';
import type { LeasedOutboxMessage, OutboxReceipt } from '../outbox/postgres-store';

export class DeepTutorServiceAccountClient {
  constructor(
    private readonly baseUrl: string,
    private readonly accessTokens: ServiceAccessTokenProvider,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async submit(message: LeasedOutboxMessage): Promise<OutboxReceipt> {
    const token = await this.accessTokens.getAccessToken([
      'classroom-event:write',
      'profile-update:submit',
    ]);
    const path =
      message.kind === 'classroom_event'
        ? '/api/v1/fusion/classroom-events'
        : '/api/v1/fusion/profile-updates';
    const response = await this.fetchFn(`${this.baseUrl.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...message.payload,
        lessonSessionId: message.lessonSessionId,
        learnerKey: message.learnerKey,
        idempotencyKey: message.idempotencyKey,
        ...(message.eventId ? { eventId: message.eventId } : {}),
        ...(message.candidateId ? { candidateId: message.candidateId } : {}),
      }),
    });
    if (response.ok) return { status: 'accepted' };
    throw Object.assign(new Error(`DeepTutor submission failed with ${response.status}`), {
      status: response.status,
    });
  }
}
