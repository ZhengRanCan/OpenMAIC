import { randomUUID } from 'node:crypto';
import { DeepTutorServiceAccountClient } from '../adapter/service-account-client';
import { ensureFusionServices, isProductionFusion } from '../reliability/production-services';
import { processOnePostgres } from './worker';

/**
 * Local integration composition for a separately-run worker.  It requires a
 * server-side service-account reference and never falls back to delegation.
 */
export async function processOneConfiguredFusionOutbox(): Promise<void> {
  if (!isProductionFusion()) throw new Error('persistent_fusion_mode_required');
  const services = await ensureFusionServices();
  const baseUrl = process.env.DEEPTUTOR_FUSION_BASE_URL;
  if (!baseUrl || !services.serviceAccessTokens) {
    throw new Error('service_account_configuration_required');
  }
  await processOnePostgres(
    services.outbox,
    `local-worker-${randomUUID()}`,
    new DeepTutorServiceAccountClient(baseUrl, services.serviceAccessTokens, undefined, services.circuits),
  );
}
