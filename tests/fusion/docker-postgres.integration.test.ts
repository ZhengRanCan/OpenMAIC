import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { configureLocalPostgresFusionServices } from '@/lib/fusion/reliability/local-postgres-services';

const databaseUrl = process.env.FUSION_TEST_DATABASE_URL;
const describeDocker = databaseUrl ? describe : describe.skip;

describeDocker('F19 Docker PostgreSQL integration', () => {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let close: () => Promise<void>;
  let secretFile: string;
  let services: Awaited<ReturnType<typeof configureLocalPostgresFusionServices>>['services'];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const pool = new Pool({ connectionString: databaseUrl! });
    try {
      await pool.query('TRUNCATE fusion_outbox_operator_actions, fusion_outbox, fusion_sessions');
    } finally {
      await pool.end();
    }
    const directory = await mkdtemp(join(tmpdir(), 'openmaic-fusion-'));
    secretFile = join(directory, 'secrets.json');
    const configured = await configureLocalPostgresFusionServices({
      connectionString: databaseUrl!,
      secretFile,
      failureThreshold: 2,
      cooldownMs: 1,
    });
    services = configured.services;
    close = configured.close;
  });

  afterAll(async () => {
    if (close) await close();
    if (secretFile) await rm(secretFile, { force: true });
  });

  it('persists only credential references across a service restart', async () => {
    const lessonSessionId = `lesson-local-${runId}`;
    const credentialRef = await services.credentials.store({
      token: 'local-delegation-secret',
      tokenId: `local-token-${runId}`,
      learnerId: 'learner-1',
      audience: 'openmaic',
      scope: ['profile:read'],
      expiresAt: 9_999_999_999,
      lessonSessionId,
    });
    await services.sessions.create(
      {
        lessonSessionId,
        learnerId: 'learner-1',
        credentialRef,
        profileSnapshot: {},
        lessonKnowledgeMap: {},
        sceneCatalog: {},
        runtimeState: {},
        degradationState: 'none',
        snapshotCapturedAt: new Date().toISOString(),
        expiresAt: '2030-01-01T00:00:00.000Z',
      },
      `browser-token-${runId}`,
    );
    await close();
    const restarted = await configureLocalPostgresFusionServices({
      connectionString: databaseUrl!,
      secretFile,
      failureThreshold: 2,
      cooldownMs: 1,
    });
    services = restarted.services;
    close = restarted.close;
    const recovered = await services.sessions.recover(`browser-token-${runId}`);
    expect(recovered).toMatchObject({ credentialRef, learnerId: 'learner-1' });
    expect(JSON.stringify(recovered)).not.toContain('local-delegation-secret');
    expect((await services.credentials.get(credentialRef, lessonSessionId))?.token).toBe(
      'local-delegation-secret',
    );
  });

  it('allows exactly one concurrent lease and preserves the idempotency key after retry', async () => {
    const message = {
      idempotencyKey: `candidate-${runId}`,
      kind: 'profile_update_candidate' as const,
      lessonSessionId: `lesson-local-${runId}`,
      learnerKey: 'learner-1',
      credentialRef: `fusion/delegations/local-token-${runId}`,
      candidateId: `candidate-${runId}`,
      payload: { schemaVersion: 'v1', observations: [] },
    };
    await services.outbox.enqueue(message);
    const [first, second] = await Promise.all([
      services.outbox.acquire('worker-a', 30_000),
      services.outbox.acquire('worker-b', 30_000),
    ]);
    const leased = first ?? second;
    expect(leased).toBeDefined();
    expect([first, second].filter(Boolean)).toHaveLength(1);
    await services.outbox.complete(
      leased!,
      { status: 'queued', reasonCode: 'network_unavailable' },
      'transient',
      new Date(),
    );
    const retried = await services.outbox.acquire('worker-restarted', 30_000);
    expect(retried).toMatchObject({
      idempotencyKey: message.idempotencyKey,
      attemptCount: 2,
      leaseOwner: 'worker-restarted',
    });
  });

  it('purges payloads at the approved retention boundaries while preserving current rows', async () => {
    const now = new Date('2031-02-01T00:00:00.000Z');
    const old = new Date('2030-12-01T00:00:00.000Z');
    const oldMessage = {
      idempotencyKey: `old-${runId}`,
      kind: 'profile_update_candidate' as const,
      lessonSessionId: `lesson-old-${runId}`,
      learnerKey: 'learner-1',
      credentialRef: `ref-old-${runId}`,
      candidateId: `old-${runId}`,
      payload: { schemaVersion: 'v1' },
    };
    await services.outbox.enqueue(oldMessage, old);
    const leased = await services.outbox.acquire('worker-old', 30_000, old);
    await services.outbox.complete(leased!, { status: 'accepted' }, undefined, undefined, old);
    await expect(services.outbox.purgeExpired(now)).resolves.toMatchObject({ messages: 1 });
  });
});
