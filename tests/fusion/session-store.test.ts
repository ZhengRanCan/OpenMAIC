import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  PgFusionSessionStore,
  ensureFusionSessionSchema,
} from '@/lib/fusion/session-store/postgres';
import type { Queryable } from '@/lib/fusion/reliability/postgres';

describe('F19 PostgreSQL FusionSessionStore', () => {
  let db: PGlite;
  let store: PgFusionSessionStore;

  beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    await ensureFusionSessionSchema(db as unknown as Queryable);
    store = new PgFusionSessionStore(db as unknown as Queryable, (body) =>
      db.transaction((tx) => body(tx as unknown as Queryable)),
    );
  });
  afterEach(async () => {
    await db.close();
  });

  const create = (token = 'browser-token') =>
    store.create(
      {
        lessonSessionId: 'lesson-1',
        learnerId: 'learner-1',
        credentialRef: 'fusion/delegations/t-1',
        profileSnapshot: {},
        lessonKnowledgeMap: {},
        sceneCatalog: {},
        runtimeState: {},
        degradationState: 'none',
        snapshotCapturedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-01-01T01:00:00.000Z',
        now: new Date('2026-01-01T00:00:00.000Z'),
      },
      token,
    );

  it('persists a token-hashed, credential-reference-only session and uses CAS', async () => {
    await create();
    const record = await store.recover('browser-token', new Date('2026-01-01T00:30:00.000Z'));
    expect(record).toMatchObject({
      lessonSessionId: 'lesson-1',
      credentialRef: 'fusion/delegations/t-1',
      revision: 0,
    });
    expect(JSON.stringify(record)).not.toContain('browser-token');
    const next = await store.compareAndSet('lesson-1', 0, (current) => ({
      ...current,
      runtimeState: { scene: 'checkpoint' },
    }));
    expect(next).toMatchObject({ revision: 1, runtimeState: { scene: 'checkpoint' } });
    await expect(store.compareAndSet('lesson-1', 0, (current) => current)).resolves.toBeUndefined();
  });

  it('does not recover expired sessions and supports privacy deletion', async () => {
    await create();
    await expect(
      store.recover('browser-token', new Date('2026-01-01T02:00:00.000Z')),
    ).resolves.toBeUndefined();
    await expect(store.deleteForLearner('learner-1')).resolves.toBe(1);
  });
});
