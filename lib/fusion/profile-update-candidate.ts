import type { ClassroomObservationLedger } from './classroom-observation-ledger';

export interface ProfileUpdateCandidate { schemaVersion: 'v1'; candidateId: string; idempotencyKey: string; lessonSessionId: string; sourceEventIds: string[]; mappingId: string; mappingRevision: string; observations: Array<{ kind: 'misconception_signal' | 'assessment_result'; lessonKnowledgePointId: string; value: string; confidence?: number; authoritativeRef?: { namespace: string; scopeId: string; id: string } }>; createdAt: string; }

export function createProfileUpdateCandidate(ledger: ClassroomObservationLedger): ProfileUpdateCandidate {
  const observations = ledger.observations.flatMap((observation) => observation.diagnosisSummary?.correctness === 'incorrect' ? [{ kind: 'misconception_signal' as const, lessonKnowledgePointId: observation.lessonKnowledgePointIds[0], value: 'development_checkpoint_incorrect', confidence: observation.diagnosisSummary.confidence, authoritativeRef: { namespace: 'development', scopeId: 'linear-function', id: observation.lessonKnowledgePointIds[0] } }] : []);
  if (!observations.length || observations.some((observation) => !observation.authoritativeRef)) throw new Error('No mapped observation qualifies for a profile update candidate.');
  const sourceEventIds = ledger.observations.map((observation) => observation.sourceEventId);
  const candidateId = `candidate_${ledger.lessonSessionId}_${ledger.revision}`;
  return { schemaVersion: 'v1', candidateId, idempotencyKey: candidateId, lessonSessionId: ledger.lessonSessionId, sourceEventIds, mappingId: 'development-map', mappingRevision: '1', observations, createdAt: ledger.createdAt };
}
