import { createOpenAI } from '@ai-sdk/openai';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { Pool } from 'pg';
import { expect, it, vi } from 'vitest';
import { simulatedScope, simulatedSeed } from '@/lib/learner-memory/simulated-seeds';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import * as context from '@/lib/server/dialogue-learner-context';
import { readPlannerMastery } from '@/lib/server/learner-mastery';
import * as resolver from '@/lib/server/resolve-model';
import { readSimulatedLearnerMemory } from '@/lib/server/simulated-learner-memory';
import * as webSearch from '@/lib/server/web-search-config';
import type { StatelessChatRequest, StatelessEvent } from '@/lib/types/chat';

const endpoint = 'https://api.deepseek.com/v1/chat/completions';
const modelId = 'deepseek-v4-flash';
const identity = '67eb7df2-33a8-4fbd-acab-cda635b8ae83';
const owner = `anon:${identity}`;
const student = 'B';
const topic = '质量 0.54 kg，体积 90 cm³，求密度。独立提交换算、列式、结果与单位。';
const instruction = `${topic} 开场只读题并等待学生作答。学生求助前不要给方法、公式、换算值或答案。`;
const question =
  '我这次已经独立算出 6 g/cm³，并写了 6000 kg/m³。请确认这两个结果是不是等价，再给我一个只检查单位的短问题，先别给答案。';

const arms = [
  ['qa', false],
  ['qa', true],
  ['discussion', false],
  ['discussion', true],
] as const;
type ModelInput = { arm: string; phase: string; attached: boolean };
type Selection = { arm: string; status: string; ms: number; text?: string };
type Comparison = {
  firstSpeechMs?: number;
  speech: string;
  events: StatelessEvent[];
  selection?: Selection;
  modelInputs: ModelInput[];
};

function checkComparison(value: Comparison, enabled: boolean) {
  expect(value.speech.trim()).not.toBe('');
  expect(value.firstSpeechMs).toBeGreaterThan(0);
  expect(value.events.some((event) => event.type === 'error')).toBe(false);
  expect(value.events.some((event) => event.type === 'cue_user')).toBe(true);
  expect(value.modelInputs.filter(({ phase }) => phase === 'teacher')).toMatchObject([
    { attached: enabled },
  ]);
  expect(
    value.modelInputs.filter(({ phase }) => phase !== 'teacher').every(({ attached }) => !attached),
  ).toBe(true);
  expect(value.modelInputs.filter(({ phase }) => phase === 'selection')).toHaveLength(
    enabled ? 1 : 0,
  );
  expect(value.selection?.status).toBe(enabled ? 'ready' : 'disabled');
  if (enabled) {
    const records = JSON.parse(value.selection!.text!) as { kind: string }[];
    expect(records.map(({ kind }) => kind)).toEqual(expect.arrayContaining(['memory', 'mastery']));
    expect(value.selection!.ms).toBeLessThanOrEqual(4000);
  }
}

it.skipIf(!process.env.F84_REPLAY_DIR)(
  'F84 checks the recorded model inputs and SSE results without calls',
  async () => {
    const dir = process.env.F84_REPLAY_DIR!;
    for (const [mode, enabled] of arms) {
      const result: Comparison = JSON.parse(
        await readFile(join(dir, `${mode}-${enabled ? 'profile' : 'baseline'}.json`), 'utf8'),
      );
      checkComparison(result, enabled);
    }
  },
);

it.skipIf(process.env.F84_LIVE !== '1')(
  'F84 compares actual QA and Discussion replies using persisted profiles',
  async () => {
    const output = process.env.F84_ARTIFACT_DIR;
    const fixture = process.env.F84_FIXTURE_DIR;
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!output || !fixture || !apiKey) throw new Error('Missing isolated F84 settings');
    const appUrl = new URL(process.env.DATABASE_URL ?? '');
    const memoryUrl = new URL(process.env.MEMORY_DATABASE_URL ?? '');
    for (const [url, database] of [
      [appUrl, 'app'],
      [memoryUrl, 'memory'],
    ] as const) {
      expect([url.hostname, url.port, url.pathname]).toEqual([
        '127.0.0.1',
        '55483',
        `/f83_preflight_${database}`,
      ]);
    }
    await mkdir(output);
    const save = (name: string, value: unknown) =>
      writeFile(join(output, `${name}.json`), JSON.stringify(value, null, 2) + '\n', {
        flag: 'wx',
      });
    const receipts: { arm: string; phase: string; tokens: number; upstreamMs: number }[] = [];
    const checkpoints: Promise<void>[] = [];
    const counts = new Map<string, number>();
    let calls = 0;
    let halted = false;
    let arm = '';
    const marker = '# Selected historical learner context';
    const profileInputs: ModelInput[] = [];
    const resolvedModel = createOpenAI({
      apiKey,
      baseURL: 'https://api.deepseek.com/v1',
      fetch: async (url, init) => {
        if (halted || String(url) !== endpoint) throw new Error('F84 external route blocked');
        const raw = JSON.parse(String(init?.body));
        const system = String(
          raw.messages?.find((message: { role: string }) => message.role === 'system')?.content,
        );
        const phase = system.includes('为当前课堂交流选取')
          ? 'selection'
          : system.includes('You are the director of an in-class')
            ? 'director'
            : system.includes('# Classroom Role')
              ? 'teacher'
              : null;
        if (!phase || raw.model !== modelId) throw new Error('F84 model or phase mismatch');
        const scope = `${arm}-${phase}`;
        if (calls >= 20 || (counts.get(scope) ?? 0) >= (phase === 'director' ? 4 : 1))
          throw new Error('F84 request cap');
        const { max_completion_tokens, max_tokens, ...rest } = raw;
        const body = {
          ...rest,
          max_tokens: Math.min(max_completion_tokens ?? max_tokens ?? 1536, 1536),
          thinking: { type: 'disabled' },
          ...(raw.stream ? { stream_options: { include_usage: true } } : {}),
        };
        const payload = JSON.stringify(body);
        if (Buffer.byteLength(payload) > 128 * 1024) throw new Error('F84 prompt too large');
        const id = `${String(++calls).padStart(2, '0')}-${scope}`;
        const requestArm = arm;
        counts.set(scope, (counts.get(scope) ?? 0) + 1);
        profileInputs.push({ arm, phase, attached: payload.includes(marker) });
        await save(`${id}.request`, body);
        const started = performance.now();
        try {
          const response = await fetch(endpoint, {
            ...init,
            body: payload,
            redirect: 'error',
            signal: AbortSignal.any([
              AbortSignal.timeout(30_000),
              ...(init?.signal ? [init.signal] : []),
            ]),
          });
          if (!response.ok) {
            await save(`${id}.http-error`, { status: response.status });
            throw new Error('F84 provider HTTP failure');
          }
          checkpoints.push(
            response
              .clone()
              .text()
              .then(async (value) => {
                const records = raw.stream
                  ? value
                      .split(/\r?\n/)
                      .filter((line) => line.startsWith('data: {'))
                      .map((line) => JSON.parse(line.slice(6)))
                  : [JSON.parse(value)];
                const usage = records.findLast((record) => record.usage)?.usage;
                if (!Number.isFinite(usage?.total_tokens)) throw new Error('F84 usage unavailable');
                const upstreamMs = Math.round(performance.now() - started);
                await save(`${id}.response`, { usage, upstreamMs, records });
                receipts.push({ arm: requestArm, phase, tokens: usage.total_tokens, upstreamMs });
              })
              .catch(async () => {
                halted = true;
                await save(`${id}.capture-error`, {
                  phase,
                  reason: 'response-or-usage-unavailable',
                });
              }),
          );
          return response;
        } catch (error) {
          halted = true;
          throw error;
        }
      },
    }).chat(modelId);
    vi.spyOn(resolver, 'resolveModel').mockImplementation(async ({ stage }) => {
      if (stage !== 'chat-adapter') throw new Error('Unexpected F84 model route');
      return {
        model: resolvedModel,
        modelId,
        modelString: `deepseek:${modelId}`,
        providerId: 'deepseek',
        modelInfo: {
          id: modelId,
          name: modelId,
          contextWindow: 131072,
          outputWindow: 8192,
          capabilities: {},
        },
        apiKey,
        serverManaged: true,
        thinkingConfig: { mode: 'disabled' },
      };
    });
    const loadContext = context.resolveDialogueLearnerContext;
    const selection: Selection[] = [];
    vi.spyOn(context, 'resolveDialogueLearnerContext').mockImplementation(async (input) => {
      const started = performance.now();
      const result = await loadContext(input);
      selection.push({ arm, ...result, ms: Math.round(performance.now() - started) });
      return result;
    });
    vi.spyOn(webSearch, 'resolveClassroomWebSearchConfig').mockResolvedValue(undefined);
    vi.stubEnv('NEXT_PUBLIC_PI_CHAT_ENABLED', 'true');
    vi.stubEnv('OPENMAIC_ENABLE_PI_NATIVE_CHILD_RUNTIME', 'true');
    vi.stubEnv('OPENMAIC_DIALOGUE_EVIDENCE_ENABLED', 'true');
    vi.stubEnv('OPENMAIC_DIALOGUE_EVIDENCE_BINDINGS_FILE', '');
    vi.stubEnv('OWNER_SINGLE_USER', 'false');
    const app = await getServerPersistenceProvider(appUrl.href);
    const memory = new Pool({
      connectionString: memoryUrl.href,
      options: '-c search_path=f67_simulated_memory',
    });
    try {
      const environment = (
        await memory.query('SELECT id FROM f68_memory_environment WHERE singleton=true')
      ).rows[0]?.id;
      expect(environment).toBeTruthy();
      vi.stubEnv(
        'OPENMAIC_SIMULATED_LEARNING_LOOP',
        JSON.stringify({
          sourceNature: 'synthetic',
          conditions: ['F83 synthetic fixture'],
          memoryEnvironmentId: environment,
        }),
      );
      const scope = simulatedScope(student);
      await memory.query(
        'UPDATE learner_memory_states SET snapshot=$3::jsonb WHERE namespace=$1 AND learner_key=$2',
        [scope.namespace, scope.learnerKey, JSON.stringify(simulatedSeed(student).snapshot)],
      );
      const expected = JSON.parse(await readFile(join(fixture, 'mastery.json'), 'utf8'));
      const mastery = await readPlannerMastery(owner, student);
      expect(mastery).toMatchObject([
        { target: expected.after.target, summary: expected.after.state.summary },
      ]);
      const usable = (await readSimulatedLearnerMemory(student, environment)).usable;
      expect(usable.pieces.some(({ id }) => id === 'm-density')).toBe(true);
      const saved = JSON.parse(await readFile(join(fixture, 'next.classroom.json'), 'utf8'));
      const store = await getOwnerScopedDocumentStore(owner);
      const doc = await store.loadDocument(saved.stage.id);
      if (!doc) throw new Error('Missing F84 current classroom');
      const scene = doc.scenes[0]!;
      scene.title = '密度单位与计算独立练习';
      scene.actions = [
        { id: 'f84-independent-task', type: 'discussion', topic, prompt: instruction },
      ];
      await store.saveDocument(doc);
      const classroom = await store.loadDocument(doc.stage.id);
      if (!classroom) throw new Error('Missing F84 edited classroom');
      await save('fixture', { stageId: doc.stage.id, scene, mastery, memory: usable });
      const { POST } = await import('@/app/api/chat/pi/route');
      for (const [mode, useProfile] of arms) {
        arm = `${mode}-${useProfile ? 'profile' : 'baseline'}`;
        if (halted) throw new Error('F84 batch stopped');
        vi.stubEnv('OPENMAIC_DIALOGUE_LEARNER_CONTEXT', useProfile ? 'true' : 'false');
        const body: StatelessChatRequest = {
          messages:
            mode === 'qa'
              ? [{ id: 'qa-current', role: 'user', parts: [{ type: 'text', text: question }] }]
              : [],
          storeState: {
            stage: classroom.stage,
            scenes: classroom.scenes,
            currentSceneId: scene.id,
            mode: 'autonomous',
            whiteboardOpen: false,
          },
          config: {
            agentIds: ['default-1'],
            sessionType: mode,
            piMaxAgentTurns: 1,
            ...(mode === 'discussion'
              ? {
                  discussionTopic: topic,
                  discussionPrompt: instruction,
                  triggerAgentId: 'default-1',
                }
              : {}),
          },
          apiKey: '',
        };
        const started = performance.now();
        const response = await POST(
          new NextRequest('http://localhost/api/chat/pi', {
            method: 'POST',
            body: JSON.stringify(body),
            headers: {
              cookie: `anonymous_id=${identity}`,
              origin: 'http://localhost',
              'content-type': 'application/json',
            },
          }),
        );
        expect(response.status).toBe(200);
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffered = '';
        let firstSpeechMs: number | undefined;
        const events: StatelessEvent[] = [];
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffered += decoder.decode(chunk.value, { stream: true });
          const parts = buffered.split('\n\n');
          buffered = parts.pop() ?? '';
          for (const part of parts)
            if (part.startsWith('data: ')) {
              const event: StatelessEvent = JSON.parse(part.slice(6));
              events.push(event);
              if (
                firstSpeechMs === undefined &&
                event.type === 'text_delta' &&
                event.data.content.trim()
              )
                firstSpeechMs = Math.round(performance.now() - started);
            }
        }
        const speech = events
          .flatMap((event) => (event.type === 'text_delta' ? [event.data.content] : []))
          .join('');
        const result: Comparison = {
          firstSpeechMs,
          speech,
          events,
          selection: selection.at(-1),
          modelInputs: profileInputs.filter((input) => input.arm === arm),
        };
        await save(arm, result);
        await Promise.all(checkpoints);
        expect(halted).toBe(false);
        checkComparison(result, useProfile);
      }
    } finally {
      await Promise.all(checkpoints);
      await save('usage', { calls, receipts, halted });
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await memory.end();
      await app.pool.end();
    }
  },
  240_000,
);
