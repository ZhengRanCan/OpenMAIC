import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  nodePostgresTransaction,
  type ConnectableQueryable,
} from '@openmaic/storage/server/reference';
import {
  dialogueEvidenceFixture,
  model as evidenceModel,
  reply,
} from './dialogue-evidence-fixture';
import { ensureDialogueMemorySchema } from '@/lib/persistence/dialogue-memory-schema';
import { ensureMemorySchema } from '@/lib/persistence/learner-memory-schema';
import { SimulatedMemoryEnvironment } from '@/lib/learner-memory/simulated-environment';
import { createDialogueMemoryAuthority } from '@/lib/server/dialogue-memory-authority';
import { DIALOGUE_MEMORY_SYSTEM } from '@/lib/learner-memory/dialogue-prompt';
import { DialogueMemoryService } from '@/lib/server/dialogue-memory';
import type { PreparedMemoryRun, CapturedMemoryReply } from '@/lib/learner-memory/contracts';

export const memoryModel = {
  ...evidenceModel,
  maxOutputTokens: 8192,
  timeoutMs: 180000,
  promptVersion: 'dialogue-memory.v1',
};
export async function dialogueMemoryFixture(url: string) {
  const app = await dialogueEvidenceFixture(url);
  await ensureDialogueMemorySchema(app.db);
  const e = await app.store.prepare('owner', app.request(), app.settings, evidenceModel);
  await app.store.capture(
    'owner',
    (await app.store.claim('owner', e.id, app.settings))!,
    reply,
    app.settings,
  );
  const evidence = await app.store.finalize('owner', e.id);
  const schema = 'f74_memory_' + randomUUID().replaceAll('-', '');
  await app.db.query('CREATE SCHEMA ' + schema);
  const db = new Pool({ connectionString: url, options: '-c search_path=' + schema, max: 6 });
  await ensureMemorySchema(db);
  await db.query(
    'CREATE TABLE f68_memory_environment(singleton BOOLEAN PRIMARY KEY,id TEXT NOT NULL)',
  );
  await db.query('INSERT INTO f68_memory_environment VALUES(true,$1)', [
    app.settings.memoryEnvironmentId,
  ]);
  const provider = {
    withTransaction: nodePostgresTransaction(db as unknown as ConnectableQueryable),
    systemPrompt: DIALOGUE_MEMORY_SYSTEM,
    sourceAuthority: createDialogueMemoryAuthority(app.provider, async () => app.settings),
  };
  const memory = new SimulatedMemoryEnvironment(provider);
  await memory.initialize();
  const service = new DialogueMemoryService(app.provider, memory, async () => app.settings);
  const request = () => ({ operationId: randomUUID(), evidenceRunId: evidence.id });
  return {
    ...app,
    evidence,
    memory,
    memoryDb: db,
    service,
    request,
    close: async () => {
      await db.end();
      await app.db.query('DROP SCHEMA ' + schema + ' CASCADE');
      await app.close();
    },
  };
}
export function controlledMemoryReply(
  run: PreparedMemoryRun,
  action: 'adopt' | 'not_adopt' | 'defer' | 'already_represented' = 'adopt',
): CapturedMemoryReply {
  const keep = run.snapshot.sections.learning_experiences;
  const target = keep[0] ?? run.snapshot.pieces[0]?.id;
  return {
    text: JSON.stringify({
      status: 'ready',
      sections:
        action === 'adopt'
          ? [{ section: 'learning_experiences', pieceIds: [...keep, 'new:1'] }]
          : [],
      pieces:
        action === 'adopt'
          ? [{ id: 'new:1', text: run.batch[0].text, formation: 'synthesis', supports: ['e1'] }]
          : [],
      retired: [],
      decisions: run.batch.map((_, i) => ({
        source: 'e' + (i + 1),
        action,
        pieceIds: action === 'adopt' ? ['new:1'] : action === 'already_represented' ? [target] : [],
        reason: 'synthetic controlled decision',
      })),
    }),
    finishReason: 'stop',
    model: 'synthetic-control',
    origin: 'model',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  };
}
