import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { ensureSchema, PgRuntimeStore } from '@openmaic/storage/runtime/pg';
import {
  nodePostgresTransaction,
  type ConnectableQueryable,
} from '@openmaic/storage/server/reference';
import { ensureDialogueEvidenceSchema } from '@/lib/persistence/dialogue-evidence-schema';
import { ensureGenerationRunSchema } from '@/lib/persistence/generation-runs';
import { ensureOwnerMergeSchema } from '@/lib/persistence/owner-merges';
import { buildChatRecordInit, statePayload, runtimeSessionId } from '@/lib/utils/chat-storage-core';
import { readDialogueSource } from '@/lib/persistence/dialogue-trace-read';
import { DialogueEvidenceStore } from '@/lib/persistence/dialogue-evidence-store';
import type { ChatSession } from '@/lib/types/chat';
import type {
  DialogueEvidenceSettings,
  DialogueModelIdentity,
} from '@/lib/dialogue/evidence-contracts';

export const model: DialogueModelIdentity = {
  provider: 'synthetic',
  model: 'test',
  endpointFingerprint: 'none',
  slot: 'classroom',
  thinking: null,
  maxOutputTokens: 4096,
  timeoutMs: 120000,
  promptVersion: 'dialogue-prompt.v1',
};
export const reply = {
  text: '{"facts":[{"type":"learning_performance","evidence":"提示后算出4。","refs":["t","s"]}]}',
  finishReason: 'stop',
  usage: null,
  actualModel: 'synthetic-test',
  receivedAt: new Date(1000).toISOString(),
  durationMs: 10,
};
export async function dialogueEvidenceFixture(url: string) {
  const schema = 'f73_test_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: url });
  await admin.query('CREATE SCHEMA ' + schema);
  const db = new Pool({ connectionString: url, options: '-c search_path=' + schema, max: 6 });
  const provider = {
    withTransaction: nodePostgresTransaction(db as unknown as ConnectableQueryable),
  };
  const runtime = new PgRuntimeStore(db, provider);
  const close = async () => {
    await db.end();
    await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
    await admin.end();
  };
  try {
    await ensureSchema(db);
    await ensureOwnerMergeSchema(db);
    await db.query(
      'CREATE TABLE stage_meta(stage_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,deleted_at TIMESTAMPTZ)',
    );
    await db.query("INSERT INTO stage_meta VALUES('stage','owner',NULL)");
    await ensureGenerationRunSchema(db);
    await ensureDialogueEvidenceSchema(db);
    await db.query(
      `INSERT INTO generation_runs(id,owner_id,stage_id,input,state) VALUES('run','owner','stage','{"simulatedLearner":"A"}','completed')`,
    );
    await db.query(
      `INSERT INTO generation_run_steps(run_id,step_id,output) VALUES('run','scene:0:narration','{"scene":{"id":"scene","stageId":"stage"}}')`,
    );
  } catch (e) {
    await close();
    throw e;
  }
  const chat: ChatSession = {
    id: 'chat',
    type: 'qa',
    title: 'Synthetic QA',
    status: 'completed',
    createdAt: 1,
    updatedAt: 2,
    initialContext: { stageId: 'stage', stageTitle: '课', sceneId: 'scene', sceneTitle: '题' },
    messages: [
      { id: 't', role: 'assistant', parts: [{ type: 'text', text: '80÷20是多少？' }] },
      { id: 's', role: 'user', parts: [{ type: 'text', text: '4' }] },
    ],
    config: { agentIds: ['tutor'] },
    toolCalls: [],
    pendingToolCalls: [],
  };
  async function save(next = chat, generation = 0) {
    const id = runtimeSessionId('stage', 'owner', next.id);
    // Use the production generation ID convention rather than an arbitrary suffix.
    const { generationRuntimeSessionId } = await import('@/lib/utils/chat-storage-core');
    const rid = generation ? generationRuntimeSessionId(id, generation, 'fixture') : id;
    await runtime.createSession({
      id: rid,
      stageId: 'stage',
      learnerKey: 'owner',
      kind: 'chat',
      status: 'active',
      createdAt: new Date(next.createdAt).toISOString(),
      updatedAt: new Date(next.updatedAt).toISOString(),
    });
    for (const message of next.messages)
      await runtime.appendRecord(
        buildChatRecordInit(
          rid,
          {
            kind: 'chat_message',
            payloadVersion: 1,
            role: message.role,
            content: message.parts
              .filter((p) => p.type === 'text')
              .map((p) => p.text)
              .join(''),
            message,
            sessionUpdatedAt: next.updatedAt,
          },
          next,
          'message:' + message.id,
        ),
      );
    await runtime.appendRecord(buildChatRecordInit(rid, statePayload(next), next, 'state'));
    return rid;
  }
  await save();
  const settings: DialogueEvidenceSettings = {
    memoryEnvironmentId: '00000000-0000-4000-8000-000000000001',
    bindings: [],
  };
  async function register() {
    const read = await readDialogueSource(provider, 'owner', {
      stageId: 'stage',
      chatSessionId: chat.id,
    });
    if (read.status !== 'available') throw Error(read.status);
    settings.bindings.push({
      ownerId: 'owner',
      stageId: 'stage',
      chatSessionId: chat.id,
      sourceDigest: read.source.contentDigest,
      generationRunId: 'run',
      student: 'A',
      sourceNature: 'synthetic',
      conditions: ['authored synthetic fixture'],
      memoryEnvironmentId: settings.memoryEnvironmentId,
    });
    return read.source;
  }
  await register();
  const store = new DialogueEvidenceStore(provider);
  const request = () => ({ operationId: randomUUID(), stageId: 'stage', chatSessionId: 'chat' });
  return { db, provider, runtime, close, chat, save, register, settings, store, request };
}
