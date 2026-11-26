import { z } from 'zod';

const id = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[\w:.-]+$/);
const text = z
  .string()
  .min(1)
  .max(12000)
  .refine((s) => !s.includes('\0'));
export const partSchema = z.strictObject({
  question: text.optional(),
  options: z.array(text).max(20).optional(),
  answer: text.optional(),
  review: z.enum(['correct', 'incorrect', 'unknown']).optional(),
  previous: z
    .array(z.strictObject({ role: z.enum(['teacher', 'student']), text }))
    .max(8)
    .optional(),
  help: z.enum(['practice-requested', 'prior-teacher-messages', 'unknown']).default('unknown'),
});
export const eventSchema = z
  .strictObject({
    id,
    learnerId: id,
    ordinal: z.number().int().nonnegative(),
    occurredAt: z.iso.datetime().nullable(),
    kind: z.enum(['quiz', 'qa', 'discussion']),
    origin: z.enum(['synthetic', 'public']),
    parts: z.array(partSchema).min(1).max(16),
    questionId: z.string().optional(),
    concepts: z.array(z.string()).optional(),
    recordedTime: z.string().max(200).optional(),
  })
  .superRefine((e, ctx) => {
    for (const p of e.parts) {
      if (e.kind === 'quiz' && p.review === undefined)
        ctx.addIssue({
          code: 'custom',
          message: 'Quiz requires explicit review, including unknown',
        });
      if (e.kind !== 'quiz' && !p.answer)
        ctx.addIssue({ code: 'custom', message: 'Dialogue requires learner utterance' });
      if (
        !p.answer &&
        (e.origin !== 'public' || !p.question || !p.review || p.review === 'unknown')
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'Missing answer requires a public question and scored outcome',
        });
      }
    }
  });
export const questionSchema = z.strictObject({
  id,
  learnerId: id,
  category: z.enum(['IE', 'MR', 'HC']),
  question: text,
  gold: text,
  sourceIds: z.array(id).default([]),
});
export const configSchema = z
  .strictObject({
    mode: z.enum(['fixture', 'live']).default('fixture'),
    model: z.string().min(1).optional(),
    batchSize: z.number().int().min(1).max(16).default(1),
    maxCalls: z.number().int().min(1).max(10000).default(100),
    timeoutMs: z.number().int().min(100).max(300000).default(60000),
    maxRetries: z.number().int().min(0).max(2).default(0),
    maxOutputTokens: z.number().int().min(256).max(16000).default(6000),
    temperature: z.number().min(0).max(2).default(0),
    checkpoints: z.array(z.number().int().positive()).default([1, 5, 10, 20]),
    allowPublicExternal: z.boolean().default(false),
    permissionNote: z.string().max(1000).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.mode === 'live' && !c.model)
      ctx.addIssue({ code: 'custom', message: 'Live mode needs an explicit model' });
    if (c.allowPublicExternal && !c.permissionNote)
      ctx.addIssue({
        code: 'custom',
        message: 'Public external processing needs a permission note',
      });
  });
export type Event = z.infer<typeof eventSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Config = z.infer<typeof configSchema>;
export type Method = 'direct' | 'two-stage';
export type Stage = 'extract' | 'memory' | 'answer' | 'judge';
export type CallRequest = { stage: Stage; system: string; user: string; fixtureReply: string };
export type ModelReply = {
  text: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason: string;
};
export type Invoker = (request: CallRequest, signal: AbortSignal) => Promise<ModelReply>;
export type CallRecord = {
  index: number;
  stage: Stage;
  system: string;
  user: string;
  model: string;
  learnerId?: string;
  method?: Method;
  questionId?: string;
  text?: string;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
  error?: string;
  finishReason?: string;
};
export const safeError = (error: unknown) => {
  if (error instanceof z.ZodError) return 'SCHEMA_VALIDATION_FAILED';
  if (error instanceof SyntaxError) return 'INVALID_JSON';
  return error instanceof Error && /^[A-Z][A-Z0-9_]{2,100}$/.test(error.message)
    ? error.message
    : 'STAGE_EXECUTION_FAILED';
};
