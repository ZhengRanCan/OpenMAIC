/** Versioned Fusion classroom-diagnosis JSON contracts (F07). */
export const CLASSROOM_CONTRACT_SCHEMA_VERSION = 'v1' as const;

export type AssessmentCorrectness = 'correct' | 'incorrect' | 'partially_correct' | 'unknown';
export type TeachingIntentKind = 'continue' | 'insert_remediation' | 'retry_checkpoint';

export interface ClassroomEvent {
  schemaVersion: typeof CLASSROOM_CONTRACT_SCHEMA_VERSION;
  eventId: string;
  eventType: 'checkpoint_submitted';
  lessonSessionId: string;
  courseId: string;
  sceneId: string;
  correlationId: string;
  checkpointId: string;
  mappingId: string;
  mappingRevision: string;
  lessonKnowledgePointIds: string[];
  originalQuestion: string;
  studentAnswer: string;
  localAssessment: { score?: number; maxScore?: number; correctness?: AssessmentCorrectness; gradingMode: string; feedback?: string };
  occurredAt: string;
}

export interface TeachingIntent {
  schemaVersion: typeof CLASSROOM_CONTRACT_SCHEMA_VERSION;
  kind: TeachingIntentKind;
  targetLessonKnowledgePointIds: string[];
  recommendedStrategy: string;
  rationaleCode?: string;
}

export interface LearningDiagnosis {
  schemaVersion: typeof CLASSROOM_CONTRACT_SCHEMA_VERSION;
  eventId: string;
  correctness: AssessmentCorrectness;
  diagnoses: Array<{ lessonKnowledgePointId: string; misconception: string; confidence: number }>;
  teachingIntent: TeachingIntent;
  warnings: string[];
  createdAt: string;
}

export interface SceneDirective {
  schemaVersion: typeof CLASSROOM_CONTRACT_SCHEMA_VERSION;
  directiveId: string;
  sourceEventId: string;
  kind: TeachingIntentKind;
  targetSceneId?: string;
  reasonCode?: string;
  expectedRuntimeRevision: number;
}

export class ClassroomContractError extends Error {
  readonly code: 'invalid_event' | 'invalid_diagnosis';

  constructor(code: 'invalid_event' | 'invalid_diagnosis', message: string) {
    super(message);
    this.name = 'ClassroomContractError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function nonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function stringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every(nonEmptyString); }
function validCorrectness(value: unknown): value is AssessmentCorrectness { return value === 'correct' || value === 'incorrect' || value === 'partially_correct' || value === 'unknown'; }
function validIntent(value: unknown): value is TeachingIntentKind { return value === 'continue' || value === 'insert_remediation' || value === 'retry_checkpoint'; }

export function parseClassroomEvent(value: unknown): ClassroomEvent {
  if (!isRecord(value) || value.schemaVersion !== CLASSROOM_CONTRACT_SCHEMA_VERSION || value.eventType !== 'checkpoint_submitted') throw new ClassroomContractError('invalid_event', 'Unsupported classroom event schema or type.');
  const fields = ['eventId', 'lessonSessionId', 'courseId', 'sceneId', 'correlationId', 'checkpointId', 'mappingId', 'mappingRevision', 'originalQuestion', 'studentAnswer', 'occurredAt'];
  if (fields.some((key) => !nonEmptyString(value[key])) || !stringArray(value.lessonKnowledgePointIds) || !isRecord(value.localAssessment) || !nonEmptyString(value.localAssessment.gradingMode) || (value.localAssessment.correctness !== undefined && !validCorrectness(value.localAssessment.correctness))) throw new ClassroomContractError('invalid_event', 'Classroom event has missing or invalid fields.');
  return value as ClassroomEvent;
}

export function parseLearningDiagnosis(value: unknown): LearningDiagnosis {
  if (!isRecord(value) || value.schemaVersion !== CLASSROOM_CONTRACT_SCHEMA_VERSION || !nonEmptyString(value.eventId) || !validCorrectness(value.correctness) || !Array.isArray(value.diagnoses) || !isRecord(value.teachingIntent) || !validIntent(value.teachingIntent.kind) || !stringArray(value.teachingIntent.targetLessonKnowledgePointIds) || !nonEmptyString(value.teachingIntent.recommendedStrategy) || !stringArray(value.warnings) || !nonEmptyString(value.createdAt)) throw new ClassroomContractError('invalid_diagnosis', 'Diagnosis has missing or invalid fields.');
  for (const diagnosis of value.diagnoses) {
    if (!isRecord(diagnosis) || !nonEmptyString(diagnosis.lessonKnowledgePointId) || !nonEmptyString(diagnosis.misconception) || typeof diagnosis.confidence !== 'number' || diagnosis.confidence < 0 || diagnosis.confidence > 1) throw new ClassroomContractError('invalid_diagnosis', 'Diagnosis contains an invalid diagnostic item.');
  }
  return value as LearningDiagnosis;
}

export function serializeClassroomContract(value: ClassroomEvent | LearningDiagnosis | TeachingIntent | SceneDirective): string { return JSON.stringify(value); }
