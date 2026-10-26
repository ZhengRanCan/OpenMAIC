import { createHash } from 'node:crypto';
import { z } from 'zod';

export const SECTIONS = [
  'background',
  'goals',
  'teaching_requirements',
  'learning_experiences',
] as const;
export type MemorySection = (typeof SECTIONS)[number];
const id = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[\w:./-]+$/);
const text = z
  .string()
  .min(1)
  .max(12000)
  .refine((s) => !s.includes('\0'));
export const scopeSchema = z.strictObject({
  namespace: z.string().regex(/^f67-test:[\w-]{1,80}$/),
  learnerKey: id,
});
export type MemoryScope = z.infer<typeof scopeSchema>;
const rawSourceSchema = z.strictObject({
  id,
  kind: z.enum(['quiz_evidence', 'declaration', 'confirmed_experience']),
  text,
  refs: z.array(text).min(1).max(32),
  conditions: z.array(text).max(32),
  sourceNature: z.enum(['synthetic', 'proxy']),
  occurredAt: z.iso.datetime().nullable(),
  provenance: z.strictObject({
    file: text,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    pointer: z.string().max(500),
    bindings: z.array(z.string().max(3000)).max(32).optional(),
  }),
});
export const sourceSchema = rawSourceSchema.extend({ version: z.string().regex(/^[a-f0-9]{64}$/) });
export type MemorySource = z.infer<typeof sourceSchema>;
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}
export function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
export function versionSource(value: unknown): MemorySource {
  const parsed = rawSourceSchema.parse(value);
  return { ...parsed, version: digest(parsed) };
}
export function assertSource(value: unknown): MemorySource {
  const parsed = sourceSchema.parse(value);
  const { version, ...raw } = parsed;
  if (versionSource(raw).version !== version) throw new MemoryError('SOURCE_VERSION_MISMATCH');
  return parsed;
}
export const budgetsSchema = z.strictObject({
  sections: z.strictObject({
    background: z.number().int().positive().max(12000),
    goals: z.number().int().positive().max(12000),
    teaching_requirements: z.number().int().positive().max(12000),
    learning_experiences: z.number().int().positive().max(12000),
  }),
  total: z.number().int().positive().max(24000),
  inputBytes: z.number().int().positive().max(48000),
  batchSize: z.number().int().min(1).max(16),
});
export type MemoryBudgets = z.infer<typeof budgetsSchema>;
export const DEFAULT_BUDGETS: MemoryBudgets = {
  sections: { background: 300, goals: 300, teaching_requirements: 400, learning_experiences: 1000 },
  total: 2000,
  inputBytes: 48000,
  batchSize: 16,
};
export type Formation = 'declaration' | 'confirmed_experience' | 'synthesis';
export interface MemoryPiece {
  id: string;
  text: string;
  formation: Formation;
  supports: MemorySource[];
  conditions: string[];
  restrictions: string[];
}
export interface MemorySnapshot {
  schemaVersion: 1;
  revision: number;
  sections: Record<MemorySection, string[]>;
  pieces: MemoryPiece[];
}
export function emptySnapshot(): MemorySnapshot {
  return {
    schemaVersion: 1,
    revision: 0,
    sections: { background: [], goals: [], teaching_requirements: [], learning_experiences: [] },
    pieces: [],
  };
}
const decisionSchema = z.strictObject({
  source: id,
  action: z.enum(['adopt', 'already_represented', 'not_adopt', 'defer']),
  pieceIds: z.array(id).max(32),
  reason: text,
});
export const outputSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('capacity_exceeded'), reason: text }),
  z.strictObject({
    status: z.literal('ready'),
    sections: z
      .array(z.strictObject({ section: z.enum(SECTIONS), pieceIds: z.array(id).max(64) }))
      .max(4),
    pieces: z
      .array(
        z.strictObject({
          id,
          text,
          formation: z.enum(['declaration', 'confirmed_experience', 'synthesis']),
          supports: z.array(id).min(1).max(64),
        }),
      )
      .max(64),
    retired: z
      .array(
        z.strictObject({
          id,
          section: z.enum(SECTIONS),
          action: z.enum(['merge', 'budget_remove', 'correct', 'withdraw']),
          replacements: z.array(id).max(32),
          reason: text,
        }),
      )
      .max(256),
    decisions: z.array(decisionSchema).max(16),
  }),
]);
export type MemoryDecision = z.infer<typeof decisionSchema>;
export interface MemoryPrompt {
  version: 'memory.v1' | 'memory.v2';
  system: string;
  user: string;
  digest: string;
  inputBytes: number;
}
export interface CapturedMemoryReply {
  text: string;
  finishReason: string;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  } | null;
  model: string;
  origin: 'model' | 'manual';
}
export interface PreparedMemoryRun {
  id: string;
  scope: MemoryScope;
  state: 'prepared' | 'calling' | 'captured' | 'completed' | 'failed' | 'conflict' | 'noop';
  baseRevision: number;
  snapshot: MemorySnapshot;
  batch: MemorySource[];
  aliases: Record<string, MemorySource>;
  budgets: MemoryBudgets;
  prompt: MemoryPrompt;
  createdAt: string;
  claimToken?: string;
  reply?: CapturedMemoryReply;
  decisions?: MemoryDecision[];
  errorCode?: string;
  adopted?: MemoryPiece[];
}
export const capturedReplySchema = z.strictObject({
  text: z.string().max(250000),
  finishReason: z.string().min(1).max(80),
  model: z.string().min(1).max(200),
  origin: z.enum(['model', 'manual']),
  usage: z
    .strictObject({
      inputTokens: z.number().int().nonnegative().nullable(),
      outputTokens: z.number().int().nonnegative().nullable(),
      totalTokens: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
});
export class MemoryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'MemoryError';
  }
}
export function invariant(ok: unknown, code: string): asserts ok {
  if (!ok) throw new MemoryError(code);
}
export const sourceKey = (s: MemorySource) => s.id + ':' + s.version;
