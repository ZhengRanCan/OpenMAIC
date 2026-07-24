import type { ClassroomEvent, LearningDiagnosis, SceneDirective } from './contracts';

export type DirectiveExecutionStatus = 'executed' | 'not_executed' | 'degraded';
export interface ClassroomObservation {
  observationId: string; sourceEventId: string; correlationId: string; checkpointId: string; sceneId: string;
  lessonKnowledgePointIds: string[]; originalQuestion: string; studentAnswer: string; localAssessment: ClassroomEvent['localAssessment'];
  diagnosisSummary?: { correctness: LearningDiagnosis['correctness']; misconceptionCode?: string; confidence?: number };
  directiveSummary?: { directiveId: string; kind: SceneDirective['kind']; reasonCode?: string; executionStatus: DirectiveExecutionStatus };
  occurredAt: string; recordedAt: string;
}
export interface ClassroomObservationLedger { schemaVersion: 'v1'; lessonSessionId: string; courseId: string; createdAt: string; observations: ClassroomObservation[]; revision: number; }

export class ClassroomObservationLedgerStore {
  private readonly ledgers = new Map<string, ClassroomObservationLedger>();
  record(event: ClassroomEvent, diagnosis: LearningDiagnosis | null, directive: SceneDirective | undefined, executionStatus: DirectiveExecutionStatus): ClassroomObservationLedger {
    const ledger = this.ledgers.get(event.lessonSessionId) ?? { schemaVersion: 'v1', lessonSessionId: event.lessonSessionId, courseId: event.courseId, createdAt: event.occurredAt, observations: [], revision: 0 };
    const existing = ledger.observations.find((observation) => observation.sourceEventId === event.eventId || (directive && observation.directiveSummary?.directiveId === directive.directiveId));
    if (existing) return ledger;
    ledger.observations.push({ observationId: `observation_${event.eventId}`, sourceEventId: event.eventId, correlationId: event.correlationId, checkpointId: event.checkpointId, sceneId: event.sceneId, lessonKnowledgePointIds: [...event.lessonKnowledgePointIds], originalQuestion: event.originalQuestion, studentAnswer: event.studentAnswer, localAssessment: { ...event.localAssessment }, ...(diagnosis ? { diagnosisSummary: { correctness: diagnosis.correctness, ...(diagnosis.diagnoses[0] ? { misconceptionCode: diagnosis.diagnoses[0].misconception, confidence: diagnosis.diagnoses[0].confidence } : {}) } } : {}), ...(directive ? { directiveSummary: { directiveId: directive.directiveId, kind: directive.kind, ...(directive.reasonCode ? { reasonCode: directive.reasonCode } : {}), executionStatus } } : {}), occurredAt: event.occurredAt, recordedAt: new Date().toISOString() });
    ledger.revision += 1; this.ledgers.set(event.lessonSessionId, ledger); return ledger;
  }
  get(lessonSessionId: string): ClassroomObservationLedger | undefined { return this.ledgers.get(lessonSessionId); }
}

export const classroomObservationLedger = new ClassroomObservationLedgerStore();
