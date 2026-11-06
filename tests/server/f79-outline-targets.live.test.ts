import { createOpenAI } from '@ai-sdk/openai';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { POST as confirmOutline } from '@/app/api/generation-runs/[id]/confirm-outline/route';
import { GET as readRun } from '@/app/api/generation-runs/[id]/route';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { executeGenerationRun } from '@/lib/server/generation/run/engine';
import { defaultRunStepServices } from '@/lib/server/generation/run/services';
import { claimNextGenerationRun, createGenerationRun } from '@/lib/server/generation/run/store';
import type { GenerationRunSnapshot } from '@/lib/server/generation/run/types';
import { generateOutlines } from '@/lib/server/generation/steps/outline';

const CASES = [
  {
    name: 'density',
    requirement:
      '为初中生设计一堂 3 页中文密度课。先示范 0.45 kg、90 cm³ 的密度计算，然后用一道给出 kg 和 cm³ 的新题，让学生独立写出单位换算、列式、结果和单位。',
  },
  {
    name: 'grammar',
    requirement:
      '为初学者设计一堂 3 页中文英语语法课，主题是一般现在时的主谓一致，限 he、she、they 和常见实义动词。用英语例句对比单复数主语，让学生独立改写新的主谓不一致句子，并用自己的话说明改写理由。',
  },
];

it.skipIf(process.env.F79_LIVE !== '1')(
  'generates and confirms course targets from two live Planner streams',
  async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    const output = process.env.F79_ARTIFACT_DIR;
    const databaseUrl = process.env.F79_DATABASE_URL;
    if (!apiKey || !output || !databaseUrl) throw new Error('Missing F79 live configuration');
    const database = new URL(databaseUrl);
    if (database.hostname !== '127.0.0.1' || database.pathname !== '/f79_live') {
      throw new Error('F79 requires its dedicated local database');
    }
    await mkdir(output);
    process.env.DATABASE_URL = databaseUrl;
    process.env.ASSET_S3_BUCKET = '';
    const pool = new Pool({ connectionString: databaseUrl });
    const identity = '67eb7df2-33a8-4fbd-acab-cda635b8ae79';
    const owner = `anon:${identity}`;
    const headers = { cookie: `anonymous_id=${identity}` };
    const modelId = 'deepseek-v4-flash';
    let totalCalls = 0;

    try {
      await getServerPersistenceProvider(databaseUrl, () => pool);
      for (const { name, requirement } of CASES) {
        let calls = 0;
        const save = (file: string, value: unknown) =>
          writeFile(join(output, `${name}.${file}.json`), JSON.stringify(value, null, 2) + '\n', {
            flag: 'wx',
          });
        let capture:
          | Promise<{ content: string; usage: unknown; finishReason: string | null }>
          | undefined;
        const provider = createOpenAI({
          apiKey,
          baseURL: 'https://api.deepseek.com/v1',
          fetch: async (url, init) => {
            if (
              String(url) !== 'https://api.deepseek.com/v1/chat/completions' ||
              calls ||
              totalCalls >= 2
            ) {
              throw new Error('F79 request limit');
            }
            const body = {
              ...JSON.parse(String(init?.body)),
              max_tokens: 4096,
              thinking: { type: 'disabled' },
              stream_options: { include_usage: true },
            };
            const serialized = JSON.stringify(body);
            expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(65536);
            await save('request', body);
            calls++;
            totalCalls++;
            const response = await fetch(url, {
              ...init,
              body: serialized,
              redirect: 'error',
              signal: AbortSignal.any([
                ...(init?.signal ? [init.signal] : []),
                AbortSignal.timeout(120_000),
              ]),
            });
            if (!response.ok) {
              await save('error', { status: response.status });
              throw new Error(`F79 DeepSeek HTTP ${response.status}`);
            }
            capture = response
              .clone()
              .text()
              .then(async (stream) => {
                let content = '';
                let usage: { total_tokens?: number } | undefined;
                let finishReason: string | null = null;
                for (const line of stream.split(/\r?\n/)) {
                  if (!line.startsWith('data: ')) continue;
                  const data = line.slice(6).trim();
                  if (data === '[DONE]') break;
                  const event = JSON.parse(data);
                  content += event.choices?.[0]?.delta?.content ?? '';
                  finishReason = event.choices?.[0]?.finish_reason ?? finishReason;
                  usage = event.usage ?? usage;
                }
                const result = { content, usage, finishReason };
                await save('response', result);
                expect(finishReason).toBe('stop');
                expect(usage?.total_tokens).toBeGreaterThan(0);
                return result;
              });
            void capture.catch(() => {});
            return response;
          },
        });
        const run = await createGenerationRun(
          owner,
          {
            requirement,
            materialIds: [],
            interactive: false,
            taskEngine: false,
            agents: { mode: 'preset', agentIds: [] },
            outlineReview: 'wait',
          },
          { maxActiveRunsPerOwner: 3, maxWaitingRunsPerOwner: 3 },
        );
        const claimed = await claimNextGenerationRun('f79-live', {
          runId: run.id,
          leaseTtlMs: 150_000,
          maxTakeovers: 0,
        });
        if (!claimed) throw new Error('Could not claim F79 run');
        const outcome = await executeGenerationRun(claimed, {
          signal: AbortSignal.timeout(125_000),
          services: {
            ...defaultRunStepServices,
            outline: async (_owner, input, ctx) =>
              generateOutlines(
                {
                  ...input,
                  allowImageGeneration: false,
                  allowVideoGeneration: false,
                  model: {
                    model: provider.chat(modelId),
                    modelInfo: {
                      id: modelId,
                      name: 'DeepSeek V4 Flash',
                      outputWindow: 4096,
                      capabilities: {},
                    },
                    modelString: `deepseek:${modelId}`,
                    thinkingConfig: undefined,
                    serverManaged: false,
                  },
                },
                {
                  ...ctx,
                  workspaceId: null,
                  resolveVisionImages: async () => [],
                },
              ),
          },
        });
        const captured = await capture;
        expect(outcome).toBe('waiting');
        expect(calls).toBe(1);
        if (!captured) throw new Error('F79 model response missing');
        const modelOutput = JSON.parse(
          captured.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''),
        );
        expect(Array.isArray(modelOutput.targetStatements)).toBe(true);
        expect(modelOutput.targetStatements.length).toBeGreaterThanOrEqual(1);
        expect(modelOutput.targetStatements.length).toBeLessThanOrEqual(3);
        const params = { params: Promise.resolve({ id: run.id }) };
        const url = `http://localhost/api/generation-runs/${run.id}`;
        const snapshot = async (): Promise<GenerationRunSnapshot> => {
          const response = await readRun(new NextRequest(url, { headers }), params);
          expect(response.status).toBe(200);
          return (await response.json()).run;
        };
        const before = await snapshot();
        await save('before-confirm', before);
        expect(before.state).toBe('awaiting_outline_confirmation');
        expect(before.outline?.outlines).toHaveLength(3);
        expect(before.outline?.targets).toEqual(
          modelOutput.targetStatements.map((statement: unknown, index: number) => ({
            id: `${run.id}:target:${index + 1}`,
            revision: 1,
            statement,
          })),
        );
        const confirmation = await confirmOutline(
          new NextRequest(`${url}/confirm-outline`, {
            method: 'POST',
            headers: { ...headers, 'content-type': 'application/json' },
            body: JSON.stringify({
              commandId: `f79-${name}`,
              outlineRevision: before.outline?.revision,
            }),
          }),
          params,
        );
        expect(confirmation.status).toBe(200);
        const after = await snapshot();
        await save('after-confirm', after);
        expect(after.state).toBe('generating');
        expect(after.outline).toEqual(before.outline);
        expect(after.stageId).toBeNull();
      }
      expect(totalCalls).toBe(2);
    } finally {
      await pool.end();
    }
  },
  260_000,
);
