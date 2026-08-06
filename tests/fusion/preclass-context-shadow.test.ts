import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildFormalLessonSemanticRequest,
  isPreClassContextShadowEnabled,
  recordPreClassContextShadow,
} from '@/lib/fusion/adapter/preclass-context-provider';
import {
  clearProductionFusionServices,
  configureProductionFusionServices,
  type ProductionFusionServices,
} from '@/lib/fusion/reliability/production-services';
import type { FusionSessionRecord } from '@/lib/fusion/session-store/types';
import type { FrozenTeachingContext } from '@/lib/fusion/teaching-context';

function record(): FusionSessionRecord {
  return {
    schemaVersion: 'v1',
    lessonSessionId: 'lesson-1',
    learnerId: 'learner-must-not-enter-shadow',
    credentialRef: 'secret://delegation/1',
    courseScopeRef: { scopeId: 'course-1', revision: 'r1' },
    profileSnapshot: { learnerId: 'learner-must-not-enter-shadow' },
    lessonKnowledgeMap: {},
    sceneCatalog: {},
    runtimeState: {},
    degradationState: 'none',
    snapshotCapturedAt: '2026-07-31T15:00:00.000Z',
    revision: 3,
    createdAt: '2026-07-31T15:00:00.000Z',
    updatedAt: '2026-07-31T15:00:00.000Z',
    expiresAt: '2099-07-31T15:00:00.000Z',
  };
}

const legacy: FrozenTeachingContext = {
  schemaVersion: 'f23-v1',
  lessonRequirement: 'Explain linear functions with a short checkpoint.',
  lessonKnowledgePointIds: ['kp-linear-slope'],
  mappingId: 'legacy-map',
  mappingRevision: '2',
  guidance: ['Legacy output remains authoritative during F42.'],
  checkpoint: {
    checkpointId: 'legacy-checkpoint',
    sceneId: 'legacy-scene',
    remediationSceneId: 'legacy-remediation',
    remediationStrategy: 'legacy-strategy',
  },
};

it('builds formal scope only from the immutable launch-derived reference', () => {
  const request = buildFormalLessonSemanticRequest(record(), 'Explain linear functions');
  expect(request.authorizedKnowledgeScope).toMatchObject({
    namespace: 'deeptutor',
    scopeId: 'course-1',
  });
  expect(() =>
    buildFormalLessonSemanticRequest({ ...record(), courseScopeRef: undefined }, 'Explain'),
  ).toThrow('course_scope_unavailable');
});

function configure(current: FusionSessionRecord, scopes = ['preclass-context:read']) {
  const sessions = {
    compareAndSet: vi.fn(async (_id, revision, update) => {
      if (revision !== current.revision) return undefined;
      current = { ...update(current), revision: current.revision + 1 };
      return current;
    }),
  };
  const services = {
    credentials: {
      get: vi.fn(async () => ({ token: 'delegation-secret', scope: scopes })),
    },
    sessions,
    outbox: {},
    circuits: { run: vi.fn(async (_capability, operation) => operation()) },
  } as unknown as ProductionFusionServices;
  configureProductionFusionServices(services);
  return { services, sessions, current: () => current };
}

function responseFor(body: string) {
  const request = JSON.parse(body) as {
    schemaVersion: string;
    semanticRequestId: string;
    semanticRequestRevision: string;
    semanticRequestDigest: string;
    normalizedTopic: string;
    normalizedLearningObjectives: string[];
    requestedKnowledgeRefs: unknown[];
  };
  return {
    schemaVersion: request.schemaVersion,
    proposalId: 'synthetic-proposal-1',
    basedOnSemanticRequestId: request.semanticRequestId,
    basedOnSemanticRequestRevision: request.semanticRequestRevision,
    semanticRequestDigest: request.semanticRequestDigest,
    resolutionStatus: 'ready',
    interpretedLessonSemantics: {
      normalizedTopic: request.normalizedTopic,
      normalizedLearningObjectives: request.normalizedLearningObjectives,
    },
    lessonKnowledgeMap: {
      mappingId: 'synthetic-map-1',
      mappingRevision: 'synthetic-v1',
      knowledgeRefs: request.requestedKnowledgeRefs,
    },
    learnerCognitiveProjection: {
      projectionRevision: 'synthetic-v1',
      signals: ['synthetic_fixture_only'],
    },
    teachingGuidance: {
      guidanceRevision: 'synthetic-v1',
      recommendedApproaches: ['worked-example'],
    },
    sourceRevisions: ['synthetic-fixture-v1'],
    clarificationIssues: [],
    warnings: ['synthetic_development_source'],
    createdAt: '2026-07-31T15:00:00Z',
  };
}

describe('F42 pre-class Context shadow', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is an explicit server-owned switch', () => {
    expect(isPreClassContextShadowEnabled({})).toBe(false);
    expect(isPreClassContextShadowEnabled({ FUSION_PRECLASS_CONTEXT_SHADOW_ENABLED: 'true' })).toBe(
      true,
    );
  });

  it('strictly records an isolated request/proposal/resolution/frozen context without learner or token', async () => {
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://dt.local');
    const configured = configure(record());
    const fetchFn = vi.fn(
      async (_url: unknown, init?: RequestInit) =>
        new Response(JSON.stringify(responseFor(String(init?.body))), { status: 200 }),
    );

    const updated = await recordPreClassContextShadow(record(), legacy, fetchFn);

    expect(updated?.preClassContextShadow).toMatchObject({
      status: 'captured',
      comparison: { topic: 'match', knowledgeScope: 'match', errorType: 'match' },
      frozenContext: { semanticRequest: { lessonSessionId: 'lesson-1' } },
    });
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain('/api/v1/fusion/pre-class/context');
    expect(JSON.stringify(updated?.preClassContextShadow)).not.toContain(
      'learner-must-not-enter-shadow',
    );
    expect(JSON.stringify(updated?.preClassContextShadow)).not.toContain('delegation-secret');
    expect(configured.sessions.compareAndSet).toHaveBeenCalledTimes(1);
    clearProductionFusionServices(configured.services);
  });

  it('records provider failures explicitly and never substitutes the legacy path as a mock response', async () => {
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://dt.local');
    const configured = configure(record(), ['diagnosis:request']);
    const fetchFn = vi.fn();

    const updated = await recordPreClassContextShadow(record(), legacy, fetchFn);

    expect(updated?.preClassContextShadow).toMatchObject({
      status: 'provider_failed',
      errorCode: 'delegation_scope_invalid',
      comparison: { topic: 'unavailable', knowledgeScope: 'unavailable', errorType: 'mismatch' },
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(updated?.preClassContextShadow?.proposal).toBeUndefined();
    clearProductionFusionServices(configured.services);
  });
});
