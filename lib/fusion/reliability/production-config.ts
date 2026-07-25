export class ProductionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionConfigurationError';
  }
}

export interface ProductionFusionConfig {
  postgresSecretRef: string;
  secretManagerProvider: string;
  workloadIdentityProvider?: string;
  serviceClientSecretRef?: string;
  circuitFailureThreshold: number;
  circuitCooldownMs: number;
}

const forbiddenPlaintextNames = [
  'DEEPTUTOR_FUSION_TOKEN',
  'DEEPTUTOR_SERVICE_TOKEN',
  'FUSION_DATABASE_URL',
  'FUSION_SERVICE_CLIENT_SECRET',
];

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new ProductionConfigurationError(`${name} is required in production`);
  return value;
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string): number {
  const value = Number(required(env, name));
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ProductionConfigurationError(`${name} must be a positive integer`);
  }
  return value;
}

/** Rejects unsafe production fallback before a Fusion route or worker starts. */
export function readProductionFusionConfig(
  env: NodeJS.ProcessEnv = process.env,
): ProductionFusionConfig {
  if (env.NODE_ENV !== 'production') {
    throw new ProductionConfigurationError(
      'Production Fusion configuration requires NODE_ENV=production',
    );
  }
  for (const name of forbiddenPlaintextNames) {
    if (env[name])
      throw new ProductionConfigurationError(
        `${name} must be a Secret Manager reference, not plaintext`,
      );
  }
  if (
    env.FUSION_MOCK_ENABLED === 'true' ||
    env.FUSION_STORAGE_DRIVER === 'sqlite' ||
    env.FUSION_STORAGE_DRIVER === 'memory'
  ) {
    throw new ProductionConfigurationError(
      'Mock, SQLite, and in-memory Fusion storage are forbidden in production',
    );
  }
  const workloadIdentityProvider = env.FUSION_WORKLOAD_IDENTITY_PROVIDER;
  const serviceClientSecretRef = env.FUSION_SERVICE_CLIENT_SECRET_REF;
  if (!workloadIdentityProvider && !serviceClientSecretRef) {
    throw new ProductionConfigurationError(
      'Workload Identity or FUSION_SERVICE_CLIENT_SECRET_REF is required',
    );
  }
  return {
    postgresSecretRef: required(env, 'FUSION_POSTGRES_SECRET_REF'),
    secretManagerProvider: required(env, 'FUSION_SECRET_MANAGER_PROVIDER'),
    ...(workloadIdentityProvider ? { workloadIdentityProvider } : {}),
    ...(serviceClientSecretRef ? { serviceClientSecretRef } : {}),
    circuitFailureThreshold: positiveInteger(env, 'FUSION_CIRCUIT_FAILURE_THRESHOLD'),
    circuitCooldownMs: positiveInteger(env, 'FUSION_CIRCUIT_COOLDOWN_MS'),
  };
}
