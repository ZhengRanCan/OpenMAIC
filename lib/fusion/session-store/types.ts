import type {
  FrozenLessonGenerationContext,
  LessonSemanticRequest,
  PreClassTeachingContextProposal,
  SemanticResolution,
} from '../preclass-contracts';

export type FusionJson =
  | null
  | boolean
  | number
  | string
  | FusionJson[]
  | { [key: string]: FusionJson };
export type FusionJsonObject = { [key: string]: FusionJson };

/**
 * F42's additive, server-only shadow record.  It deliberately has its own
 * schema version so existing v1 session data remains readable unchanged.
 */
export interface PreClassContextShadow {
  schemaVersion: 'preclass-context-shadow-v1';
  status: 'captured' | 'provider_failed';
  observedAt: string;
  semanticRequest?: LessonSemanticRequest;
  proposal?: PreClassTeachingContextProposal;
  resolution?: SemanticResolution;
  frozenContext?: FrozenLessonGenerationContext;
  comparison: {
    topic: 'match' | 'mismatch' | 'unavailable';
    knowledgeScope: 'match' | 'mismatch' | 'unavailable';
    errorType: 'match' | 'mismatch';
  };
  errorCode?: string;
}

export interface FusionSessionRecord {
  schemaVersion: 'v1';
  lessonSessionId: string;
  learnerId: string;
  credentialRef: string;
  /** Immutable DeepTutor scope reference derived from the authenticated launch exchange. */
  courseScopeRef?: { scopeId: string; revision: string };
  profileSnapshot: FusionJsonObject;
  lessonKnowledgeMap: FusionJsonObject;
  /** Frozen on the first formal outline request. Never populated from browser snapshots. */
  generationContext?: FusionJsonObject;
  /** F42 observation only. Formal generation must not read this until F43. */
  preClassContextShadow?: PreClassContextShadow;
  /** F43's sole formal pre-class semantic root. It never shares fields with the legacy context. */
  frozenLessonGenerationContext?: FusionJsonObject;
  /** A non-ready F43 outcome is durable so repeated outline requests cannot silently retry it. */
  preClassResolution?: FusionJsonObject;
  /** Server-owned outlines from the sole formal generation request. */
  generatedOutlines?: FusionJsonObject[];
  sceneCatalog: FusionJsonObject;
  runtimeState: FusionJsonObject;
  degradationState: string;
  snapshotCapturedAt: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  completedAt?: string;
}

export interface CreateFusionSession extends Omit<
  FusionSessionRecord,
  'schemaVersion' | 'revision' | 'createdAt' | 'updatedAt'
> {
  now?: Date;
}

export interface FusionSessionStore {
  create(input: CreateFusionSession, browserSessionToken: string): Promise<FusionSessionRecord>;
  get(lessonSessionId: string): Promise<FusionSessionRecord | undefined>;
  recover(browserSessionToken: string, now?: Date): Promise<FusionSessionRecord | undefined>;
  compareAndSet(
    lessonSessionId: string,
    expectedRevision: number,
    update: (record: FusionSessionRecord) => FusionSessionRecord,
  ): Promise<FusionSessionRecord | undefined>;
  deleteForLearner(learnerId: string): Promise<number>;
  deleteForLesson(lessonSessionId: string): Promise<number>;
}
