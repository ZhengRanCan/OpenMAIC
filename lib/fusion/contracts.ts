/**
 * Stable teaching-semantic contracts shared by OpenMAIC and a tutoring system.
 *
 * The fusion boundary deliberately exchanges educational meaning instead of
 * product-specific state (slides, prompts, database records, or UI events).
 */

export const FUSION_CONTRACT_VERSION = 'v1' as const;

export type FusionContractVersion = typeof FUSION_CONTRACT_VERSION;
export type KnowledgeRepresentation = 'visual' | 'concrete' | 'formula' | 'step_by_step';
export type LearningPace = 'slow' | 'standard' | 'fast';
export type LessonLevel = 'foundation' | 'standard' | 'advanced';
export type CheckpointDifficulty = 'easy' | 'medium' | 'hard';
export type LearningErrorType = 'structural' | 'deviation' | 'application' | 'metacognitive';

export interface KnowledgeMastery {
  /** Stable identifier when the source system has one; otherwise a topic-local id. */
  knowledgePointId: string;
  name: string;
  /** Normalized mastery estimate in the inclusive range 0..1. */
  mastery: number;
  evidence?: string[];
}

export interface LearningPreference {
  preferredExamples?: string[];
  preferredRepresentations?: KnowledgeRepresentation[];
  pace?: LearningPace;
}

export interface Misconception {
  knowledgePointId?: string;
  knowledgePoint: string;
  errorType: LearningErrorType;
  description: string;
}

/** The first of the five cross-system semantic objects: a learner snapshot. */
export interface StudentProfile {
  contractVersion: FusionContractVersion;
  learnerId: string;
  displayName?: string;
  source: 'deeptutor' | 'mock';
  knowledgeState: KnowledgeMastery[];
  strengths: string[];
  weakPoints: string[];
  learningPreferences: LearningPreference;
  recentMisconceptions: Misconception[];
  updatedAt: string;
}

/** Reserved for future playback/assessment integration; unused by the MVP. */
export interface ClassroomEvent {
  contractVersion: FusionContractVersion;
  eventId: string;
  learnerId: string;
  lessonSessionId: string;
  type: 'lesson_started' | 'scene_viewed' | 'checkpoint_submitted' | 'lesson_completed';
  occurredAt: string;
  sceneId?: string;
  knowledgePointIds?: string[];
  payload?: Record<string, unknown>;
}

/** Reserved for future DeepTutor diagnosis after a classroom event. */
export interface LearningDiagnosis {
  contractVersion: FusionContractVersion;
  learnerId: string;
  eventId: string;
  diagnoses: Array<{
    knowledgePointId?: string;
    errorType: LearningErrorType;
    confidence: number;
    feedback: string;
  }>;
  createdAt: string;
}

/** The teaching plan OpenMAIC can apply while generating a lesson. */
export interface TeachingStrategy {
  contractVersion: FusionContractVersion;
  lessonLevel: LessonLevel;
  prerequisiteReview: string[];
  emphasis: string[];
  avoidRepetition: string[];
  exampleGuidance: string[];
  explanationStyle: string[];
  checkpointPlan: Array<{
    knowledgePoint: string;
    difficulty: CheckpointDifficulty;
    purpose: string;
  }>;
}

/** Reserved for the future write-back from a completed OpenMAIC lesson. */
export interface ProfileUpdate {
  contractVersion: FusionContractVersion;
  learnerId: string;
  lessonSessionId: string;
  sourceEventIds: string[];
  masteryChanges: Array<{
    knowledgePointId: string;
    delta: number;
    evidence: string;
  }>;
  observedMisconceptions?: Misconception[];
  createdAt: string;
}

export interface LessonDescriptor {
  topic: string;
  subject?: string;
  objectives?: string[];
}

/** A frozen lesson-specific transformation of a profile into generation guidance. */
export interface FusionTeachingContext {
  contractVersion: FusionContractVersion;
  learnerId: string;
  lesson: LessonDescriptor;
  profileSnapshot: StudentProfile;
  strategy: TeachingStrategy;
  /** Rendered only for the existing OpenMAIC prompt templates. */
  promptText: string;
}

/** Persistable snapshot used to keep every generated scene tied to one profile revision. */
export interface FusionLessonSession {
  contractVersion: FusionContractVersion;
  id: string;
  createdAt: string;
  context: FusionTeachingContext;
}
