import type { SecretManagerDelegationCredentialStore } from '../credentials/secret-manager';
import type { PgFusionOutboxStore } from '../outbox/postgres-store';
import type { PgFusionSessionStore } from '../session-store/postgres';
import type { CapabilityCircuitBreakers } from './circuit-breaker';
import { ProductionConfigurationError, readProductionFusionConfig } from './production-config';

export interface ProductionFusionServices {
  credentials: SecretManagerDelegationCredentialStore;
  sessions: PgFusionSessionStore;
  outbox: PgFusionOutboxStore;
  circuits: CapabilityCircuitBreakers;
}

let configured: ProductionFusionServices | undefined;

/** Called by the deployment composition root after it has resolved platform secrets and created a PG pool. */
export function configureProductionFusionServices(services: ProductionFusionServices): void {
  configured = services;
}

export function requireProductionFusionServices(): ProductionFusionServices {
  readProductionFusionConfig();
  if (!configured) {
    throw new ProductionConfigurationError(
      'Production Fusion services have not been configured by the server composition root',
    );
  }
  return configured;
}

export function isProductionFusion(): boolean {
  return process.env.NODE_ENV === 'production';
}
