import { dialogueMemoryFixture } from './dialogue-memory-fixture';
import { ensureDialogueLoopSchema } from '@/lib/persistence/dialogue-learning-loop-schema';
import {
  activateDialogueLoop,
  noteDialogueSessionCreatedIn,
} from '@/lib/server/dialogue-learning-loop/registration';
import { enqueueClosedDialogueIn } from '@/lib/server/dialogue-learning-loop/enqueue';
import { DialogueLoopStore } from '@/lib/server/dialogue-learning-loop/store';
export async function dialogueLoopFixture(url: string) {
  const f = await dialogueMemoryFixture(url);
  await ensureDialogueLoopSchema(f.db);
  await f.db.query(
    'ALTER TABLE stage_meta ADD COLUMN is_public BOOLEAN DEFAULT false, ADD COLUMN published_at BIGINT, ADD COLUMN generation_complete BOOLEAN DEFAULT true',
  );
  const config = {
    sourceNature: 'synthetic' as const,
    conditions: ['authored synthetic fixture'],
    memoryEnvironmentId: f.settings.memoryEnvironmentId,
  };
  await activateDialogueLoop(f.provider, config);
  const jobs = new DialogueLoopStore(f.provider);
  async function create(id = 'newchat') {
    const chat = {
      ...structuredClone(f.chat),
      id,
      learningRunId: 'run',
      learningClosure: { id: 'close-1', source: 'manual_stop' as const },
    };
    await f.provider.withTransaction((tx) =>
      noteDialogueSessionCreatedIn(tx, 'owner', 'stage', id, config),
    );
    await f.save(chat);
    const job = await f.provider.withTransaction((tx) =>
      enqueueClosedDialogueIn(tx, 'owner', { stageId: 'stage', chatSessionId: id }, config),
    );
    return { chat, job: job! };
  }
  return { ...f, config, jobs, create };
}
