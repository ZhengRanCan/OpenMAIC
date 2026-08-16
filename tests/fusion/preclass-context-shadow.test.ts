import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { freezeFormalFusionForOutline } from '@/lib/fusion/generation-session';
import {
  buildFormalLessonSemanticRequest,
  buildShadowFrozenTeachingContext,
  isPreClassContextShadowEnabled,
  recordPreClassContextShadow,
} from '@/lib/fusion/adapter/preclass-context-provider';
import {
  clearProductionFusionServices,
  configureProductionFusionServices,
  type ProductionFusionServices,
} from '@/lib/fusion/reliability/production-services';
import type { FrozenLessonGenerationContext } from '@/lib/fusion/preclass-contracts';
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
    recover: vi.fn(async (token: string) => (token === 'browser-token' ? current : undefined)),
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
      requestRef: {
        semanticRequestId: expect.any(String),
        semanticRequestRevision: expect.any(String),
        semanticRequestDigest: expect.stringMatching(/^sha256:/),
      },
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
    expect(updated?.preClassContextShadow).not.toHaveProperty('proposal');
    expect(updated?.preClassContextShadow?.requestRef).toBeUndefined();
    clearProductionFusionServices(configured.services);
  });
});

describe('F49 pre-class context shadow wiring', () => {
  const formalRequest = (cookie = 'browser-token') =>
    new NextRequest('http://openmaic.local/api/generate/scene-outlines-stream', {
      headers: { cookie: `openmaic_fusion_session=${cookie}` },
    });
  const formalProposalFor = (body: string) => {
    const request = JSON.parse(body) as {
      semanticRequestId: string;
      authorizedKnowledgeScope: { namespace: string; scopeId: string };
    };
    const proposal = responseFor(body) as {
      lessonKnowledgeMap: { mappingId: string; mappingRevision: string; knowledgeRefs: unknown[] };
    };
    if (request.semanticRequestId.startsWith('preclass-shadow-')) return proposal;
    return {
      ...proposal,
      lessonKnowledgeMap: {
        ...proposal.lessonKnowledgeMap,
        knowledgeRefs: [
          {
            namespace: request.authorizedKnowledgeScope.namespace,
            scopeId: request.authorizedKnowledgeScope.scopeId,
            id: 'semantic-point-1',
          },
        ],
      },
    };
  };
  const formalContext: FrozenLessonGenerationContext = {
    schemaVersion: 'preclass-fusion-v1',
    contextId: 'frozen-1',
    semanticRequest: {
      schemaVersion: 'preclass-fusion-v1',
      semanticRequestId: 'preclass-1',
      semanticRequestRevision: '1',
      lessonSessionId: 'lesson-1',
      semanticRequestDigest: `sha256:${'0'.repeat(64)}`,
      normalizedTopic: 'Explain linear functions with a short checkpoint.',
      normalizedLearningObjectives: ['Explain linear functions with a short checkpoint.'],
      authorizedKnowledgeScope: {
        namespace: 'deeptutor',
        scopeId: 'course-1',
        allowedKnowledgeRefs: [],
      },
      audienceSemantics: { audienceType: 'classroom', language: 'und' },
      teachingConstraints: { durationMinutes: 15, maxSceneCount: 16 },
      requestedKnowledgeRefs: [],
      sourceMaterialRefs: [],
      warnings: [],
    },
    proposal: {
      schemaVersion: 'preclass-fusion-v1',
      proposalId: 'proposal-1',
      basedOnSemanticRequestId: 'preclass-1',
      basedOnSemanticRequestRevision: '1',
      semanticRequestDigest: `sha256:${'0'.repeat(64)}`,
      resolutionStatus: 'ready',
      interpretedLessonSemantics: {
        normalizedTopic: 'Explain linear functions with a short checkpoint.',
        normalizedLearningObjectives: ['Explain linear functions with a short checkpoint.'],
      },
      lessonKnowledgeMap: {
        mappingId: 'semantic-map-1',
        mappingRevision: '1',
        knowledgeRefs: [{ namespace: 'deeptutor', scopeId: 'course-1', id: 'semantic-point-1' }],
      },
      learnerCognitiveProjection: { projectionRevision: '1', signals: [] },
      teachingGuidance: { guidanceRevision: '1', recommendedApproaches: ['worked-example'] },
      sourceRevisions: [],
      clarificationIssues: [],
      warnings: [],
      createdAt: '2026-08-04T00:00:00.000Z',
    },
    resolution: {
      schemaVersion: 'preclass-fusion-v1',
      semanticRequestId: 'preclass-1',
      semanticRequestRevision: '1',
      semanticRequestDigest: `sha256:${'0'.repeat(64)}`,
      status: 'ready',
      clarificationIssues: [],
    },
    frozenAt: '2026-08-04T00:00:00.000Z',
  };

  it('projects the frozen formal context into the legacy f23-v1 shadow shape', () => {
    const legacy = buildShadowFrozenTeachingContext(formalContext);
    expect(legacy).toMatchObject({
      schemaVersion: 'f23-v1',
      lessonRequirement: 'Explain linear functions with a short checkpoint.',
      lessonKnowledgePointIds: ['semantic-point-1'],
      mappingId: 'semantic-map-1',
      mappingRevision: '1',
      guidance: ['worked-example'],
      checkpoint: {
        checkpointId: 'fusion-checkpoint-frozen-1',
        sceneId: 'fusion-checkpoint-scene-frozen-1',
        remediationSceneId: 'fusion-remediation-scene-frozen-1',
        remediationStrategy: 'worked-example',
      },
    });
    expect(
      buildShadowFrozenTeachingContext({
        ...formalContext,
        proposal: {
          ...formalContext.proposal,
          lessonKnowledgeMap: { ...formalContext.proposal.lessonKnowledgeMap, knowledgeRefs: [] },
        },
      }),
    ).toBeUndefined();
  });

  it('invokes the shadow after the formal freeze when enabled and stores only redacted metadata', async () => {
    vi.stubEnv('FUSION_PERSISTENCE_MODE', 'local_postgres');
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://dt.local');
    vi.stubEnv('FUSION_PRECLASS_CONTEXT_SHADOW_ENABLED', 'true');
    const configured = configure(record());
    const fetchFn = vi.fn(
      async (_url: unknown, init?: RequestInit) =>
        new Response(JSON.stringify(formalProposalFor(String(init?.body))), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchFn);

    const frozen = await freezeFormalFusionForOutline(
      formalRequest(),
      'lesson-1',
      'Explain linear functions with a short checkpoint.',
    );
    expect(frozen.kind).toBe('resolved');
    if (frozen.kind !== 'resolved') return;

    await vi.waitFor(() => {
      expect(configured.current().preClassContextShadow).toBeDefined();
    });
    expect(configured.current().preClassContextShadow).toMatchObject({
      status: 'captured',
      comparison: { topic: 'match', knowledgeScope: 'match', errorType: 'match' },
    });
    const shadowBody = String(fetchFn.mock.calls[1]?.[1]?.body ?? '');
    expect(shadowBody).toContain('preclass-shadow-lesson-1');
    expect(shadowBody).toContain('Explain linear functions with a short checkpoint.');
    const shadowJson = JSON.stringify(configured.current().preClassContextShadow);
    expect(shadowJson).not.toContain('learner-must-not-enter-shadow');
    expect(shadowJson).not.toContain('delegation-secret');
    expect(shadowJson).not.toContain('profileSnapshot');
    expect(configured.current().preClassContextShadow).not.toHaveProperty('semanticRequest');
    expect(configured.current().preClassContextShadow).not.toHaveProperty('proposal');
    expect(configured.current().preClassContextShadow).not.toHaveProperty('resolution');
    expect(configured.current().preClassContextShadow).not.toHaveProperty('frozenContext');
    expect(
      (configured.current().frozenLessonGenerationContext as { contextId?: string })?.contextId,
    ).toBe(frozen.context.contextId);
    clearProductionFusionServices(configured.services);
  });

  it('records a shadow provider failure without blocking or modifying formal generation', async () => {
    vi.stubEnv('FUSION_PERSISTENCE_MODE', 'local_postgres');
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://dt.local');
    vi.stubEnv('FUSION_PRECLASS_CONTEXT_SHADOW_ENABLED', 'true');
    const configured = configure(record());
    const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = String(init?.body);
      if (body.includes('preclass-shadow-')) {
        return new Response('shadow provider unavailable', { status: 503 });
      }
      return new Response(JSON.stringify(formalProposalFor(body)), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchFn);

    const frozen = await freezeFormalFusionForOutline(
      formalRequest(),
      'lesson-1',
      'Explain linear functions with a short checkpoint.',
    );
    expect(frozen.kind).toBe('resolved');
    if (frozen.kind !== 'resolved') return;

    await vi.waitFor(() => {
      expect(configured.current().preClassContextShadow).toBeDefined();
    });
    expect(configured.current().preClassContextShadow).toMatchObject({
      status: 'provider_failed',
      errorCode: 'provider_unavailable',
      comparison: { topic: 'unavailable', knowledgeScope: 'unavailable', errorType: 'mismatch' },
    });
    expect(
      (configured.current().frozenLessonGenerationContext as { contextId?: string })?.contextId,
    ).toBe(frozen.context.contextId);
    clearProductionFusionServices(configured.services);
  });

  it('does not invoke the shadow when the feature flag is disabled', async () => {
    vi.stubEnv('FUSION_PERSISTENCE_MODE', 'local_postgres');
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://dt.local');
    vi.stubEnv('FUSION_PRECLASS_CONTEXT_SHADOW_ENABLED', '');
    const configured = configure(record());
    const fetchFn = vi.fn(
      async (_url: unknown, init?: RequestInit) =>
        new Response(JSON.stringify(formalProposalFor(String(init?.body))), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchFn);

    const frozen = await freezeFormalFusionForOutline(
      formalRequest(),
      'lesson-1',
      'Explain linear functions with a short checkpoint.',
    );
    expect(frozen.kind).toBe('resolved');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(configured.sessions.compareAndSet).toHaveBeenCalledTimes(1);
    expect(configured.current().preClassContextShadow).toBeUndefined();
    clearProductionFusionServices(configured.services);
  });
});
