import { z } from 'zod';

export const LEARNER_PROFILE_NAME_MAX = 80;
export const learnerProfileNameSchema = z.string().trim().min(1).max(LEARNER_PROFILE_NAME_MAX);
const profileId = z.uuid().transform((value) => value.toLowerCase());
export const learnerProfileSelectionSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('none') }),
  z.strictObject({
    mode: z.literal('blank'),
    requestId: z
      .string()
      .min(16)
      .max(100)
      .regex(/^[\w-]+$/),
  }),
  z.strictObject({ mode: z.literal('existing'), profileId }),
]);

export type LearnerProfileSelection = z.infer<typeof learnerProfileSelectionSchema>;
export type LearnerProfileChoice =
  | { mode: 'none' }
  | { mode: 'blank' }
  | { mode: 'existing'; profileId: string; name: string | null };

export type LearnerProfileSummary = {
  id: string;
  name: string | null;
};

export interface ClassroomLearnerProfile {
  profile: LearnerProfileSummary;
  promptName: boolean;
}
