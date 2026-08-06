import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  CLASSROOM_CONTRACT_SCHEMA_VERSION,
  type AssessmentCorrectness,
} from '@/lib/fusion/contracts';
import {
  ClassroomDiagnosisAdapter,
  createF08DiagnosisPort,
  DEVELOPMENT_MOCK_KNOWLEDGE_POINT_ID,
} from '@/lib/fusion/adapter/classroom-diagnosis-adapter';
import { DEVELOPMENT_SCENE_CATALOG } from '@/lib/fusion/scene-catalog';
import {
  applyDirective,
  createLessonRuntimeState,
  type LessonRuntimeState,
} from '@/lib/fusion/lesson-runtime-state';
import { planSceneDirective } from '@/lib/fusion/scene-directive-planner';
import { classroomObservationLedger } from '@/lib/fusion/classroom-observation-ledger';
import { parseLearningDiagnosis, type ClassroomEvent } from '@/lib/fusion/contracts';
import { requestRealDiagnosis } from '@/lib/fusion/adapter/real-event-update-provider';
import {
  ensureFusionServices,
  isProductionFusion,
} from '@/lib/fusion/reliability/production-services';
import { recordPersistentClassroomFactInTransaction } from '@/lib/fusion/persistent-lesson';
import type { SceneCatalog } from '@/lib/fusion/scene-catalog';

let runtimeState: LessonRuntimeState = createLessonRuntimeState();

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

async function integratedPost(request: NextRequest, body: Record<string, unknown>) {
  const browserSessionToken = request.cookies.get('openmaic_fusion_session')?.value;
  if (!browserSessionToken)
    return apiError('INVALID_CREDENTIALS', 401, 'A Fusion classroom session is required.');
  const services = await ensureFusionServices();
  const session = await services.sessions.recover(browserSessionToken);
  if (!session)
    return apiError('INVALID_CREDENTIALS', 401, 'The Fusion classroom session has expired.');
  const catalog = (session.sceneCatalog ?? {}) as unknown as SceneCatalog;
  const runtime = session.runtimeState as unknown as LessonRuntimeState;
  const formalContext = session.frozenLessonGenerationContext as
    | {
        proposal?: {
          lessonKnowledgeMap?: {
            mappingId?: unknown;
            mappingRevision?: unknown;
            knowledgeRefs?: unknown[];
          };
        };
      }
    | undefined;
  const mapping = (session.lessonKnowledgeMap ??
    formalContext?.proposal?.lessonKnowledgeMap ??
    {}) as {
    mappingId?: unknown;
    mappingRevision?: unknown;
  };
  const checkpoint = catalog.entries?.find(
    (entry) => entry.sceneId === runtime.currentSceneId && entry.role === 'checkpoint',
  );
  if (
    !checkpoint?.checkpointId ||
    !Array.isArray(checkpoint.lessonKnowledgePointIds) ||
    typeof mapping.mappingId !== 'string' ||
    typeof mapping.mappingRevision !== 'string'
  ) {
    return apiError('INTERNAL_ERROR', 409, 'The authoritative classroom session is incomplete.');
  }
  const localAssessment = body.localAssessment as Record<string, unknown>;
  const correctness = localAssessment.correctness;
  const event: ClassroomEvent = {
    schemaVersion: CLASSROOM_CONTRACT_SCHEMA_VERSION,
    eventId: crypto.randomUUID(),
    eventType: 'checkpoint_submitted',
    lessonSessionId: session.lessonSessionId,
    courseId: 'integrated-fusion-course',
    sceneId: checkpoint.sceneId,
    correlationId: crypto.randomUUID(),
    checkpointId: checkpoint.checkpointId,
    mappingId: mapping.mappingId,
    mappingRevision: mapping.mappingRevision,
    lessonKnowledgePointIds: checkpoint.lessonKnowledgePointIds,
    originalQuestion: body.question as string,
    studentAnswer: body.answer as string,
    localAssessment: {
      gradingMode: localAssessment.gradingMode as string,
      ...(correctness ? { correctness: correctness as AssessmentCorrectness } : {}),
    },
    occurredAt: new Date().toISOString(),
  };
  let diagnosis;
  try {
    diagnosis = parseLearningDiagnosis(await requestRealDiagnosis(event));
  } catch {
    // Persistent integration mode is deliberately fail-closed: it never
    // replaces a real diagnosis failure with the F08 Mock provider.
    return apiError('UPSTREAM_ERROR', 503, 'Classroom diagnosis is temporarily unavailable.');
  }
  if (diagnosis.eventId !== event.eventId) {
    return apiError(
      'UPSTREAM_ERROR',
      502,
      'Classroom diagnosis did not match the submitted event.',
    );
  }
  const planned = planSceneDirective(diagnosis.teachingIntent, event.eventId, catalog, runtime);
  const applied = applyDirective(runtime, planned.directive);
  if (!applied)
    return apiError('INTERNAL_ERROR', 409, 'Classroom state changed; retry the checkpoint.');
  let updated;
  try {
    updated = await services.outbox.transaction(async (queryable) => {
      const changed = await services.sessions.compareAndSetInTransaction(
        queryable,
        session.lessonSessionId,
        session.revision,
        (current) => ({
          ...current,
          runtimeState: JSON.parse(JSON.stringify(applied)),
        }),
      );
      if (!changed) return undefined;
      await recordPersistentClassroomFactInTransaction(
        queryable,
        changed,
        event,
        diagnosis,
        planned.directive,
      );
      return changed;
    });
  } catch {
    return apiError('UPSTREAM_ERROR', 503, 'Classroom state could not be saved.');
  }
  if (!updated)
    return apiError('INTERNAL_ERROR', 409, 'Classroom state changed; retry the checkpoint.');
  const executionStatus = planned.directive.kind === 'continue' ? 'degraded' : 'executed';
  classroomObservationLedger.record(event, diagnosis, planned.directive, executionStatus);
  return apiSuccess({
    diagnosis: {
      eventId: diagnosis.eventId,
      correctness: diagnosis.correctness,
      teachingIntent: diagnosis.teachingIntent,
    },
    directive: planned.directive,
    continue: planned.directive.kind === 'continue',
  });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const candidate: unknown = await request.json();
    if (!record(candidate)) throw new Error();
    body = candidate;
  } catch {
    return apiError('INVALID_REQUEST', 400, 'Invalid classroom event.');
  }
  if (
    !text(body.question) ||
    !text(body.answer) ||
    !record(body.localAssessment) ||
    !text(body.localAssessment.gradingMode)
  )
    return apiError('INVALID_REQUEST', 400, 'Question, answer, and local assessment are required.');
  const correctness = body.localAssessment.correctness;
  if (
    correctness !== undefined &&
    !['correct', 'incorrect', 'partially_correct', 'unknown'].includes(String(correctness))
  )
    return apiError('INVALID_REQUEST', 400, 'Invalid local correctness.');
  if (isProductionFusion()) {
    try {
      return await integratedPost(request, body);
    } catch {
      return apiError('UPSTREAM_ERROR', 503, 'Fusion classroom storage is unavailable.');
    }
  }
  const event = {
    schemaVersion: CLASSROOM_CONTRACT_SCHEMA_VERSION,
    eventId: crypto.randomUUID(),
    eventType: 'checkpoint_submitted' as const,
    lessonSessionId: 'development-lesson-session',
    courseId: 'development-course',
    sceneId: 'development-quiz-scene',
    correlationId: crypto.randomUUID(),
    checkpointId: 'development-checkpoint',
    mappingId: 'development-map',
    mappingRevision: '1',
    lessonKnowledgePointIds: [DEVELOPMENT_MOCK_KNOWLEDGE_POINT_ID],
    originalQuestion: body.question,
    studentAnswer: body.answer,
    localAssessment: {
      gradingMode: body.localAssessment.gradingMode,
      ...(correctness ? { correctness: correctness as AssessmentCorrectness } : {}),
    },
    occurredAt: new Date().toISOString(),
  };
  try {
    const adapter = new ClassroomDiagnosisAdapter(
      {
        environment: process.env.NODE_ENV,
        developmentMockEnabled: process.env.FUSION_DEVELOPMENT_MOCK_ENABLED === 'true',
      },
      createF08DiagnosisPort(),
    );
    const diagnosis = await adapter.diagnoseCheckpoint(event);
    const planned = planSceneDirective(
      diagnosis.teachingIntent,
      event.eventId,
      DEVELOPMENT_SCENE_CATALOG,
      runtimeState,
    );
    const applied = applyDirective(runtimeState, planned.directive);
    if (applied) runtimeState = applied;
    const executionStatus = applied
      ? planned.directive.kind === 'continue'
        ? 'degraded'
        : 'executed'
      : 'not_executed';
    classroomObservationLedger.record(event, diagnosis, planned.directive, executionStatus);
    return apiSuccess({
      diagnosis: {
        eventId: diagnosis.eventId,
        correctness: diagnosis.correctness,
        teachingIntent: diagnosis.teachingIntent,
      },
      directive: planned.directive,
      continue: planned.directive.kind === 'continue',
    });
  } catch {
    classroomObservationLedger.record(event, null, undefined, 'degraded');
    return apiSuccess({ diagnosis: null, reasonCode: 'diagnosis_unavailable', continue: true });
  }
}
