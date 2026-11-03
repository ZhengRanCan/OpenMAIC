import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Queryable } from '@openmaic/storage/document/pg';
import {
  bindingSchema,
  DialogueEvidenceError,
  type DialogueBinding,
  type DialogueEvidenceSettings,
} from '@/lib/dialogue/evidence-contracts';
import type { DialogueSourceWindow } from '@/lib/dialogue/trace-types';
import { readSimulatedLearningLoopConfig } from './quiz-learning-loop/config';

export function parseDialogueBindings(input: unknown): DialogueBinding[] {
  const parsed = z
    .strictObject({ version: z.literal(1), sources: z.array(bindingSchema).max(1000) })
    .safeParse(input);
  if (!parsed.success) throw new DialogueEvidenceError('INVALID_DIALOGUE_BINDINGS', 503);
  const keys = parsed.data.sources.map((b) =>
    JSON.stringify([b.ownerId, b.stageId, b.chatSessionId, b.sourceDigest]),
  );
  if (new Set(keys).size !== keys.length)
    throw new DialogueEvidenceError('INVALID_DIALOGUE_BINDINGS', 503);
  return parsed.data.sources;
}
export async function loadDialogueEvidenceSettings(
  env: Record<string, string | undefined> = process.env,
): Promise<DialogueEvidenceSettings> {
  if (env.OPENMAIC_DIALOGUE_EVIDENCE_ENABLED !== 'true')
    throw new DialogueEvidenceError('NOT_FOUND', 404);
  const config = readSimulatedLearningLoopConfig(env);
  if (!config || !env.OPENMAIC_DIALOGUE_EVIDENCE_BINDINGS_FILE)
    return { bindings: [], memoryEnvironmentId: config?.memoryEnvironmentId ?? '' };
  try {
    const raw = await readFile(env.OPENMAIC_DIALOGUE_EVIDENCE_BINDINGS_FILE, 'utf8');
    if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error('size');
    const bindings = parseDialogueBindings(JSON.parse(raw));
    if (bindings.some((b) => b.sourceNature !== config.sourceNature)) throw new Error('nature');
    return { bindings, memoryEnvironmentId: config.memoryEnvironmentId };
  } catch {
    throw new DialogueEvidenceError('INVALID_DIALOGUE_BINDINGS', 503);
  }
}
export function matchDialogueBinding(
  source: DialogueSourceWindow,
  settings: DialogueEvidenceSettings,
): DialogueBinding | null {
  const matches = settings.bindings.filter(
    (b) =>
      b.ownerId === source.ownerId &&
      b.stageId === source.stageId &&
      b.chatSessionId === source.chatSessionId &&
      b.sourceDigest === source.contentDigest &&
      b.memoryEnvironmentId === settings.memoryEnvironmentId,
  );
  return matches.length === 1 ? matches[0] : null;
}
/** This proof supplements an exact Session registration; a Scene alone proves no learner identity. */
export async function verifyDialogueBindingIn(
  tx: Queryable,
  source: DialogueSourceWindow,
  binding: DialogueBinding,
): Promise<boolean> {
  const scene = source.initialContext?.sceneId;
  if (source.initialContext && source.initialContext.stageId !== source.stageId) return false;
  const tables = await tx.query(
    "SELECT to_regclass('generation_runs') AS runs, to_regclass('generation_run_steps') AS steps, to_regclass('quiz_learning_scene_bindings') AS retained",
  );
  if (!tables.rows[0]?.runs) return false;
  // Legacy/missing background remains missing. An explicit exact-Session registration
  // plus the run's owner/stage/student is required; no Scene is guessed or added.
  if (!scene) {
    const result = await tx.query(
      "SELECT id FROM generation_runs WHERE id=$1 AND owner_id=$2 AND stage_id=$3 AND input->>'simulatedLearner'=$4",
      [binding.generationRunId, binding.ownerId, binding.stageId, binding.student],
    );
    return result.rows.length === 1;
  }
  const proof: string[] = [];
  if (tables.rows[0].steps)
    proof.push(
      `EXISTS(SELECT 1 FROM generation_run_steps s WHERE s.run_id=g.id AND s.step_id LIKE 'scene:%:narration' AND s.output->'scene'->>'id'=$5 AND s.output->'scene'->>'stageId'=g.stage_id)`,
    );
  if (tables.rows[0].retained)
    proof.push(
      'EXISTS(SELECT 1 FROM quiz_learning_scene_bindings b WHERE b.run_id=g.id AND b.owner_id=g.owner_id AND b.stage_id=g.stage_id AND b.student=$4 AND b.scene_id=$5)',
    );
  if (!proof.length) return false;
  const result = await tx.query(
    `SELECT g.id FROM generation_runs g WHERE g.id=$1 AND g.owner_id=$2 AND g.stage_id=$3 AND g.input->>'simulatedLearner'=$4 AND (${proof.join(' OR ')})`,
    [binding.generationRunId, binding.ownerId, binding.stageId, binding.student, scene],
  );
  return result.rows.length === 1;
}
