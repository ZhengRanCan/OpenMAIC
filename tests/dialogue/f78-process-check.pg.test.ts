import { createOpenAI } from '@ai-sdk/openai';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import type { ActionEngine } from '@/lib/action/engine';
import { runPiDirectorLoop } from '@/lib/chat/pi/director-loop';
import { DIALOGUE_PROMPT_VERSION } from '@/lib/dialogue/evidence-contracts';
import { readDialogueEvidenceRun } from '@/lib/persistence/dialogue-evidence-read';
import { readDialogueSource } from '@/lib/persistence/dialogue-trace-read';
import { getBuiltInAgent } from '@/lib/orchestration/registry/built-in';
import { PlaybackEngine } from '@/lib/playback/engine';
import { extractDialogueEvidence } from '@/lib/server/dialogue-evidence';
import type { ChatSession, StatelessEvent } from '@/lib/types/chat';
import type { Scene } from '@/lib/types/stage';
import type { AudioPlayer } from '@/lib/utils/audio-player';
import { saveChatSessions } from '@/lib/utils/chat-storage';
import { dialogueEvidenceFixture, model } from '../persistence/dialogue-evidence-fixture';

const mode = process.env.F78_CHECK_MODE;
const live = mode === 'live-004' || mode === 'live-005';
const modelId = 'deepseek-v4-flash';
const endpoint = 'https://api.deepseek.com/v1/chat/completions';

function guardedTransport(save: (name: string, data: unknown) => Promise<void>) {
  let calls = 0;
  const phaseCalls = { opening: 0, evidence: 0 };
  const openingLimit = mode === 'live-005' ? 5 : 3;
  let stopped = false;
  const requestFor =
    (phase: 'opening' | 'evidence'): typeof fetch =>
    async (input, init) => {
      const request = new Request(input, init);
      const body = await request.json();
      if (
        stopped ||
        request.url !== endpoint ||
        request.method !== 'POST' ||
        body.model !== modelId ||
        phaseCalls[phase] >= (phase === 'opening' ? openingLimit : 1)
      ) {
        stopped = true;
        throw new Error('F78 endpoint or call limit rejected');
      }
      body.thinking = { type: 'disabled' };
      body.max_tokens = 2048;
      if (body.stream) body.stream_options = { include_usage: true };
      const serialized = JSON.stringify(body);
      expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(65536);
      const name = String(++calls).padStart(2, '0') + '-' + phase;
      phaseCalls[phase]++;
      try {
        await save(name + '.request', body);
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: request.headers,
          body: serialized,
          redirect: 'error',
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(120000)]),
        });
        if (!response.ok) {
          await save(name + '.error', { status: response.status });
          throw new Error('DeepSeek HTTP ' + response.status);
        }
        const raw = await response.clone().text();
        const records = body.stream
          ? raw
              .split('\n')
              .filter((line) => line.startsWith('data: {'))
              .map((line) => JSON.parse(line.slice(6)))
          : [JSON.parse(raw)];
        const usage = records.findLast((record) => record.usage)?.usage;
        await save(name + '.response', { usage, records });
        expect(Number.isFinite(usage?.total_tokens)).toBe(true);
        return response;
      } catch (error) {
        stopped = true;
        throw error;
      }
    };
  return { requestFor, calls: () => calls };
}

it.skipIf(mode !== 'control' && !live)(
  'joins the generated Discussion action and round-trips process evidence',
  async () => {
    const url = process.env.PG_CONTRACT_URL;
    const database = new URL(url ?? 'postgresql://invalid');
    expect([database.hostname, database.port, database.pathname]).toEqual([
      '127.0.0.1',
      '55478',
      '/f78_app',
    ]);
    const dir = path.resolve('../docs/harness/features/F78-native-discussion-process-check');
    const scene: Scene = JSON.parse(
      await readFile(
        path.join(
          dir,
          live ? 'live-003/process-check.scene.json' : 'live-002/process-check.scene.json',
        ),
        'utf8',
      ),
    );
    const discussion = scene.actions?.at(-1);
    if (discussion?.type !== 'discussion') throw Error('Missing generated Discussion');

    const join = vi.fn();
    const audio = {
      play: vi.fn(async () => false),
      onEnded: vi.fn(),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      isPlaying: vi.fn(() => false),
      hasActiveAudio: vi.fn(() => false),
    } as unknown as AudioPlayer;
    const actions = {
      execute: vi.fn(async () => {}),
      clearEffects: vi.fn(),
      resetPlaybackVisualState: vi.fn(),
    } as unknown as ActionEngine;
    vi.useFakeTimers();
    try {
      // Exercise the generated invitation in isolation. This batch's speech
      // disclosed a worked step and is excluded from the synthetic control.
      const playbackScene = { ...scene, actions: [discussion] };
      const callbacks = { onDiscussionConfirmed: join };
      const skipped = new PlaybackEngine([playbackScene], actions, audio, callbacks);
      skipped.start();
      await vi.advanceTimersByTimeAsync(4000);
      skipped.skipDiscussion();
      expect(join).not.toHaveBeenCalled();
      const accepted = new PlaybackEngine([playbackScene], actions, audio, callbacks);
      accepted.start();
      await vi.advanceTimersByTimeAsync(4000);
      accepted.confirmDiscussion();
      expect(join).toHaveBeenCalledExactlyOnceWith(
        discussion.topic,
        discussion.prompt,
        discussion.agentId,
      );
    } finally {
      vi.useRealTimers();
    }

    const output = path.join(dir, live ? mode : 'pg-control-002');
    const exportArtifacts = live || process.env.F78_EXPORT === '1';
    if (exportArtifacts) await mkdir(output, { recursive: !live });
    const save = async (name: string, data: unknown) => {
      if (exportArtifacts) {
        await writeFile(path.join(output, name + '.json'), JSON.stringify(data, null, 2) + '\n', {
          flag: 'wx',
        });
      }
    };
    const transport = guardedTransport(save);
    const fixture = await dialogueEvidenceFixture(url!);
    vi.stubGlobal('navigator', {
      locks: {
        request: async (
          _name: string,
          optionsOrWork: LockOptions | (() => Promise<unknown>),
          maybeWork?: () => Promise<unknown>,
        ) => (typeof optionsOrWork === 'function' ? optionsOrWork : maybeWork!)(),
      },
    });
    try {
      const message = (id: string, role: 'user' | 'assistant', text: string) => ({
        id,
        role,
        parts: [{ type: 'text' as const, text }],
      });
      let opening = '质量 1.2 kg、体积 400 cm³。请独立求密度，写出换算、列式、结果和单位。';
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (live) {
        if (!apiKey) throw new Error('Missing DeepSeek credential');
        const agent = getBuiltInAgent(discussion.agentId ?? 'default-1');
        if (!agent) throw new Error('Missing built-in Discussion agent');
        const events: StatelessEvent[] = [];
        const signal = AbortSignal.timeout(120000);
        await runPiDirectorLoop({
          body: {
            messages: [],
            apiKey: '',
            storeState: {
              stage: {
                id: scene.stageId,
                name: '密度课',
                createdAt: 1,
                updatedAt: 2,
                languageDirective: '使用简明中文。',
              },
              scenes: [scene],
              currentSceneId: scene.id,
              mode: 'autonomous',
              whiteboardOpen: false,
            },
            config: {
              agentIds: [agent.id],
              sessionType: 'discussion',
              discussionTopic: discussion.topic,
              discussionPrompt: discussion.prompt,
              triggerAgentId: agent.id,
            },
          },
          agentConfigs: [agent],
          send: async (event) => {
            events.push(event);
          },
          languageModel: createOpenAI({
            apiKey,
            baseURL: 'https://api.deepseek.com/v1',
            fetch: transport.requestFor('opening'),
          }).chat(modelId),
          thinkingConfig: { mode: 'disabled', enabled: false },
          maxOutputTokens: 2048,
          abortSignal: signal,
          signal,
          maxAgentTurns: 1,
          maxActionsPerAgent: 4,
          enableWhiteboardTools: false,
        });
        opening = events
          .filter((event) => event.type === 'text_delta')
          .map((event) => event.data.content)
          .join('');
        const cue = events.some((event) => event.type === 'cue_user');
        await save('opening', { opening, cue, events });
        expect(events.some((event) => event.type === 'error')).toBe(false);
        expect(opening.trim()).not.toBe('');
        expect(cue).toBe(true);
      }
      const answer = '1.2 kg = 1200 g。ρ = m/V = 1200 g ÷ 400 cm³ = 3 g/cm³。';
      const hint = '本题质量 1.2 kg 等于 1200 g，请你完成列式和计算。';
      const sessions = [fixture.chat];
      const variants = live
        ? (['live-submission'] as const)
        : (['independent', 'assisted', 'unanswered'] as const);
      for (const variant of variants) {
        const chat: ChatSession = {
          ...fixture.chat,
          id: 'f78-' + variant,
          type: 'discussion',
          title: discussion.topic,
          initialContext: {
            stageId: 'stage',
            stageTitle: '密度课',
            sceneId: 'scene',
            sceneTitle: scene.title,
          },
          messages: [message('opening', 'assistant', opening)],
        };
        if (variant === 'assisted') {
          chat.messages.push(
            message('request-help', 'user', '我不确定怎么把质量换成克，可以提示一下吗？'),
          );
          chat.messages.push(message('hint', 'assistant', hint));
        }
        if (variant !== 'unanswered') chat.messages.push(message('submission', 'user', answer));
        sessions.push(chat);
        await saveChatSessions('stage', sessions, { store: fixture.runtime, learnerKey: 'owner' });
        const ref = { stageId: 'stage', chatSessionId: chat.id };
        const source = await readDialogueSource(fixture.provider, 'owner', ref);
        if (source.status !== 'available') throw Error('Missing source: ' + source.status);
        expect(source.source.type).toBe('discussion');
        expect(source.source.messages.map((entry) => entry.message)).toEqual(chat.messages);
        await save(variant + '.source', source);
        if (variant === 'unanswered') {
          expect(source.source.messages.some((entry) => entry.message.role === 'user')).toBe(false);
          continue;
        }
        fixture.settings.bindings.push({
          ...fixture.settings.bindings[0],
          ...ref,
          sourceDigest: source.source.contentDigest,
          conditions: live
            ? [
                'F78 synthetic learner answer after the generated live-003 slide; its speech noted the units differ',
              ]
            : ['F78 authored process-control answers and opening'],
        });
        const identity = {
          ...model,
          promptVersion: DIALOGUE_PROMPT_VERSION,
          provider: live ? 'deepseek' : model.provider,
          model: live ? modelId : 'f78-control',
        };
        const run = await fixture.store.prepare(
          'owner',
          { ...ref, operationId: chat.id },
          fixture.settings,
          identity,
        );
        expect(run.state).toBe('prepared');
        const read = () => readDialogueEvidenceRun(fixture.provider, 'owner', run.id);
        const refs =
          variant === 'assisted' ? ['opening', 'hint', 'submission'] : ['opening', 'submission'];
        const evidence =
          variant === 'assisted'
            ? '教师给出 1200 g 后，学生列式并计算得 3 g/cm³。'
            : '学生写出换算和列式，求得 3 g/cm³。';
        const completed = await extractDialogueEvidence(
          'owner',
          run.id,
          identity,
          fixture.store,
          read,
          async (current) => {
            if (live) {
              const started = Date.now();
              const response = await transport.requestFor('evidence')(endpoint, {
                method: 'POST',
                headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
                body: JSON.stringify({
                  model: modelId,
                  temperature: 0,
                  response_format: { type: 'json_object' },
                  messages: [
                    { role: 'system', content: current.system },
                    { role: 'user', content: current.context!.text },
                  ],
                }),
              });
              const reply = await response.json();
              return {
                text: reply.choices[0].message.content,
                usage: reply.usage,
                finishReason: reply.choices[0].finish_reason,
                actualModel: reply.model,
                receivedAt: new Date().toISOString(),
                durationMs: Date.now() - started,
              };
            }
            return {
              text: JSON.stringify({ facts: [{ type: 'learning_performance', evidence, refs }] }),
              usage: null,
              finishReason: 'stop',
              actualModel: 'fixture',
              receivedAt: new Date().toISOString(),
              durationMs: 0,
            };
          },
          async () => fixture.settings,
        );
        await save(variant + '.evidence', completed);
        expect(completed.state).toBe('completed');
        if (live) {
          expect(
            completed.facts.some(
              (fact) => fact.type === 'learning_performance' && fact.refs.includes('submission'),
            ),
          ).toBe(true);
        } else {
          expect(completed.facts[0]).toMatchObject({
            type: 'learning_performance',
            evidence,
            refs,
          });
        }
        expect(completed.snapshot?.contentDigest).toBe(source.source.contentDigest);
      }
      await save('summary', { calls: transport.calls(), joined: true, skipped: true, variants });
    } finally {
      vi.unstubAllGlobals();
      await fixture.close();
    }
  },
  live ? 240000 : 30000,
);
