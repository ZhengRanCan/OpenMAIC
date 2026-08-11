import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/fusion/clarify/route';
import { freezeFormalFusionForOutline } from '@/lib/fusion/generation-session';
import {
  clearProductionFusionServices,
  configureProductionFusionServices,
  type ProductionFusionServices,
} from '@/lib/fusion/reliability/production-services';
import type { FusionSessionRecord } from '@/lib/fusion/session-store/types';

function request(body: unknown, cookie = 'browser-token') {
  return new NextRequest('http://openmaic.local/api/fusion/clarify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `openmaic_fusion_session=${cookie}` },
    body: JSON.stringify(body),
  });
}

function record(): FusionSessionRecord {
  return {
    schemaVersion: 'v1',
    lessonSessionId: 'lesson-1',
    learnerId: 'allowlisted-synthetic-learner',
    credentialRef: 'secret://delegation/1',
    courseScopeRef: { scopeId: 'course-1', revision: 'r1' },
    runtimeState: {},
    degradationState: 'none',
    revision: 0,
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
    expiresAt: '2099-08-11T00:00:00.000Z',
  };
}

function configure(current: FusionSessionRecord) {
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
      get: vi.fn(async () => ({ token: 'delegation-secret', scope: ['preclass-context:read'] })),
    },
    sessions,
    outbox: {},
    circuits: { run: vi.fn(async (_capability, operation) => operation()) },
  } as unknown as ProductionFusionServices;
  configureProductionFusionServices(services);
  return { services, current: () => current };
}

function responseFor(body: string, resolutionStatus: string, clarificationIssues: string[] = []) {
  const request = JSON.parse(body) as {
    schemaVersion: string;
    semanticRequestId: string;
    semanticRequestRevision: string;
    semanticRequestDigest: string;
    normalizedTopic: string;
    normalizedLearningObjectives: string[];
    authorizedKnowledgeScope: { namespace: string; scopeId: string };
  };
  return {
    schemaVersion: request.schemaVersion,
    proposalId: 'proposal-1',
    basedOnSemanticRequestId: request.semanticRequestId,
    basedOnSemanticRequestRevision: request.semanticRequestRevision,
    semanticRequestDigest: request.semanticRequestDigest,
    resolutionStatus,
    interpretedLessonSemantics: {
      normalizedTopic: request.normalizedTopic,
      normalizedLearningObjectives: request.normalizedLearningObjectives,
    },
    lessonKnowledgeMap: {
      mappingId: 'semantic-map-1',
      mappingRevision: '1',
      knowledgeRefs: [
        {
          namespace: request.authorizedKnowledgeScope.namespace,
          scopeId: request.authorizedKnowledgeScope.scopeId,
          id: 'semantic-point-1',
        },
      ],
    },
    learnerCognitiveProjection: { projectionRevision: '1', signals: ['insufficient_data'] },
    teachingGuidance: { guidanceRevision: '1', recommendedApproaches: ['worked-example'] },
    sourceRevisions: ['fixture'],
    clarificationIssues,
    warnings: [],
    createdAt: '2026-08-11T00:00:00.000Z',
  };
}

const stubFetch = (resolutionStatus: string, clarificationIssues: string[] = []) =>
  vi.fn(
    async (_url: unknown, init?: RequestInit) =>
      new Response(
        JSON.stringify(responseFor(String(init?.body), resolutionStatus, clarificationIssues)),
        { status: 200 },
      ),
  );

describe('F48 clarify endpoint', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('rejects a malformed payload without touching the session', async () => {
    vi.stubEnv('FUSION_PERSISTENCE_MODE', 'local_postgres');
    const response = await POST(
      new NextRequest('http://openmaic.local/api/fusion/clarify', {
        method: 'POST',
        body: 'not-json',
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errorCode: 'INVALID_REQUEST' });
  });

  it('resolves a needs_clarification session through the explicit endpoint', async () => {
    vi.stubEnv('FUSION_PERSISTENCE_MODE', 'local_postgres');
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://dt.local');
    vi.stubGlobal('fetch', stubFetch('needs_clarification', ['requirement_ambiguous']));
    const configured = configure(record());
    await expect(
      freezeFormalFusionForOutline(request({ lessonSessionId: 'lesson-1' }), 'lesson-1', 'Vague'),
    ).rejects.toMatchObject({ code: 'FUSION_CONTEXT_NEEDS_CLARIFICATION' });

    vi.stubGlobal('fetch', stubFetch('ready'));
    const response = await POST(
      request({ lessonSessionId: 'lesson-1', supplement: 'Concrete requirement now' }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      contextId?: string;
      semanticRequestRevision?: string;
    };
    expect(body.success).toBe(true);
    expect(body.contextId).toMatch(/^frozen-/);
    expect(body.semanticRequestRevision).toBe('2');
    expect(configured.current().preClassClarification).toMatchObject({ finalStatus: 'ready' });
    clearProductionFusionServices(configured.services);
  });

  it('fails closed on the endpoint when the session is already generated', async () => {
    vi.stubEnv('FUSION_PERSISTENCE_MODE', 'local_postgres');
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://dt.local');
    vi.stubGlobal('fetch', stubFetch('ready'));
    const configured = configure(record());
    const frozen = await freezeFormalFusionForOutline(
      request({ lessonSessionId: 'lesson-1' }),
      'lesson-1',
      'Ready requirement',
    );
    expect(frozen.kind).toBe('resolved');
    const response = await POST(
      request({ lessonSessionId: 'lesson-1', supplement: 'Still supplementing' }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ errorCode: 'FUSION_SESSION_ALREADY_GENERATED' });
    clearProductionFusionServices(configured.services);
  });
});
