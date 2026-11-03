import { randomUUID } from 'node:crypto';
import type { Queryable } from '@openmaic/storage/document/pg';
import type { RuntimeRecord } from '@openmaic/dsl';
import { fenceOwnerWrite } from '@/lib/persistence/owner-merges';
import { readDialogueSourceIn } from '@/lib/persistence/dialogue-trace-read';
import { foldRecords } from '@/lib/utils/chat-storage-core';
import { digest } from '@/lib/learner-memory/contracts';
import { DIALOGUE_PROMPT_VERSION } from '@/lib/dialogue/evidence-contracts';
import {
  learningClosureSchema,
  type DialogueLoopJob,
} from '@/lib/dialogue/learning-loop-contracts';
import { assertDialogueActivationIn, registerDialogueSessionIn } from './registration';
import type { DialogueLoopConfig } from './config';

export async function enqueueClosedDialogueIn(
  tx: Queryable,
  owner: string,
  locator: { stageId: string; chatSessionId: string },
  config: DialogueLoopConfig,
): Promise<DialogueLoopJob | null> {
  await fenceOwnerWrite(tx, owner);
  await assertDialogueActivationIn(tx, config);
  const stage = await tx.query(
    'SELECT stage_id FROM stage_meta WHERE stage_id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE',
    [locator.stageId, owner],
  );
  if (!stage.rows.length) return null;
  const read = await readDialogueSourceIn(tx, owner, locator);
  if (read.status !== 'available' || read.source.status !== 'completed') return null;
  const source = read.source;
  const records = await tx.query(
    'SELECT data FROM runtime_records WHERE session_id=$1 ORDER BY seq',
    [source.runtimeSessionId],
  );
  const state = foldRecords(records.rows.map((r) => r.data as RuntimeRecord)).state;
  const closure = learningClosureSchema.safeParse(state?.learningClosure);
  if (!closure.success) return null;
  const binding = await registerDialogueSessionIn(tx, source, state?.learningRunId, config);
  const key = digest({
    owner,
    ...locator,
    content: source.contentDigest,
    prompt: DIALOGUE_PROMPT_VERSION,
    config,
  });
  const existing = await tx.query('SELECT data FROM dialogue_loop_jobs WHERE reuse_key=$1', [key]);
  if (existing.rows.length) return existing.rows[0].data as DialogueLoopJob;
  if (binding)
    await tx.query(
      'INSERT INTO dialogue_loop_bindings(owner_id,stage_id,chat_session_id,source_digest,environment_id,binding) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING',
      [
        owner,
        source.stageId,
        source.chatSessionId,
        source.contentDigest,
        config.memoryEnvironmentId,
        JSON.stringify(binding),
      ],
    );
  const job: DialogueLoopJob = {
    id: randomUUID(),
    ownerId: owner,
    ...locator,
    key,
    state: binding ? 'queued' : 'not_eligible',
    reason: binding ? null : 'not_eligible',
    snapshot: source,
    binding,
    closure: closure.data,
    configDigest: digest(config),
    evidenceRunId: null,
    memoryDeliveryId: null,
    blockingDeliveryId: null,
    evidenceState: 'pending',
    memoryState: 'pending',
    token: null,
    leaseExpiresAt: null,
    createdAt: new Date().toISOString(),
  };
  await tx.query(
    'INSERT INTO dialogue_loop_jobs(id,owner_id,stage_id,chat_session_id,reuse_key,environment_id,student,state,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',
    [
      job.id,
      owner,
      source.stageId,
      source.chatSessionId,
      key,
      config.memoryEnvironmentId,
      binding?.student ?? null,
      job.state,
      JSON.stringify(job),
    ],
  );
  return job;
}
