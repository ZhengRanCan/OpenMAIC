import { PgRuntimeStore } from '@openmaic/storage/runtime/pg';
import type { RuntimeStore } from '@openmaic/storage';
import type { Queryable } from '@openmaic/storage/document/pg';
import type { RuntimeSession } from '@openmaic/dsl';
import { APP_RUNTIME_PAYLOAD_VALIDATORS } from '@/lib/runtime/payload-validators';
import {
  readDialogueLoopConfig,
  type DialogueLoopConfig,
} from '@/lib/server/dialogue-learning-loop/config';
import {
  activateDialogueLoop,
  chatIdFromRuntime,
  noteDialogueSessionCreatedIn,
} from '@/lib/server/dialogue-learning-loop/registration';
import { enqueueClosedDialogueIn } from '@/lib/server/dialogue-learning-loop/enqueue';
import type { LoopProvider } from '@/lib/server/dialogue-learning-loop/store';
import { fenceOwnerWrite } from './owner-merges';
import { guardedServerRuntimeStore } from './runtime-tombstone-guard';
import { restrictDialogueLoopIn } from './dialogue-learning-loop-lifecycle';
import { CHAT_DELETION_KIND, deletionMarkerPrefix } from '@/lib/utils/chat-storage-core';
import { readDialogueSourceIn } from './dialogue-trace-read';
const runtimeIn = (tx: Queryable) =>
  guardedServerRuntimeStore(
    new PgRuntimeStore(tx, {
      withTransaction: (body) => body(tx),
      payloadValidators: APP_RUNTIME_PAYLOAD_VALIDATORS,
      resolveFinalLearner: async (pinned, owner) => {
        await fenceOwnerWrite(pinned, owner);
        return owner;
      },
    }),
    tx,
  );
async function fenceSession(tx: Queryable, s: Pick<RuntimeSession, 'learnerKey' | 'stageId'>) {
  await fenceOwnerWrite(tx, s.learnerKey);
  await tx.query('SELECT stage_id FROM stage_meta WHERE stage_id=$1 AND owner_id=$2 FOR UPDATE', [
    s.stageId,
    s.learnerKey,
  ]);
}
/** Final Runtime commit and closure/outbox share one actual transaction. */
export function dialogueLoopRuntime(
  inner: RuntimeStore,
  provider: LoopProvider,
  config: () => DialogueLoopConfig | null = readDialogueLoopConfig,
): RuntimeStore {
  async function deleteRuntime(
    scope: { stageId?: string; ownerId?: string; sessionId?: string },
    body: (runtime: RuntimeStore) => Promise<void>,
  ) {
    return provider.withTransaction(async (tx) => {
      const values: string[] = [];
      const filters: string[] = [];
      for (const [column, value] of [
        ['stage_id', scope.stageId],
        ['learner_key', scope.ownerId],
        ['id', scope.sessionId],
      ] as const) {
        if (value !== undefined) {
          values.push(value);
          filters.push(column + '=$' + values.length);
        }
      }
      const rows = await tx.query(
        'SELECT id,stage_id,learner_key FROM runtime_sessions' +
          (filters.length ? ' WHERE ' + filters.join(' AND ') : '') +
          ' ORDER BY learner_key,stage_id,id',
        values,
      );
      const seen = new Set<string>();
      const targets: {
        owner: string;
        stage: string;
        chat: string | null | undefined;
        successor?: string;
      }[] = [];
      for (const row of rows.rows) {
        const owner = row.learner_key as string,
          stage = row.stage_id as string;
        const chat = scope.sessionId
          ? chatIdFromRuntime(row.id as string, stage, owner)
          : undefined;
        if (scope.sessionId && !chat) continue;
        const key = JSON.stringify([owner, stage, chat]);
        if (seen.has(key)) continue;
        seen.add(key);
        await fenceSession(tx, { learnerKey: owner, stageId: stage });
        const before = chat
          ? await readDialogueSourceIn(tx, owner, { stageId: stage, chatSessionId: chat })
          : null;
        targets.push({
          owner,
          stage,
          chat,
          ...(before?.status === 'available' && before.source.runtimeSessionId !== scope.sessionId
            ? { successor: before.source.runtimeSessionId }
            : {}),
        });
      }
      await body(runtimeIn(tx));
      for (const { owner, stage, chat, successor } of targets) {
        // Chat persistence retires old generations after saving a valid successor.
        // Deleting that storage row does not delete the logical learning source.
        if (chat && successor) {
          const after = await readDialogueSourceIn(tx, owner, {
            stageId: stage,
            chatSessionId: chat,
          });
          if (after.status === 'available' && after.source.runtimeSessionId === successor) continue;
        }
        await restrictDialogueLoopIn(tx, owner, {
          stageId: stage,
          ...(chat ? { chatSessionId: chat } : {}),
        });
      }
    });
  }
  return {
    ...inner,
    getSession: (id) => inner.getSession(id),
    listSessions: (stage, owner) => inner.listSessions(stage, owner),
    listRecords: (id, options) => inner.listRecords(id, options),
    appendRecord: (init, options) => inner.appendRecord(init, options),
    async createSession(init) {
      const c = config();
      const deletion = init.kind === CHAT_DELETION_KIND;
      if ((!c && !deletion) || !['chat', CHAT_DELETION_KIND].includes(init.kind))
        return inner.createSession(init);
      if (c && !deletion) await activateDialogueLoop(provider, c);
      return provider.withTransaction(async (tx) => {
        await fenceSession(tx, init);
        const previous = await tx.query('SELECT id FROM runtime_sessions WHERE id=$1', [init.id]);
        const logicalId =
          init.kind === 'chat' && init.id
            ? chatIdFromRuntime(init.id, init.stageId, init.learnerKey)
            : null;
        const siblings = logicalId
          ? await tx.query(
              "SELECT id FROM runtime_sessions WHERE stage_id=$1 AND learner_key=$2 AND kind='chat'",
              [init.stageId, init.learnerKey],
            )
          : { rows: [] };
        const hadLogicalSession =
          logicalId &&
          siblings.rows.some(
            (r) => chatIdFromRuntime(r.id as string, init.stageId, init.learnerKey) === logicalId,
          );
        const result = await runtimeIn(tx).createSession(init);
        const chat = init.id && chatIdFromRuntime(init.id, init.stageId, init.learnerKey);
        if (!previous.rows.length && init.kind === 'chat' && chat && c) {
          if (hadLogicalSession)
            await tx.query(
              "INSERT INTO dialogue_loop_sessions(owner_id,stage_id,chat_session_id,is_new,reason) VALUES($1,$2,$3,false,'preexisting_unregistered') ON CONFLICT DO NOTHING",
              [init.learnerKey, init.stageId, chat],
            );
          else await noteDialogueSessionCreatedIn(tx, init.learnerKey, init.stageId, chat, c);
        }
        if (
          init.kind === CHAT_DELETION_KIND &&
          init.id?.startsWith(deletionMarkerPrefix(init.stageId))
        ) {
          const encoded = init.id.slice(deletionMarkerPrefix(init.stageId).length).split(':')[0];
          let id: string | null = null;
          try {
            id = decodeURIComponent(encoded);
          } catch {
            /* invalid marker is not a permission grant */
          }
          if (id)
            await restrictDialogueLoopIn(tx, init.learnerKey, {
              stageId: init.stageId,
              chatSessionId: id,
            });
        }
        return result;
      });
    },
    async setSessionStatus(id, status, at, options) {
      const c = config();
      if (!c || status !== 'completed') return inner.setSessionStatus(id, status, at, options);
      const s = await inner.getSession(id);
      if (s?.kind !== 'chat') return inner.setSessionStatus(id, status, at, options);
      await activateDialogueLoop(provider, c);
      return provider.withTransaction(async (tx) => {
        await fenceSession(tx, s);
        const result = await runtimeIn(tx).setSessionStatus(id, status, at, options);
        const chat = chatIdFromRuntime(id, s.stageId, s.learnerKey);
        if (chat)
          await enqueueClosedDialogueIn(
            tx,
            s.learnerKey,
            { stageId: s.stageId, chatSessionId: chat },
            c,
          );
        return result;
      });
    },
    deleteSession: (id) => deleteRuntime({ sessionId: id }, (r) => r.deleteSession(id)),
    mergeLearner: (from, to) => inner.mergeLearner(from, to),
    deleteLearnerRuntime: (stage, owner) =>
      deleteRuntime({ stageId: stage, ownerId: owner }, (r) =>
        r.deleteLearnerRuntime(stage, owner),
      ),
    deleteStageRuntime: (stage) =>
      deleteRuntime({ stageId: stage }, (r) => r.deleteStageRuntime(stage)),
    deleteAllRuntime: () => deleteRuntime({}, (r) => r.deleteAllRuntime()),
  };
}
