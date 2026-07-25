import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { ensureFusionOutboxSchema, PgFusionOutboxStore } from '@/lib/fusion/outbox/postgres-store';
import type { Queryable } from '@/lib/fusion/reliability/postgres';
import { CapabilityCircuitBreakers } from '@/lib/fusion/reliability/circuit-breaker';
import { classifyOutboxFailure, nextOutboxAttempt } from '@/lib/fusion/reliability/retry-policy';
import {
  ProductionConfigurationError,
  readProductionFusionConfig,
} from '@/lib/fusion/reliability/production-config';

describe('F19 PostgreSQL FusionOutboxStore', () => {
  let db: PGlite;
  let store: PgFusionOutboxStore;
  const now = new Date('2026-01-01T00:00:00.000Z');
  const message = {
    idempotencyKey: 'candidate-1',
    kind: 'profile_update_candidate' as const,
    lessonSessionId: 'lesson-1',
    learnerKey: 'learner-1',
    credentialRef: 'fusion/delegations/t-1',
    candidateId: 'candidate-1',
    payload: { schemaVersion: 'v1', observations: [] },
  };

  beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    await ensureFusionOutboxSchema(db as unknown as Queryable);
    store = new PgFusionOutboxStore(db as unknown as Queryable, (body) =>
      db.transaction((tx) => body(tx as unknown as Queryable)),
    );
  });
  afterEach(async () => {
    await db.close();
  });

  it('deduplicates, leases once, schedules bounded retry, and records an auditable replay', async () => {
    expect(await store.enqueue(message, now)).toBe(true);
    expect(await store.enqueue(message, now)).toBe(false);
    const leased = await store.acquire('worker-a', 30_000, now);
    expect(leased).toMatchObject({
      idempotencyKey: 'candidate-1',
      attemptCount: 1,
      leaseOwner: 'worker-a',
    });
    expect(
      await store.complete(
        leased!,
        { status: 'queued', reasonCode: 'offline' },
        'transient',
        nextOutboxAttempt(1, now, () => 0),
        now,
      ),
    ).toBe('retry_scheduled');
    const second = await store.acquire('worker-b', 30_000, new Date('2026-01-01T00:00:48.000Z'));
    expect(second).toBeDefined();
    const dead = await store.complete(
      second!,
      { status: 'rejected', reasonCode: 'schema_invalid' },
      'permanent',
      undefined,
      new Date('2026-01-01T00:00:48.000Z'),
    );
    expect(dead).toBe('dead_letter');
    await expect(
      store.replay(
        'candidate-1',
        { action: 'replay', operatorId: 'operator-1', reason: 'upstream schema fixed' },
        new Date('2026-01-01T01:00:00.000Z'),
      ),
    ).resolves.toBe(true);
  });

  it('never accepts credential-bearing payloads', async () => {
    await expect(
      store.enqueue({ ...message, idempotencyKey: 'leak', payload: { token: 'secret' } }, now),
    ).rejects.toThrow(/credential material/i);
  });
});

describe('F19 reliability policy', () => {
  it('keeps capability circuits independent and recovers after cooldown', async () => {
    let clock = 0;
    const circuits = new CapabilityCircuitBreakers({
      failureThreshold: 2,
      cooldownMs: 100,
      now: () => clock,
    });
    await expect(
      circuits.run('diagnosis', async () => {
        throw new Error('down');
      }),
    ).rejects.toThrow('down');
    await expect(
      circuits.run('diagnosis', async () => {
        throw new Error('down');
      }),
    ).rejects.toThrow('down');
    await expect(circuits.run('diagnosis', async () => 'blocked')).rejects.toThrow(
      'diagnosis_circuit_open',
    );
    await expect(circuits.run('profile-read', async () => 'available')).resolves.toBe('available');
    clock = 101;
    await expect(circuits.run('diagnosis', async () => 'recovered')).resolves.toBe('recovered');
  });

  it('only retries network, timeout, 429, and 5xx with bounded jitter', () => {
    expect(classifyOutboxFailure({ status: 429 })).toBe('transient');
    expect(classifyOutboxFailure({ code: 'ETIMEDOUT' })).toBe('transient');
    expect(classifyOutboxFailure({ status: 400 })).toBe('permanent');
    expect(nextOutboxAttempt(20, new Date(0), () => 1).getTime()).toBeLessThanOrEqual(
      30 * 60_000 * 1.2,
    );
  });

  it('fails closed if production storage, Secret Manager, identity, or circuit configuration is unsafe', () => {
    expect(() =>
      readProductionFusionConfig({ NODE_ENV: 'production', FUSION_STORAGE_DRIVER: 'sqlite' }),
    ).toThrow(ProductionConfigurationError);
    expect(() =>
      readProductionFusionConfig({
        NODE_ENV: 'production',
        FUSION_POSTGRES_SECRET_REF: 'ref',
        FUSION_SECRET_MANAGER_PROVIDER: 'platform',
        FUSION_WORKLOAD_IDENTITY_PROVIDER: 'workload',
        FUSION_CIRCUIT_FAILURE_THRESHOLD: '2',
        FUSION_CIRCUIT_COOLDOWN_MS: '30000',
        DEEPTUTOR_SERVICE_TOKEN: 'plaintext',
      }),
    ).toThrow(/plaintext/i);
  });
});
