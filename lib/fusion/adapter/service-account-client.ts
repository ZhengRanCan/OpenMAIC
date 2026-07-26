import type { ServiceAccessTokenProvider } from '../credentials/secret-manager';
import type { LeasedOutboxMessage, OutboxReceipt } from '../outbox/postgres-store';
import type { CapabilityCircuitBreakers, FusionCapability } from '../reliability/circuit-breaker';

export class DeepTutorServiceAccountClient {
  constructor(
    private readonly baseUrl: string,
    private readonly accessTokens: ServiceAccessTokenProvider,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly circuits?: CapabilityCircuitBreakers,
  ) {}

  async submit(message: LeasedOutboxMessage): Promise<OutboxReceipt> {
    const capability: FusionCapability =
      message.kind === 'classroom_event' ? 'classroom-event-write' : 'profile-update-submit';
    const operation = async (): Promise<OutboxReceipt> => {
      const token = await this.accessTokens.getAccessToken([
        'classroom-event:write',
        'profile-update:submit',
      ]);
      const path =
        message.kind === 'classroom_event'
          ? '/api/v1/fusion/real-classroom-events'
          : '/api/v1/fusion/real-profile-updates';
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
      if (response.ok) {
        const receipt = (await response.json()) as { status?: unknown; reasonCode?: unknown };
        if (receipt.status === 'accepted' || receipt.status === 'queued' || receipt.status === 'duplicate') {
          return {
            status: receipt.status,
            ...(typeof receipt.reasonCode === 'string' ? { reasonCode: receipt.reasonCode } : {}),
          };
        }
        if (receipt.status === 'rejected') {
          return {
            status: 'rejected',
            ...(typeof receipt.reasonCode === 'string' ? { reasonCode: receipt.reasonCode } : {}),
          };
        }
        throw new Error('DeepTutor returned an invalid delivery receipt');
      }
      throw Object.assign(new Error(`DeepTutor submission failed with ${response.status}`), {
        status: response.status,
      });
    };
    return this.circuits ? this.circuits.run(capability, operation) : operation();
  }
}
