export type FusionJson =
  | null
  | boolean
  | number
  | string
  | FusionJson[]
  | { [key: string]: FusionJson };
export type FusionJsonObject = { [key: string]: FusionJson };

export interface FusionSessionRecord {
  schemaVersion: 'v1';
  lessonSessionId: string;
  learnerId: string;
  credentialRef: string;
  profileSnapshot: FusionJsonObject;
  lessonKnowledgeMap: FusionJsonObject;
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
