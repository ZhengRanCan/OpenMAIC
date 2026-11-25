import { z } from 'zod';
import {
  learnerProfileNameSchema,
  type LearnerProfileSummary,
} from '@/lib/learner-context/learner-profile-contracts';

export const PROFILE_MEMORY_FIELDS_MAX = 1200;
const field = z
  .string()
  .trim()
  .max(PROFILE_MEMORY_FIELDS_MAX)
  .refine((value) => !value.includes('\0'));
export const profileMemoryEdit = z.strictObject({
  revision: z.number().int().nonnegative().max(2_147_483_646),
  name: learnerProfileNameSchema.refine((value) => !value.includes('\0')),
  background: field,
  goals: field,
  preferences: field,
});
export type ProfileMemoryEdit = z.infer<typeof profileMemoryEdit>;

export const profileMemoryClassroom = z.strictObject({
  stageId: z
    .string()
    .min(1)
    .max(256)
    .refine((value) => !value.includes('\0')),
});
export type ProfileMemoryClassroom = { stageId: string; title: string };
export type ProfileMemoryImportStatus = { total: number; pending: number; failed: number };

export const PROFILE_MEMORY_SECTIONS = [
  'background',
  'goals',
  'preferences',
  'experiences',
] as const;
export type ProfileMemorySection = (typeof PROFILE_MEMORY_SECTIONS)[number];
export const profileMemoryResult = z.strictObject({
  records: z
    .array(
      z.strictObject({
        section: z.enum(PROFILE_MEMORY_SECTIONS),
        summary: z
          .string()
          .trim()
          .min(1)
          .max(320)
          .refine((value) => !value.includes('\0')),
        refs: z.array(z.number().int().min(0).max(99)).min(1).max(3),
      }),
    )
    .max(3),
});
export type ProfileMemoryRecord = z.infer<typeof profileMemoryResult>['records'][number];
export type ProfileMemoryKind = 'quiz' | 'qa' | 'discussion';
export type ProfileMemoryReviewResult = 'correct' | 'incorrect' | 'unknown';
export type ProfileMemorySource = {
  stageId: string;
  title: string;
  kind: ProfileMemoryKind;
  occurredAt: string;
  historicalReview?: boolean;
  reviewHistory?: {
    ordinal: number;
    savedAt: string;
    current: boolean;
    results: ProfileMemoryReviewResult[];
  }[];
  parts: {
    question?: string;
    options?: string[];
    answer: string;
    review?: ProfileMemoryReviewResult;
    previous?: { role: 'teacher' | 'student'; text: string }[];
    help: 'practice-requested' | 'prior-teacher-messages' | 'unknown';
  }[];
};
export type ProfileMemoryItem = {
  id: string;
  section: ProfileMemorySection;
  summary: string;
  kind: ProfileMemoryKind;
  flagged: boolean;
};
export type ProfileMemoryView = {
  profile: LearnerProfileSummary;
  fields: Omit<ProfileMemoryEdit, 'name'>;
  items: ProfileMemoryItem[];
  maintenance: { pending: boolean; failed: boolean };
};
