import { CapabilityCircuitBreakers } from './circuit-breaker';
import { Pool } from 'pg';
import { DevelopmentFileSecretProvider } from '../credentials/development-file-secret-provider';
import {
  SecretManagerDelegationCredentialStore,
  SecretManagerServiceAccessTokenProvider,
} from '../credentials/secret-manager';
import { ensureFusionOutboxSchema, PgFusionOutboxStore } from '../outbox/postgres-store';
import { ensureFusionSessionSchema, PgFusionSessionStore } from '../session-store/postgres';
import { ensureFusionLessonFactsSchema } from '../persistent-lesson';
import {
  clearProductionFusionServices,
  configureProductionFusionServices,
  type ProductionFusionServices,
} from './production-services';
import type { Queryable, WithTransaction } from './postgres';

interface LocalPostgresPool extends Queryable {
  connect(): Promise<Queryable & { release(): void }>;
  end(): Promise<void>;
}

function transactionFor(pool: LocalPostgresPool): WithTransaction {
  return async <T>(body: (queryable: Queryable) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await body(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
}

/** Explicit local-only composition; `pg` is a direct server dependency. */
export async function configureLocalPostgresFusionServices(options: {
  connectionString: string;
  secretFile: string;
  failureThreshold: number;
  cooldownMs: number;
}): Promise<{ services: ProductionFusionServices; close(): Promise<void> }> {
  if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
    throw new Error('Local PostgreSQL Fusion services are only available in development or test');
  }
  const pool = new Pool({
    connectionString: options.connectionString,
  }) as unknown as LocalPostgresPool;
  const transaction = transactionFor(pool);
  await ensureFusionSessionSchema(pool);
  await ensureFusionOutboxSchema(pool);
  await ensureFusionLessonFactsSchema(pool);
  const secretProvider = new DevelopmentFileSecretProvider(options.secretFile);
  const serviceAccountRef = process.env.FUSION_LOCAL_SERVICE_ACCOUNT_REF;
  const services: ProductionFusionServices = {
    credentials: new SecretManagerDelegationCredentialStore(secretProvider),
    ...(serviceAccountRef
      ? { serviceAccessTokens: new SecretManagerServiceAccessTokenProvider(secretProvider, serviceAccountRef) }
      : {}),
    sessions: new PgFusionSessionStore(pool, transaction),
    outbox: new PgFusionOutboxStore(pool, transaction),
    circuits: new CapabilityCircuitBreakers({
      failureThreshold: options.failureThreshold,
      cooldownMs: options.cooldownMs,
    }),
  };
  configureProductionFusionServices(services);
  return {
    services,
    async close() {
      clearProductionFusionServices(services);
      await pool.end();
    },
  };
}
