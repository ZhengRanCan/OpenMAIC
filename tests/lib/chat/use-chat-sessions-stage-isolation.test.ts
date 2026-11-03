// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  capabilities: vi.fn().mockResolvedValue({}),
  runLoop: vi.fn().mockResolvedValue({ reason: 'cue_user' }),
  save: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/model-settings/capabilities', () => ({
  loadModelCapabilities: mocks.capabilities,
  classroomChatUsable: () => true,
}));
vi.mock('@/lib/chat/agent-loop', () => ({ runAgentLoop: mocks.runLoop }));
vi.mock('@/lib/config/feature-flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config/feature-flags')>()),
  isPiChatEnabled: () => false,
}));
vi.mock('@/lib/hooks/use-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/utils/stage-storage', () => ({
  saveStageData: mocks.save,
  saveStageDataIncremental: mocks.save,
}));
vi.mock('@/lib/chat/quiz-results-for-store-state', () => ({
  buildQuizResultsForStoreState: vi.fn().mockResolvedValue(undefined),
  didActiveSceneRemainUnchanged: () => true,
}));

import { useChatSessions } from '@/components/chat/use-chat-sessions';
import { useStageStore } from '@/lib/store/stage';
import { isChatSessionScopeCurrent } from '@/lib/chat/session-scope';
import type { Stage, Scene } from '@/lib/types/stage';
import type { ChatSession } from '@/lib/types/chat';

const stage = (id: string): Stage => ({ id, name: `Class ${id}`, createdAt: 1, updatedAt: 1 });
const scene = (id: string, stageId: string): Scene => ({
  id,
  stageId,
  title: `Scene ${id}`,
  order: 0,
  type: 'quiz',
  content: { type: 'quiz', questions: [] },
});
const chat = (id: string): ChatSession => ({
  id,
  type: 'qa',
  title: id,
  status: 'completed',
  messages: [],
  config: { agentIds: ['default-1'] },
  toolCalls: [],
  pendingToolCalls: [],
  createdAt: 1,
  updatedAt: 1,
});
function switchStage(id: string, chats: ChatSession[] = []) {
  useStageStore.setState({
    stage: stage(id),
    scenes: [scene(`${id}-scene`, id)],
    currentSceneId: `${id}-scene`,
    chats,
  });
}

describe('actual chat hook stage isolation and initial context', () => {
  let root: Root;
  let host: HTMLDivElement;
  let api: ReturnType<typeof useChatSessions>;
  let setChats: ReturnType<typeof vi.spyOn>;
  let bootStage: string | undefined;
  function Harness() {
    const current = useChatSessions();
    useLayoutEffect(() => {
      api = current;
    }, [current]);
    useLayoutEffect(() => {
      if (bootStage) switchStage(bootStage);
    }, []);
    return null;
  }
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.capabilities.mockReset().mockResolvedValue({});
    mocks.runLoop.mockClear();
    bootStage = undefined;
    useStageStore.getState().clearStore();
    switchStage('a');
    setChats = vi.spyOn(useStageStore.getState(), 'setChats');
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(Harness)));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    setChats.mockRestore();
    useStageStore.getState().clearStore();
    vi.unstubAllGlobals();
  });

  it('captures QA and Discussion on their actual entry points and keeps the original context on follow-up', async () => {
    act(() =>
      useStageStore.setState({
        outlineProducer: 'server-job',
        outlineProducerRef: 'run-0123456789abcdef',
      }),
    );
    await act(async () => api.sendMessage('first question'));
    const first = api.sessions[0];
    expect(first.learningRunId).toBe('run-0123456789abcdef');
    expect(first.initialContext).toEqual({
      stageId: 'a',
      stageTitle: 'Class a',
      sceneId: 'a-scene',
      sceneTitle: 'Scene a-scene',
    });
    act(() =>
      useStageStore.setState({
        stage: { ...stage('a'), name: 'renamed' },
        scenes: [scene('new', 'a')],
        currentSceneId: 'new',
      }),
    );
    await act(async () => api.sendMessage('follow up'));
    expect(api.sessions[0].initialContext).toEqual(first.initialContext);
    expect(new Set(api.sessions[0].messages.map((m) => m.id)).size).toBe(2);
    await act(async () =>
      api.startDiscussion({ topic: 'Discuss', prompt: 'Why?', agentId: 'default-1' }),
    );
    expect(api.sessions.at(-1)?.initialContext).toEqual({
      stageId: 'a',
      stageTitle: 'renamed',
      sceneId: 'new',
      sceneTitle: 'Scene new',
    });
    expect(api.sessions.at(-1)?.learningRunId).toBe('run-0123456789abcdef');
    await act(async () => api.endSession(api.sessions.at(-1)!.id, { source: 'scene_switch' }));
    expect(api.sessions.at(-1)?.learningClosure?.source).toBe('scene_switch');
  });

  it('accepts the first classroom loaded before passive subscription effects mount', async () => {
    act(() => root.unmount());
    useStageStore.setState({ stage: null, chats: [], scenes: [], currentSceneId: null });
    bootStage = 'loaded';
    root = createRoot(host);
    await act(async () => root.render(createElement(Harness)));
    await act(async () => api.sendMessage('cold-load question'));
    expect(api.sessions).toHaveLength(1);
    expect(api.sessions[0].initialContext?.stageId).toBe('loaded');
    expect(mocks.runLoop).toHaveBeenCalledOnce();
  });

  it('never saves A sessions into B while the restore effect is pending', async () => {
    await act(async () => api.createSession('qa', 'A question'));
    const old = api.sessions[0].id;
    setChats.mockClear();
    await act(async () => switchStage('b', [chat('b-only')]));
    expect(api.sessions.map((s) => s.id)).toEqual(['b-only']);
    expect(
      setChats.mock.calls.some((call: unknown[]) =>
        (call[0] as ChatSession[]).some((s) => s.id === old),
      ),
    ).toBe(false);
    expect(useStageStore.getState().chats.map((s) => s.id)).toEqual(['b-only']);
  });

  it('marks the partially presented agent message interrupted when a new user turn takes over', async () => {
    mocks.runLoop.mockImplementationOnce(async (_options, consumer, signal: AbortSignal) => {
      consumer.onEvent({
        type: 'agent_start',
        data: { messageId: 'partial-agent', agentId: 'default-1', agentName: 'Synthetic teacher' },
      });
      consumer.onEvent({
        type: 'text_delta',
        data: { messageId: 'partial-agent', content: 'A long synthetic reply '.repeat(30) },
      });
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      return { reason: 'aborted' };
    });
    let pending!: Promise<void>;
    await act(async () => {
      pending = api.sendMessage('first');
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    expect(api.sessions[0].messages.some((m) => m.id === 'partial-agent')).toBe(true);
    await act(async () => {
      await api.sendMessage('interrupt with another question');
      await pending;
    });
    expect(
      api.sessions[0].messages.find((m) => m.id === 'partial-agent')?.metadata?.interrupted,
    ).toBe(true);
    expect(api.sessions[0].messages.filter((m) => m.role === 'user')).toHaveLength(2);
  });

  it('uses the same initial context capture in the missing-selected-session fallback', async () => {
    act(() =>
      useStageStore.setState({
        outlineProducer: 'server-job',
        outlineProducerRef: 'run-0123456789abcdef',
      }),
    );
    await act(async () => api.createSession('qa', 'selected session'));
    // Simulate a selected ID whose session disappeared before the next send.
    api.sessions.splice(0);
    await act(async () => api.sendMessage('fallback question'));
    expect(api.sessions).toHaveLength(1);
    expect(api.sessions[0]).toMatchObject({
      initialContext: { stageId: 'a', sceneId: 'a-scene' },
      learningRunId: 'run-0123456789abcdef',
      messages: [{ parts: [{ type: 'text', text: 'fallback question' }] }],
    });
  });

  it('captures the actual Scene after an await without invalidating a same-classroom operation', async () => {
    let release!: (value: object) => void;
    mocks.capabilities.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = api.sendMessage('new scene');
    });
    act(() => useStageStore.setState({ scenes: [scene('later', 'a')], currentSceneId: 'later' }));
    await act(async () => {
      release({});
      await pending;
    });
    expect(api.sessions[0].initialContext?.sceneId).toBe('later');
  });

  it.each(['qa', 'discussion'] as const)(
    'drops a pending %s when changing classroom',
    async (kind) => {
      let release!: (value: object) => void;
      mocks.capabilities.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      let pending!: Promise<void>;
      await act(async () => {
        pending =
          kind === 'qa'
            ? api.sendMessage('old A question')
            : api.startDiscussion({ topic: 'old A', prompt: 'old', agentId: 'default-1' });
      });
      await act(async () => switchStage('b'));
      await act(async () => {
        release({});
        await pending;
      });
      expect(api.sessions).toEqual([]);
      expect(mocks.runLoop).not.toHaveBeenCalled();
    },
  );

  it('invalidates a pending operation even for A to B to A within one render batch', async () => {
    let release!: (value: object) => void;
    mocks.capabilities.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = api.sendMessage('old');
    });
    act(() => {
      switchStage('b');
      switchStage('a');
    });
    await act(async () => {
      release({});
      await pending;
    });
    expect(mocks.runLoop).not.toHaveBeenCalled();
    expect(api.sessions).toEqual([]);
    expect(
      isChatSessionScopeCurrent({ stageId: 'a', epoch: 1 }, { stageId: 'a', epoch: 3 }, 'a'),
    ).toBe(false);
  });

  it('restores the final loaded A window and never writes the prior A window during a batched A to B to A switch', async () => {
    await act(async () => api.createSession('qa', 'Old A selection'));
    const oldId = api.sessions[0].id;
    setChats.mockClear();
    await act(async () => {
      switchStage('b', [chat('b-only')]);
      switchStage('a', [chat('a-reloaded')]);
    });
    expect(api.sessions.map((s) => s.id)).toEqual(['a-reloaded']);
    expect(api.activeSessionId).toBeNull();
    expect(useStageStore.getState().chats.map((s) => s.id)).toEqual(['a-reloaded']);
    expect(
      setChats.mock.calls.some((call: unknown[]) =>
        (call[0] as ChatSession[]).some((s) => s.id === oldId),
      ),
    ).toBe(false);
    await act(async () => api.sendMessage('A new question after reloading A'));
    expect(api.sessions.some((s) => s.id === 'a-reloaded')).toBe(true);
    expect(api.sessions.some((s) => s.id === oldId)).toBe(false);
    expect(api.sessions.at(-1)?.initialContext?.stageId).toBe('a');
  });

  it('restores stored context without recapturing renamed titles, and leaves legacy absence empty', async () => {
    const initialContext = {
      stageId: 'b',
      stageTitle: 'old b',
      sceneId: 'old',
      sceneTitle: 'old scene',
    };
    await act(async () => switchStage('b', [{ ...chat('old'), initialContext }, chat('legacy')]));
    expect(api.sessions[0].initialContext).toEqual(initialContext);
    expect(api.sessions[1].initialContext).toBeUndefined();
  });
});
