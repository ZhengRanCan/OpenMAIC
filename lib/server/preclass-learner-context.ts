import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { z } from 'zod';
import type { ConnectableQueryable } from '@openmaic/storage/server/reference';
import type { MemoryPiece } from '@/lib/learner-memory/contracts';
import { simulatedScope } from '@/lib/learner-memory/simulated-seeds';
import { LearnerMemoryStore } from '@/lib/persistence/learner-memory-store';
import { readMemory } from '@/lib/server/learner-memory';
import {
  LEARNER_CONTEXT_MAX_REPLY_BYTES,
  PreclassLearnerContextError,
  type FrozenLearnerContext,
  type PreclassSelectionPrompt,
  type SimulatedLearnerId,
} from '@/lib/learner-context/contracts';
import { buildPreclassSelectionPrompt } from '@/lib/learner-context/prompt';

export { renderPreclassLearnerContext } from '@/lib/learner-context/render';

export type PreclassMemoryRead = Awaited<ReturnType<typeof readMemory>>;
export type PreclassMemoryReader = (student: SimulatedLearnerId) => Promise<PreclassMemoryRead>;

async function readSimulatedMemory(student: SimulatedLearnerId): Promise<PreclassMemoryRead> {
  const connectionString = process.env.MEMORY_DATABASE_URL?.trim();
  if (!connectionString) throw new PreclassLearnerContextError('LEARNER_MEMORY_UNAVAILABLE');
  const scope = simulatedScope(student);
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 5_000,
    query_timeout: 10_000,
    statement_timeout: 10_000,
    lock_timeout: 5_000,
    max: 1,
    options: '-c search_path=f67_simulated_memory',
  });
  let idleError: Error | undefined;
  pool.on('error', (error: Error) => {
    idleError = error;
  });
  try {
    const { nodePostgresTransaction } = await import('@openmaic/storage/server/reference');
    const withTransaction = nodePostgresTransaction(pool as unknown as ConnectableQueryable);
    const store = new LearnerMemoryStore({
      withTransaction: (body) =>
        withTransaction(async (tx) => {
          // The formal store normally creates an empty state when absent. F65 only
          // consumes initialized simulated identities, so hold its existing row
          // throughout the formal read and never turn missing setup into empty Memory.
          const existing = await tx.query(
            'SELECT learner_key FROM learner_memory_states WHERE namespace=$1 AND learner_key=$2 FOR UPDATE',
            [scope.namespace, scope.learnerKey],
          );
          if (!existing.rows.length)
            throw new PreclassLearnerContextError('LEARNER_MEMORY_UNAVAILABLE');
          return body(tx);
        }),
    });
    const result = await readMemory(store, scope);
    if (idleError) throw idleError;
    return result;
  } finally {
    await pool.end();
  }
}

function requireUsable(view: PreclassMemoryRead) {
  if (view.maintenancePending || view.usable.restricted.length)
    throw new PreclassLearnerContextError('LEARNER_MEMORY_RECHECK_REQUIRED');
}

function requireValidSupports(selected: Pick<MemoryPiece, 'supports'>[], view: PreclassMemoryRead) {
  const valid = new Set(
    view.coverage
      .filter((source) => source.valid)
      .map((source) => `${source.source_id}:${source.version}`),
  );
  if (
    selected.some(
      (piece) =>
        !piece.supports.length ||
        piece.supports.some((source) => !valid.has(`${source.id}:${source.version}`)),
    )
  )
    throw new PreclassLearnerContextError('LEARNER_MEMORY_RECHECK_REQUIRED');
}

const selectionSchema = z.strictObject({
  selected: z
    .array(
      z.strictObject({
        pieceId: z.string().min(1).max(160),
        reason: z.string().trim().min(1).max(1000),
      }),
    )
    .max(64),
});

function parseSelection(reply: string, candidates: MemoryPiece[]) {
  if (Buffer.byteLength(reply, 'utf8') > LEARNER_CONTEXT_MAX_REPLY_BYTES)
    throw new PreclassLearnerContextError('LEARNER_CONTEXT_SELECTION_INVALID');
  let parsed: z.infer<typeof selectionSchema>;
  try {
    parsed = selectionSchema.parse(JSON.parse(reply));
  } catch {
    throw new PreclassLearnerContextError('LEARNER_CONTEXT_SELECTION_INVALID');
  }
  const byId = new Map(candidates.map((piece) => [piece.id, piece]));
  const seen = new Set<string>();
  return parsed.selected.map(({ pieceId, reason }) => {
    const piece = byId.get(pieceId);
    if (!piece || seen.has(pieceId))
      throw new PreclassLearnerContextError('LEARNER_CONTEXT_SELECTION_INVALID');
    seen.add(pieceId);
    return {
      pieceId,
      reason,
      text: piece.text,
      formation: piece.formation,
      conditions: structuredClone(piece.conditions),
      supports: structuredClone(piece.supports),
    };
  });
}

const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function buildPreclassLearnerContext(
  input: {
    student: SimulatedLearnerId;
    task: string;
    content: { pdfText?: string; researchContext?: string };
  },
  deps: {
    read?: PreclassMemoryReader;
    select: (prompt: PreclassSelectionPrompt) => Promise<string>;
  },
): Promise<FrozenLearnerContext> {
  if (!['A', 'B', 'C'].includes(input.student))
    throw new PreclassLearnerContextError('UNKNOWN_SIMULATED_STUDENT');
  const view = await (deps.read ?? readSimulatedMemory)(input.student);
  requireUsable(view);
  // Only the formal trusted section projection is a candidate, never audit snapshot text.
  const candidates = [
    ...new Map(
      Object.values(view.sections)
        .flat()
        .map((piece) => [piece.id, piece]),
    ).values(),
  ];
  requireValidSupports(candidates, view);
  const base = {
    schemaVersion: 'learner-context.v1' as const,
    promptVersion: 'learner-context-selection.v1' as const,
    student: input.student,
    memoryRevision: view.usable.revision,
    taskDigest: fingerprint(input.task),
    contentDigest: fingerprint({
      pdfText: input.content.pdfText ?? '',
      researchContext: input.content.researchContext ?? '',
    }),
  };
  if (!candidates.length) return { ...base, status: 'empty', selected: [] };
  const prompt = buildPreclassSelectionPrompt({ ...input, candidates });
  const selected = parseSelection(await deps.select(prompt), candidates);
  return { ...base, status: selected.length ? 'ready' : 'no_relevant', selected };
}

/** Revision changes alone do not reselect; only validity of frozen dependencies matters. */
export async function assertPreclassContextCurrent(
  context: FrozenLearnerContext,
  deps: { read?: PreclassMemoryReader } = {},
): Promise<void> {
  const view = await (deps.read ?? readSimulatedMemory)(context.student);
  requireUsable(view);
  requireValidSupports(context.selected, view);
}
