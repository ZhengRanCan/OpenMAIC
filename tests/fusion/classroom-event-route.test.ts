import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PGlite } from '@electric-sql/pglite';
import { POST } from '@/app/api/fusion/classroom-events/route';
import { ClassroomDiagnosisAdapter } from '@/lib/fusion/adapter/classroom-diagnosis-adapter';
import { CapabilityCircuitBreakers } from '@/lib/fusion/reliability/circuit-breaker';
import {
  clearProductionFusionServices,
  configureProductionFusionServices,
} from '@/lib/fusion/reliability/production-services';
import { ensureFusionOutboxSchema, PgFusionOutboxStore } from '@/lib/fusion/outbox/postgres-store';
import { ensureFusionLessonFactsSchema } from '@/lib/fusion/persistent-lesson';
import {
  ensureFusionSessionSchema,
  PgFusionSessionStore,
} from '@/lib/fusion/session-store/postgres';
import type { Queryable } from '@/lib/fusion/reliability/postgres';
import { DEVELOPMENT_SCENE_CATALOG } from '@/lib/fusion/scene-catalog';
import { createLessonRuntimeState } from '@/lib/fusion/lesson-runtime-state';
import { classroomObservationLedger } from '@/lib/fusion/classroom-observation-ledger';

function request(body: unknown) {
  return new NextRequest('http://openmaic.local/api/fusion/classroom-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('F09 classroom event route', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('rejects malformed browser facts without accepting learner overrides', async () => {
    const response = await POST(
      request({ question: 'q', localAssessment: { gradingMode: 'local' }, learnerId: 'forged' }),
    );
    expect(response.status).toBe(400);
  });
  it('degrades safely when diagnosis is unavailable', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('FUSION_DEVELOPMENT_MOCK_ENABLED', 'true');
    vi.stubEnv('FUSION_PERSISTENCE_MODE', '');
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', '');
    const response = await POST(
      request({
        question: '2 + 2 = ?',
        answer: '3',
        localAssessment: { gradingMode: 'local', correctness: 'incorrect' },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      diagnosis: null,
      reasonCode: 'diagnosis_unavailable',
      continue: true,
    });
  });
  it('plans a remediation directive for an incorrect F08 diagnosis without leaking transport details', async () => {
    vi.spyOn(ClassroomDiagnosisAdapter.prototype, 'diagnoseCheckpoint').mockResolvedValue({
      schemaVersion: 'v1',
      eventId: 'ignored',
      correctness: 'incorrect',
      diagnoses: [],
      teachingIntent: {
        schemaVersion: 'v1',
        kind: 'insert_remediation',
        targetLessonKnowledgePointIds: ['lesson-linear-function-slope'],
        recommendedStrategy: 'development_mock_concrete_example',
      },
      warnings: [],
      createdAt: '2026-07-24T00:00:00Z',
    });
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('FUSION_DEVELOPMENT_MOCK_ENABLED', 'true');
    vi.stubEnv('FUSION_PERSISTENCE_MODE', '');
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://deeptutor.local');
    const response = await POST(
      request({
        question: 'q',
        answer: 'wrong',
        localAssessment: { gradingMode: 'local', correctness: 'incorrect' },
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      diagnosis: { correctness: 'incorrect' },
      directive: { kind: 'insert_remediation', targetSceneId: 'remediate-slope-concrete' },
    });
  });
});

describe('F20 authoritative persistent classroom event route', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('ignores browser identity overrides and updates only the recovered session via real diagnosis', async () => {
    const db = new PGlite();
    await db.waitReady;
    const queryable = db as unknown as Queryable;
    await ensureFusionSessionSchema(queryable);
    await ensureFusionOutboxSchema(queryable);
    await ensureFusionLessonFactsSchema(queryable);
    const transaction = <T>(body: (connection: Queryable) => Promise<T>): Promise<T> =>
      db.transaction((connection) => body(connection as unknown as Queryable));
    const sessions = new PgFusionSessionStore(queryable, transaction);
    const outbox = new PgFusionOutboxStore(queryable, transaction);
    const browserToken = crypto.randomUUID();
    const lessonSessionId = 'authoritative-f20-session';
    const learnerId = 'allowlisted-synthetic-learner';
    await sessions.create(
      {
        lessonSessionId,
        learnerId,
        credentialRef: 'fusion/delegations/reference-only',
        profileSnapshot: { schemaVersion: 'v1', learnerId },
        lessonKnowledgeMap: {
          schemaVersion: 'v1',
          mappingId: 'integration-test-map',
          mappingRevision: '1',
          knowledgePoints: [
            {
              lessonKnowledgePointId: 'lesson-linear-function-slope',
              authoritativeRef: { namespace: 'test', scopeId: 'lesson', id: 'slope' },
            },
          ],
        },
        sceneCatalog: JSON.parse(JSON.stringify(DEVELOPMENT_SCENE_CATALOG)),
        runtimeState: JSON.parse(JSON.stringify(createLessonRuntimeState())),
        degradationState: 'none',
        snapshotCapturedAt: new Date().toISOString(),
        expiresAt: '2030-01-01T00:00:00.000Z',
      },
      browserToken,
    );
    const services = {
      sessions,
      outbox,
      credentials: {
        get: vi.fn(async () => ({
          token: crypto.randomUUID(),
          tokenId: 'runtime-only',
          learnerId,
          audience: 'openmaic',
          scope: ['diagnosis:request'],
          expiresAt: 9_999_999_999,
          lessonSessionId,
        })),
      },
      circuits: new CapabilityCircuitBreakers({ failureThreshold: 2, cooldownMs: 1 }),
    };
    configureProductionFusionServices(services as never);
    vi.stubEnv('FUSION_PERSISTENCE_MODE', 'local_postgres');
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://dt.local');
    vi.stubEnv('FUSION_DEVELOPMENT_MOCK_ENABLED', 'false');
    let submitted: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        submitted = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            schemaVersion: 'v1',
            eventId: submitted!.eventId,
            correctness: 'incorrect',
            diagnoses: [],
            teachingIntent: {
              schemaVersion: 'v1',
              kind: 'insert_remediation',
              targetLessonKnowledgePointIds: ['lesson-linear-function-slope'],
              recommendedStrategy: 'development_mock_concrete_example',
            },
            warnings: [],
            createdAt: new Date().toISOString(),
          }),
          { status: 200 },
        );
      }),
    );
    const response = await POST(
      new NextRequest('http://openmaic.local/api/fusion/classroom-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `openmaic_fusion_session=${browserToken}`,
        },
        body: JSON.stringify({
          question: 'synthetic question',
          answer: 'synthetic answer',
          learnerId: 'forged-learner',
          lessonSessionId: 'forged-session',
          localAssessment: { gradingMode: 'synthetic', correctness: 'incorrect' },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(submitted).toMatchObject({
      lessonSessionId,
      lessonKnowledgePointIds: ['lesson-linear-function-slope'],
    });
    expect(JSON.stringify(submitted)).not.toContain('forged-learner');
    expect((await sessions.get(lessonSessionId))?.runtimeState).toMatchObject({
      currentSceneId: 'remediate-slope-concrete',
    });
    clearProductionFusionServices(services as never);
    await db.close();
  });

  it('rolls back the Scene transition when durable classroom-fact storage fails', async () => {
    const db = new PGlite();
    await db.waitReady;
    const queryable = db as unknown as Queryable;
    await ensureFusionSessionSchema(queryable);
    await ensureFusionOutboxSchema(queryable);
    await ensureFusionLessonFactsSchema(queryable);
    const transaction = <T>(body: (connection: Queryable) => Promise<T>): Promise<T> =>
      db.transaction((connection) =>
        body({
          query: (statement, params) => {
            if (statement.includes('INSERT INTO fusion_classroom_facts')) {
              return Promise.reject(new Error('classroom facts unavailable'));
            }
            return (connection as unknown as Queryable).query(statement, params);
          },
        }),
      );
    const sessions = new PgFusionSessionStore(queryable, transaction);
    const browserToken = crypto.randomUUID();
    const lessonSessionId = 'rollback-f20-session';
    const learnerId = 'allowlisted-synthetic-learner';
    const initialRuntime = createLessonRuntimeState();
    await sessions.create(
      {
        lessonSessionId,
        learnerId,
        credentialRef: 'fusion/delegations/reference-only',
        profileSnapshot: { schemaVersion: 'v1', learnerId },
        lessonKnowledgeMap: {
          schemaVersion: 'v1',
          mappingId: 'integration-test-map',
          mappingRevision: '1',
          knowledgePoints: [
            {
              lessonKnowledgePointId: 'lesson-linear-function-slope',
              authoritativeRef: { namespace: 'test', scopeId: 'lesson', id: 'slope' },
            },
          ],
        },
        sceneCatalog: JSON.parse(JSON.stringify(DEVELOPMENT_SCENE_CATALOG)),
        runtimeState: JSON.parse(JSON.stringify(initialRuntime)),
        degradationState: 'none',
        snapshotCapturedAt: new Date().toISOString(),
        expiresAt: '2030-01-01T00:00:00.000Z',
      },
      browserToken,
    );
    const services = {
      sessions,
      outbox: { transaction },
      credentials: {
        get: vi.fn(async () => ({
          token: crypto.randomUUID(),
          tokenId: 'runtime-only',
          learnerId,
          audience: 'openmaic',
          scope: ['diagnosis:request'],
          expiresAt: 9_999_999_999,
          lessonSessionId,
        })),
      },
      circuits: new CapabilityCircuitBreakers({ failureThreshold: 2, cooldownMs: 1 }),
    };
    configureProductionFusionServices(services as never);
    vi.stubEnv('FUSION_PERSISTENCE_MODE', 'local_postgres');
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://dt.local');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const event = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            schemaVersion: 'v1',
            eventId: event.eventId,
            correctness: 'incorrect',
            diagnoses: [],
            teachingIntent: {
              schemaVersion: 'v1',
              kind: 'insert_remediation',
              targetLessonKnowledgePointIds: ['lesson-linear-function-slope'],
              recommendedStrategy: 'development_mock_concrete_example',
            },
            warnings: [],
            createdAt: new Date().toISOString(),
          }),
          { status: 200 },
        );
      }),
    );
    const response = await POST(
      new NextRequest('http://openmaic.local/api/fusion/classroom-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `openmaic_fusion_session=${browserToken}`,
        },
        body: JSON.stringify({
          question: 'synthetic question',
          answer: 'synthetic answer',
          localAssessment: { gradingMode: 'synthetic', correctness: 'incorrect' },
        }),
      }),
    );
    expect(response.status).toBe(503);
    await expect(sessions.get(lessonSessionId)).resolves.toMatchObject({
      revision: 0,
      runtimeState: initialRuntime,
    });
    clearProductionFusionServices(services as never);
    await db.close();
  });
});

describe('F46 formal scene catalog binding', () => {
  afterEach(() => vi.unstubAllEnvs());

  async function createFormalSession(catalog?: unknown, digest = 'sha256:'.concat('a'.repeat(64))) {
    const db = new PGlite();
    await db.waitReady;
    const queryable = db as unknown as Queryable;
    await ensureFusionSessionSchema(queryable);
    await ensureFusionOutboxSchema(queryable);
    await ensureFusionLessonFactsSchema(queryable);
    const transaction = <T>(body: (connection: Queryable) => Promise<T>): Promise<T> =>
      db.transaction((connection) => body(connection as unknown as Queryable));
    const sessions = new PgFusionSessionStore(queryable, transaction);
    const outbox = new PgFusionOutboxStore(queryable, transaction);
    const browserToken = crypto.randomUUID();
    const lessonSessionId = 'formal-f46-session';
    await sessions.create(
      {
        lessonSessionId,
        learnerId: 'allowlisted-synthetic-learner',
        credentialRef: 'fusion/delegations/reference-only',
        frozenLessonGenerationContext: {
          schemaVersion: 'v1',
          contextId: 'formal-context-1',
          semanticRequest: {
            semanticRequestId: 'req-1',
            semanticRequestRevision: 'r1',
            semanticRequestDigest: digest,
            normalizedTopic: 'linear functions',
            normalizedLearningObjectives: ['understand slope'],
            authorizedKnowledgeScope: { namespace: 'test', scopeId: 'course-1' },
            sourceRevisions: ['fixture'],
            createdAt: '2026-08-11T00:00:00.000Z',
          },
          proposal: {
            proposalId: 'proposal-1',
            basedOnSemanticRequestId: 'req-1',
            basedOnSemanticRequestRevision: 'r1',
            semanticRequestDigest: digest,
            resolutionStatus: 'ready',
            interpretedLessonSemantics: {
              normalizedTopic: 'linear functions',
              normalizedLearningObjectives: ['understand slope'],
            },
            lessonKnowledgeMap: {
              mappingId: 'semantic-map-1',
              mappingRevision: '1',
              knowledgeRefs: [{ namespace: 'test', scopeId: 'course-1', id: 'semantic-point-1' }],
            },
            learnerCognitiveProjection: {
              projectionRevision: '1',
              signals: ['insufficient_data'],
            },
            teachingGuidance: { guidanceRevision: '1', recommendedApproaches: ['worked-example'] },
            sourceRevisions: ['fixture'],
            clarificationIssues: [],
            warnings: [],
            createdAt: '2026-08-11T00:00:00.000Z',
          },
          resolution: {
            schemaVersion: 'v1',
            semanticRequestId: 'req-1',
            semanticRequestRevision: 'r1',
            semanticRequestDigest: digest,
            status: 'ready',
            clarificationIssues: [],
          },
          frozenAt: '2026-08-11T00:00:00.000Z',
        },
        sceneCatalog: catalog ? JSON.parse(JSON.stringify(catalog)) : undefined,
        runtimeState: JSON.parse(JSON.stringify(createLessonRuntimeState('checkpoint-1'))),
        degradationState: 'none',
        expiresAt: '2030-01-01T00:00:00.000Z',
      },
      browserToken,
    );
    const services = {
      sessions,
      outbox,
      credentials: {
        get: vi.fn(async () => ({
          token: crypto.randomUUID(),
          tokenId: 'runtime-only',
          learnerId: 'allowlisted-synthetic-learner',
          audience: 'openmaic',
          scope: ['diagnosis:request'],
          expiresAt: 9_999_999_999,
          lessonSessionId,
        })),
      },
      circuits: new CapabilityCircuitBreakers({ failureThreshold: 2, cooldownMs: 1 }),
    };
    configureProductionFusionServices(services as never);
    return { db, services, browserToken };
  }

  function formalCatalog(digest: string) {
    return {
      catalogId: 'fusion-scene-catalog-formal-1',
      catalogRevision: '1',
      semanticRequestDigest: digest,
      contextId: 'formal-context-1',
      entries: [
        {
          sceneId: 'teach-1',
          order: 1,
          role: 'teach',
          lessonKnowledgePointIds: ['semantic-point-1'],
          teachingStrategyTags: [],
        },
        {
          sceneId: 'checkpoint-1',
          order: 2,
          role: 'checkpoint',
          checkpointId: 'checkpoint-1',
          lessonKnowledgePointIds: ['semantic-point-1'],
          teachingStrategyTags: [],
        },
      ],
    };
  }

  function formalEventRequest(browserToken: string) {
    return new NextRequest('http://openmaic.local/api/fusion/classroom-events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `openmaic_fusion_session=${browserToken}`,
      },
      body: JSON.stringify({
        question: 'synthetic question',
        answer: 'synthetic answer',
        localAssessment: { gradingMode: 'synthetic', correctness: 'incorrect' },
      }),
    });
  }

  it('rejects formal events when the authoritative catalog is missing', async () => {
    vi.stubEnv('FUSION_PERSISTENCE_MODE', 'local_postgres');
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://dt.local');
    vi.stubEnv('FUSION_DEVELOPMENT_MOCK_ENABLED', 'false');
    const { db, services, browserToken } = await createFormalSession();
    const response = await POST(formalEventRequest(browserToken));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'The authoritative classroom catalog is unavailable.',
    });
    clearProductionFusionServices(services as never);
    await db.close();
  });

  it('rejects formal events when the catalog digest does not match the frozen context', async () => {
    vi.stubEnv('FUSION_PERSISTENCE_MODE', 'local_postgres');
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://dt.local');
    vi.stubEnv('FUSION_DEVELOPMENT_MOCK_ENABLED', 'false');
    const digest = 'sha256:'.concat('a'.repeat(64));
    const { db, services, browserToken } = await createFormalSession(
      formalCatalog('sha256:'.concat('b'.repeat(64))),
      digest,
    );
    const response = await POST(formalEventRequest(browserToken));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'The authoritative classroom catalog is unavailable.',
    });
    clearProductionFusionServices(services as never);
    await db.close();
  });

  it('records a successful continue for a formal session with a matching catalog', async () => {
    vi.stubEnv('FUSION_PERSISTENCE_MODE', 'local_postgres');
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://dt.local');
    vi.stubEnv('FUSION_DEVELOPMENT_MOCK_ENABLED', 'false');
    const digest = 'sha256:'.concat('a'.repeat(64));
    const recordSpy = vi.spyOn(classroomObservationLedger, 'record');
    const { db, services, browserToken } = await createFormalSession(formalCatalog(digest), digest);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const event = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            schemaVersion: 'v1',
            eventId: event.eventId,
            correctness: 'correct',
            diagnoses: [],
            teachingIntent: {
              schemaVersion: 'v1',
              kind: 'continue',
              targetLessonKnowledgePointIds: ['semantic-point-1'],
              recommendedStrategy: 'continue',
            },
            warnings: [],
            createdAt: new Date().toISOString(),
          }),
          { status: 200 },
        );
      }),
    );
    const response = await POST(formalEventRequest(browserToken));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      continue: true,
    });
    expect(recordSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ kind: 'continue' }),
      'executed',
    );
    recordSpy.mockRestore();
    clearProductionFusionServices(services as never);
    await db.close();
  });
});
