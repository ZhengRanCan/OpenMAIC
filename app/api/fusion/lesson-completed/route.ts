import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { completePersistentLesson } from '@/lib/fusion/persistent-lesson';
import { ensureFusionServices, isProductionFusion } from '@/lib/fusion/reliability/production-services';
import type { OutboxDeliveryState } from '@/lib/fusion/outbox/postgres-store';

function deliveryState(
  delivery: OutboxDeliveryState | undefined,
  fallback: 'queued' | 'duplicate' | 'save_failed',
) {
  if (!delivery) return fallback;
  if (delivery.status === 'delivered') return delivery.receipt?.status ?? 'accepted';
  if (delivery.status === 'retry_scheduled') return 'retry_scheduled';
  if (delivery.status === 'dead_letter') return 'dead_letter';
  return 'queued';
}

/** Finalise only the server-owned classroom session; browser IDs are ignored. */
export async function POST(request: NextRequest) {
  if (!isProductionFusion()) {
    return apiError('INVALID_REQUEST', 409, 'Lesson completion requires persistent Fusion storage.');
  }
  const browserSessionToken = request.cookies.get('openmaic_fusion_session')?.value;
  if (!browserSessionToken) return apiError('INVALID_CREDENTIALS', 401, 'A Fusion classroom session is required.');
  try {
    const services = await ensureFusionServices();
    const session = await services.sessions.recover(browserSessionToken);
    if (!session) return apiError('INVALID_CREDENTIALS', 401, 'The Fusion classroom session has expired.');
    const summary = await completePersistentLesson(services, session);
    if (summary.profileUpdate !== 'save_failed') {
      await services.sessions.compareAndSet(session.lessonSessionId, session.revision, (current) => ({
        ...current,
        completedAt: new Date().toISOString(),
      }));
    }
    const delivery = summary.idempotencyKey
      ? await services.outbox.getDelivery(summary.idempotencyKey)
      : undefined;
    const state = deliveryState(delivery, summary.profileUpdate);
    return apiSuccess({
      summary: {
        ...summary,
        deliveryState: state,
        ...(delivery?.reasonCode ? { reasonCode: delivery.reasonCode } : {}),
      },
      deliveryState: state,
    });
  } catch {
    return apiError('UPSTREAM_ERROR', 503, 'Fusion classroom storage is unavailable.');
  }
}
