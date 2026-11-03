import type { UIMessage } from 'ai';
import type { ChatMessageMetadata, ChatSession, ChatSessionInitialContext } from '@/lib/types/chat';

export interface DialogueSourceMessage {
  /** Exact saved message, including non-text parts and missing metadata. */
  message: UIMessage<ChatMessageMetadata>;
  text: string;
}

export interface DialogueSourceWindow {
  sourceVersion: 'dialogue-source.v1';
  ownerId: string;
  stageId: string;
  chatSessionId: string;
  runtimeSessionId: string;
  generation: number;
  type: 'qa' | 'discussion';
  title: string;
  status: ChatSession['status'];
  createdAt: number;
  updatedAt: number;
  initialContext: ChatSessionInitialContext | null;
  messages: DialogueSourceMessage[];
  window: { maxMessages: 200; historyCompleteness: 'window-only' };
  contentDigest: string;
}

export type DialogueSourceReadResult =
  | { status: 'available'; source: DialogueSourceWindow }
  | { status: 'missing' }
  | { status: 'deleted' }
  | { status: 'unreadable'; reason: string }
  | { status: 'unsupported'; reason: string };

export interface RawDialogueSnapshot {
  sessions: readonly Record<string, unknown>[];
  records: readonly Record<string, unknown>[];
}

export interface DialogueSourceLocator {
  ownerId: string;
  stageId: string;
  chatSessionId: string;
}

export class DialogueTraceReadError extends Error {
  readonly code = 'READ_FAILED';
  constructor(cause: unknown) {
    super('Dialogue source read failed', { cause });
    this.name = 'DialogueTraceReadError';
  }
}
