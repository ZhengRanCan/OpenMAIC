import { describe, expect, it } from 'vitest';
import { projectDialogueSource } from '@/lib/dialogue/trace-projection';
import type { RawDialogueSnapshot } from '@/lib/dialogue/trace-types';
import {
  runtimeSessionId,
  generationRuntimeSessionId,
  deletionMarkerId,
  restoreMarkerPrefix,
  statePayload,
} from '@/lib/utils/chat-storage-core';
import type { ChatSession } from '@/lib/types/chat';

const locator = { stageId: 'stage', ownerId: 'owner', chatSessionId: 'chat' };
const time = '2026-11-02T00:00:00.000Z';
function fixture(
  options: {
    generation?: number;
    type?: ChatSession['type'];
    count?: number;
    context?: boolean;
  } = {},
): RawDialogueSnapshot {
  const base = runtimeSessionId('stage', 'old-owner-before-merge', 'chat');
  const id = options.generation ? generationRuntimeSessionId(base, options.generation) : base;
  const chat: ChatSession = {
    id: 'chat',
    type: options.type ?? 'qa',
    title: 'Q&A',
    status: 'active',
    config: { agentIds: ['tutor'] },
    toolCalls: [],
    pendingToolCalls: [],
    createdAt: 1,
    updatedAt: 2,
    ...(options.context
      ? {
          initialContext: {
            stageId: 'stage',
            stageTitle: 'original',
            sceneId: 'scene',
            sceneTitle: 'original scene',
          },
        }
      : {}),
    messages: Array.from({ length: options.count ?? 1 }, (_, i) => ({
      id: 'm' + i,
      role: 'user',
      parts: [
        { type: 'text', text: ' 先问\n' },
        { type: 'text', text: '再答 ' },
      ],
      metadata: { createdAt: 1, originalRole: 'user' },
    })),
  };
  const session = {
    id,
    stageId: 'stage',
    learnerKey: 'owner',
    kind: 'chat',
    status: 'active',
    createdAt: time,
    updatedAt: time,
    runtimeDslVersion: '0.1.0',
  };
  const payloads = [
    ...chat.messages.map((message) => ({
      kind: 'chat_message',
      payloadVersion: 1,
      role: message.role,
      content: ' 先问\n再答 ',
      message,
      sessionUpdatedAt: 2,
    })),
    statePayload(chat),
  ];
  return {
    sessions: [
      {
        id,
        stage_id: 'stage',
        learner_key: 'owner',
        kind: 'chat',
        status: 'active',
        created_at: time,
        updated_at: time,
        data: session,
      },
    ],
    records: payloads.map((payload, seq) => ({
      id: 'r' + seq,
      session_id: id,
      seq: String(seq),
      scene_id: null,
      created_at: time,
      data: { id: 'r' + seq, sessionId: id, seq, createdAt: time, payload },
    })),
  };
}
function rawData(row: Record<string, unknown>): Record<string, unknown> {
  return row.data as Record<string, unknown>;
}
function payload(row: Record<string, unknown>): Record<string, unknown> {
  return rawData(row).payload as Record<string, unknown>;
}

describe('strict dialogue source projection', () => {
  it.each(['qa', 'discussion'] as const)(
    'reads exact %s text, raw metadata and optional original background',
    (type) => {
      const result = projectDialogueSource(fixture({ type, context: true }), locator);
      expect(result).toMatchObject({
        status: 'available',
        source: {
          type,
          status: 'active',
          initialContext: { stageTitle: 'original' },
          messages: [{ text: ' 先问\n再答 ' }],
          window: { maxMessages: 200, historyCompleteness: 'window-only' },
        },
      });
      expect(projectDialogueSource(fixture(), locator)).toMatchObject({
        status: 'available',
        source: { initialContext: null },
      });
    },
  );
  it('distinguishes a complete empty source, a missing source and unsupported lecture', () => {
    expect(projectDialogueSource(fixture({ count: 0 }), locator)).toMatchObject({
      status: 'available',
      source: { messages: [] },
    });
    expect(projectDialogueSource({ sessions: [], records: [] }, locator)).toEqual({
      status: 'missing',
    });
    expect(projectDialogueSource(fixture({ type: 'lecture' }), locator)).toEqual({
      status: 'unsupported',
      reason: 'session_type',
    });
  });
  it('keeps 200 effective messages, rejecting an oversized or incomplete state', () => {
    expect(projectDialogueSource(fixture({ count: 200 }), locator)).toMatchObject({
      status: 'available',
      source: {
        messages: expect.arrayContaining([
          expect.objectContaining({ message: expect.objectContaining({ id: 'm199' }) }),
        ]),
      },
    });
    expect(projectDialogueSource(fixture({ count: 201 }), locator)).toMatchObject({
      status: 'unreadable',
    });
    const missing = fixture();
    expect(
      projectDialogueSource({ ...missing, records: missing.records.slice(1) }, locator),
    ).toEqual({ status: 'unreadable', reason: 'missing_message' });
  });
  it('does not mix a state with a later uncommitted message revision', () => {
    const input = fixture();
    const tail = structuredClone(input.records[0]);
    tail.id = 'tail';
    tail.seq = '2';
    Object.assign(rawData(tail), { id: 'tail', seq: 2 });
    payload(tail).sessionUpdatedAt = 3;
    input.records = [...input.records, tail];
    expect(projectDialogueSource(input, locator)).toEqual({
      status: 'unreadable',
      reason: 'incomplete_save',
    });
  });
  it('selects the highest generation at equal clocks and has a stable content digest', () => {
    const a = fixture({ context: true }),
      b = fixture({ generation: 2, context: true });
    const first = projectDialogueSource(a, locator);
    const rolled = projectDialogueSource(
      { sessions: [...a.sessions, ...b.sessions], records: [...a.records, ...b.records] },
      locator,
    );
    expect(rolled).toMatchObject({ status: 'available', source: { generation: 2 } });
    if (first.status !== 'available' || rolled.status !== 'available')
      throw Error('expected source');
    expect(rolled.source.contentDigest).toBe(first.source.contentDigest);
    const renamed = structuredClone(b);
    (payload(renamed.records.at(-1)!).initialContext as Record<string, unknown>).stageTitle =
      'new title';
    const changed = projectDialogueSource(renamed, locator);
    expect(changed).toMatchObject({ status: 'available' });
    if (changed.status === 'available')
      expect(changed.source.contentDigest).not.toBe(first.source.contentDigest);
  });
  it.each(['senderName', 'agentId', 'interrupted'] as const)(
    'includes changed author or interruption %s in digest',
    (key) => {
      const before = projectDialogueSource(fixture(), locator);
      const input = fixture();
      const message = payload(input.records[0]).message as { metadata: Record<string, unknown> };
      message.metadata[key] = key === 'interrupted' ? true : 'changed';
      const after = projectDialogueSource(input, locator);
      if (before.status !== 'available' || after.status !== 'available')
        throw Error('expected source');
      expect(before.source.contentDigest).not.toBe(after.source.contentDigest);
    },
  );
  it('rejects a corrupted newer generation rather than falling back to an older source', () => {
    const a = fixture(),
      b = fixture({ generation: 2 });
    payload(b.records.at(-1)!).messageIds = ['missing'];
    expect(
      projectDialogueSource(
        { sessions: [...a.sessions, ...b.sessions], records: [...a.records, ...b.records] },
        locator,
      ),
    ).toMatchObject({ status: 'unreadable' });
  });
  it('respects committed deletion and restore markers, including immutable IDs from a merged owner', () => {
    for (const kind of ['delete', 'restore'] as const) {
      const input = fixture();
      const id =
        kind === 'delete'
          ? deletionMarkerId('stage', 'old-owner', 'chat')
          : restoreMarkerPrefix('stage') + 'old-owner:op';
      const row = structuredClone(input.sessions[0]);
      Object.assign(row, {
        id,
        kind: kind === 'delete' ? 'chat-deletion' : 'chat',
        status: 'completed',
      });
      Object.assign(rawData(row), { id, kind: row.kind, status: 'completed' });
      input.sessions = [...input.sessions, row];
      if (kind === 'restore')
        input.records = [
          ...input.records,
          {
            id: 'marker',
            session_id: id,
            seq: '0',
            scene_id: null,
            created_at: time,
            data: {
              id: 'marker',
              sessionId: id,
              seq: 0,
              createdAt: time,
              payload: {
                kind: 'chat_restore_marker',
                role: 'system',
                content: '',
                runtimeSessionIds: [input.sessions[0].id],
              },
            },
          },
        ];
      expect(projectDialogueSource(input, locator)).toEqual({
        status: kind === 'delete' ? 'deleted' : 'missing',
      });
    }
  });
  it.each(['index', 'version', 'duplicate', 'metadata', 'context', 'restore'] as const)(
    'reports %s damage explicitly',
    (kind) => {
      const input = fixture();
      if (kind === 'index') input.sessions[0].learner_key = 'other';
      if (kind === 'version') rawData(input.sessions[0]).runtimeDslVersion = '9.0.0';
      if (kind === 'duplicate') payload(input.records.at(-1)!).messageIds = ['m0', 'm0'];
      if (kind === 'metadata')
        (payload(input.records[0]).message as { metadata: unknown }).metadata = {
          interrupted: 'yes',
        };
      if (kind === 'context')
        payload(input.records.at(-1)!).initialContext = { stageId: 'other', stageTitle: 'X' };
      if (kind === 'restore') {
        input.sessions[0].id = restoreMarkerPrefix('stage') + 'bad';
        rawData(input.sessions[0]).id = input.sessions[0].id;
        rawData(input.sessions[0]).status = 'completed';
        input.sessions[0].status = 'completed';
        input.records = [];
      }
      expect(projectDialogueSource(input, locator).status).toBe(
        kind === 'version' ? 'unsupported' : 'unreadable',
      );
    },
  );
});
