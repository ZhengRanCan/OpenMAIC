import { createHash } from 'node:crypto';
import {
  RUNTIME_DSL_VERSION,
  validateRuntimeSession,
  validateRuntimeRecord,
  type RuntimeSession,
  type RuntimeRecord,
} from '@openmaic/dsl';
import {
  chatRuntimeIdentity,
  currentRestoreMarker,
  restoreMarkerPrefix,
  restoreMarkerTargets,
  deletionMarkerPrefix,
  deletionMarkerChatId,
  isMessagePayload,
  isStatePayload,
  MAX_MESSAGES_PER_SESSION,
  type ChatRuntimeView,
  type ChatMessagePayload,
  type ChatSessionStatePayload,
} from '@/lib/utils/chat-storage-core';
import { isChatSessionInitialContext } from '@/lib/chat/session-initial-context';
import type {
  DialogueSourceLocator,
  DialogueSourceReadResult,
  DialogueSourceWindow,
  RawDialogueSnapshot,
} from './trace-types';

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value))
    return (
      '{' +
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}

export function dialogueContentDigest(
  source: Pick<
    DialogueSourceWindow,
    'sourceVersion' | 'type' | 'initialContext' | 'messages' | 'window'
  >,
): string {
  const content = {
    sourceVersion: source.sourceVersion,
    type: source.type,
    initialContext: source.initialContext,
    window: source.window,
    messages: source.messages.map(({ message }) => ({
      id: message.id,
      role: message.role,
      parts: message.parts,
      author: {
        originalRole: message.metadata?.originalRole ?? null,
        senderName: message.metadata?.senderName ?? null,
        agentId: message.metadata?.agentId ?? null,
      },
      interrupted: message.metadata?.interrupted ?? null,
    })),
  };
  return createHash('sha256').update(canonical(content)).digest('hex');
}

class InvalidSource extends Error {
  constructor(
    readonly status: 'unreadable' | 'unsupported',
    message: string,
  ) {
    super(message);
  }
}
function fail(reason: string): never {
  throw new InvalidSource('unreadable', reason);
}
function requireCurrentSession(
  row: Record<string, unknown>,
  locator: DialogueSourceLocator,
): RuntimeSession {
  const data = row.data;
  if (!object(data)) fail('invalid_session_envelope');
  if (
    typeof data.runtimeDslVersion === 'string' &&
    data.runtimeDslVersion !== RUNTIME_DSL_VERSION
  ) {
    throw new InvalidSource('unsupported', 'runtime_version');
  }
  if (!validateRuntimeSession(data).valid) fail('invalid_session_envelope');
  for (const [column, key] of [
    ['id', 'id'],
    ['stage_id', 'stageId'],
    ['learner_key', 'learnerKey'],
    ['kind', 'kind'],
    ['status', 'status'],
    ['created_at', 'createdAt'],
    ['updated_at', 'updatedAt'],
  ]) {
    if (row[column] !== data[key]) fail('session_index_mismatch');
  }
  if (data.stageId !== locator.stageId || data.learnerKey !== locator.ownerId)
    fail('partition_mismatch');
  return data as unknown as RuntimeSession;
}
function requireRecords(
  rows: RawDialogueSnapshot['records'],
  session: RuntimeSession,
): RuntimeRecord[] {
  const result: RuntimeRecord[] = [];
  const seqs = new Set<number>(),
    ids = new Set<string>();
  for (const row of rows.filter((r) => r.session_id === session.id)) {
    const data = row.data;
    const seq = typeof row.seq === 'string' && /^\d+$/.test(row.seq) ? Number(row.seq) : row.seq;
    if (
      !object(data) ||
      !validateRuntimeRecord(data).valid ||
      !Number.isSafeInteger(seq) ||
      data.seq !== seq ||
      data.id !== row.id ||
      data.sessionId !== session.id ||
      data.createdAt !== row.created_at ||
      (data.sceneId ?? null) !== (row.scene_id ?? null)
    )
      fail('invalid_record_envelope');
    if (ids.has(data.id as string) || seqs.has(seq as number)) fail('duplicate_record');
    ids.add(data.id as string);
    seqs.add(seq as number);
    result.push(data as unknown as RuntimeRecord);
  }
  return result.sort((a, b) => a.seq - b.seq);
}
function markerView(
  row: Record<string, unknown>,
  raw: RawDialogueSnapshot,
  locator: DialogueSourceLocator,
): ChatRuntimeView {
  const runtimeSession = requireCurrentSession(row, locator);
  return {
    runtimeSession,
    records: requireRecords(raw.records, runtimeSession),
    folded: { messages: new Map() },
  };
}
function epoch(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 253_402_300_799_999;
}
function requireState(payload: unknown, locator: DialogueSourceLocator): ChatSessionStatePayload {
  if (
    !isStatePayload(payload) ||
    !object(payload.config) ||
    !Array.isArray(payload.config.agentIds) ||
    !payload.config.agentIds.every((x) => typeof x === 'string') ||
    !epoch(payload.createdAt) ||
    !epoch(payload.updatedAt) ||
    payload.updatedAt < payload.createdAt ||
    payload.chatSessionId !== locator.chatSessionId ||
    payload.messageIds.some((id) => !id) ||
    new Set(payload.messageIds).size !== payload.messageIds.length ||
    payload.messageIds.length > MAX_MESSAGES_PER_SESSION
  )
    fail('invalid_state_payload');
  if (
    payload.initialContext !== undefined &&
    (!isChatSessionInitialContext(payload.initialContext) ||
      payload.initialContext.stageId !== locator.stageId)
  )
    fail('invalid_initial_context');
  return payload;
}
function requireMessage(payload: unknown): ChatMessagePayload {
  if (!isMessagePayload(payload) || !payload.message.id || !epoch(payload.sessionUpdatedAt))
    fail('invalid_message_payload');
  const { message } = payload;
  if (
    !message.parts.every(
      (p) =>
        object(p) &&
        typeof p.type === 'string' &&
        p.type.length &&
        (p.type !== 'text' || typeof p.text === 'string'),
    )
  )
    fail('invalid_message_parts');
  const metadata = message.metadata;
  if (metadata !== undefined) {
    if (!object(metadata)) fail('invalid_message_metadata');
    for (const key of ['senderName', 'senderAvatar', 'agentId', 'agentColor'] as const) {
      if (metadata[key] !== undefined && typeof metadata[key] !== 'string')
        fail('invalid_message_metadata');
    }
    if (
      metadata.originalRole !== undefined &&
      (typeof metadata.originalRole !== 'string' ||
        !['teacher', 'agent', 'user'].includes(metadata.originalRole))
    )
      fail('invalid_message_metadata');
    if (
      metadata.createdAt !== undefined &&
      (typeof metadata.createdAt !== 'number' || !epoch(metadata.createdAt))
    )
      fail('invalid_message_metadata');
    if (metadata.interrupted !== undefined && typeof metadata.interrupted !== 'boolean')
      fail('invalid_message_metadata');
  }
  const text = message.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('');
  if (payload.role !== message.role || payload.content !== text) fail('message_content_mismatch');
  return payload;
}

/** Pure strict projection. The caller must already have checked stage ownership. */
export function projectDialogueSource(
  raw: RawDialogueSnapshot,
  locator: DialogueSourceLocator,
): DialogueSourceReadResult {
  try {
    const markerRows = raw.sessions.filter(
      (r) =>
        typeof r.id === 'string' &&
        (r.id.startsWith(restoreMarkerPrefix(locator.stageId)) ||
          r.id.startsWith(deletionMarkerPrefix(locator.stageId))),
    );
    const markers = markerRows.map((r) => markerView(r, raw, locator));
    for (const marker of markers) {
      if (marker.runtimeSession.id.startsWith(deletionMarkerPrefix(locator.stageId))) {
        const deletedId = deletionMarkerChatId(marker, locator.stageId);
        if (!deletedId || marker.records.length) fail('invalid_deletion_marker');
        if (deletedId === locator.chatSessionId) return { status: 'deleted' };
      } else if (marker.runtimeSession.kind !== 'chat') fail('invalid_restore_marker');
    }
    const restoreId = currentRestoreMarker(markers, locator.stageId);
    const restore = markers.find((m) => m.runtimeSession.id === restoreId);
    if (restore) {
      if (restore.records.length !== 1) fail('invalid_restore_marker');
      const p = restore.records[0].payload;
      if (
        !object(p) ||
        p.kind !== 'chat_restore_marker' ||
        p.role !== 'system' ||
        typeof p.content !== 'string' ||
        !Array.isArray(p.runtimeSessionIds) ||
        !p.runtimeSessionIds.every((id) => typeof id === 'string' && id.length)
      )
        fail('invalid_restore_marker');
    }
    const superseded = new Set(restoreMarkerTargets(restore));
    const candidates: {
      session: RuntimeSession;
      generation: number;
      state: ChatSessionStatePayload;
      stateSeq: number;
      records: RuntimeRecord[];
    }[] = [];
    for (const row of raw.sessions) {
      if (typeof row.id !== 'string' || superseded.has(row.id)) continue;
      const identity = chatRuntimeIdentity(row.id, locator.stageId, locator.chatSessionId);
      if (!identity) continue;
      const session = requireCurrentSession(row, locator);
      if (session.kind !== 'chat') fail('invalid_session_kind');
      const records = requireRecords(raw.records, session);
      const states: { state: ChatSessionStatePayload; seq: number }[] = [];
      for (const record of records) {
        const p = record.payload;
        if (!object(p)) fail('invalid_payload');
        if (p.payloadVersion !== 1) throw new InvalidSource('unsupported', 'payload_version');
        if (p.kind === 'chat_session_state')
          states.push({ state: requireState(p, locator), seq: record.seq });
        else if (p.kind === 'chat_message') requireMessage(p);
        else fail('invalid_payload_kind');
      }
      const last = states.sort((a, b) => b.state.updatedAt - a.state.updatedAt || b.seq - a.seq)[0];
      if (!last) fail('missing_state');
      candidates.push({
        session,
        generation: identity.generation,
        state: last.state,
        stateSeq: last.seq,
        records,
      });
    }
    candidates.sort(
      (a, b) =>
        b.state.updatedAt - a.state.updatedAt ||
        b.generation - a.generation ||
        b.session.id.localeCompare(a.session.id),
    );
    const selected = candidates[0];
    if (!selected) return { status: 'missing' };
    const { state, stateSeq, records, session, generation } = selected;
    if (state.type === 'lecture') return { status: 'unsupported', reason: 'session_type' };
    const tail = records.at(-1);
    if (tail && tail.seq > stateSeq && object(tail.payload) && tail.payload.kind === 'chat_message')
      fail('incomplete_save');
    const messages = new Map<string, { payload: ChatMessagePayload; seq: number }>();
    for (const record of records) {
      if (record.seq > stateSeq || !isMessagePayload(record.payload)) continue;
      const p = record.payload;
      if (p.sessionUpdatedAt > state.updatedAt) fail('inconsistent_message_clock');
      const previous = messages.get(p.message.id);
      if (
        !previous ||
        p.sessionUpdatedAt > previous.payload.sessionUpdatedAt ||
        (p.sessionUpdatedAt === previous.payload.sessionUpdatedAt && record.seq > previous.seq)
      )
        messages.set(p.message.id, { payload: p, seq: record.seq });
    }
    const windowMessages = state.messageIds.map((id) => {
      const item = messages.get(id);
      if (!item) fail('missing_message');
      const message = structuredClone(item.payload.message);
      return {
        message,
        text: message.parts
          .filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join(''),
      };
    });
    const source: DialogueSourceWindow = {
      sourceVersion: 'dialogue-source.v1',
      ownerId: locator.ownerId,
      stageId: locator.stageId,
      chatSessionId: locator.chatSessionId,
      runtimeSessionId: session.id,
      generation,
      type: state.type,
      title: state.title,
      status: state.status,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      initialContext: state.initialContext ? structuredClone(state.initialContext) : null,
      messages: windowMessages,
      window: { maxMessages: 200, historyCompleteness: 'window-only' },
      contentDigest: '',
    };
    source.contentDigest = dialogueContentDigest(source);
    return { status: 'available', source };
  } catch (error) {
    if (error instanceof InvalidSource) return { status: error.status, reason: error.message };
    return { status: 'unreadable', reason: 'invalid_source' };
  }
}
