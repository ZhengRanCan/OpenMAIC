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

export function clearProductionFusionServices(services: ProductionFusionServices): void {
  if (configured === services) configured = undefined;
}

export function requireProductionFusionServices(): ProductionFusionServices {
  if (process.env.NODE_ENV === 'production') readProductionFusionConfig();
  if (!configured) {
    throw new ProductionConfigurationError(
      'Production Fusion services have not been configured by the server composition root',
    );
  }
  return configured;
}

export function isProductionFusion(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.FUSION_PERSISTENCE_MODE === 'local_postgres'
  );
}

/** Lazily composes the explicit Docker PostgreSQL path; production remains host-composed. */
export async function ensureFusionServices(): Promise<ProductionFusionServices> {
  if (configured) return configured;
  if (process.env.FUSION_PERSISTENCE_MODE !== 'local_postgres')
    return requireProductionFusionServices();
  const connectionString = process.env.FUSION_LOCAL_POSTGRES_URL;
  const secretFile = process.env.FUSION_LOCAL_SECRET_FILE;
  if (!connectionString || !secretFile)
    throw new ProductionConfigurationError(
      'FUSION_LOCAL_POSTGRES_URL and FUSION_LOCAL_SECRET_FILE are required for local_postgres',
    );
  const failureThreshold = Number(process.env.FUSION_LOCAL_CIRCUIT_FAILURE_THRESHOLD ?? '2');
  const cooldownMs = Number(process.env.FUSION_LOCAL_CIRCUIT_COOLDOWN_MS ?? '30000');
  if (
    !Number.isSafeInteger(failureThreshold) ||
    failureThreshold < 1 ||
    !Number.isSafeInteger(cooldownMs) ||
    cooldownMs < 1
  ) {
    throw new ProductionConfigurationError(
      'Local Fusion circuit settings must be positive integers',
    );
  }
  const { configureLocalPostgresFusionServices } = await import('./local-postgres-services');
  const configuredLocal = await configureLocalPostgresFusionServices({
    connectionString,
    secretFile,
    failureThreshold,
    cooldownMs,
  });
  return configuredLocal.services;
}
