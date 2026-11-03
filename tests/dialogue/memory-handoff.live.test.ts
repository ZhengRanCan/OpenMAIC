import { it, expect } from 'vitest';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { ensureGenerationRunSchema } from '@/lib/persistence/generation-runs';
import { buildChatRecordInit, statePayload, runtimeSessionId } from '@/lib/utils/chat-storage-core';
import { readDialogueSource } from '@/lib/persistence/dialogue-trace-read';
import { resolveModel } from '@/lib/server/resolve-model';
import { dialogueMemoryModelIdentity } from '@/lib/server/dialogue-memory-model';
import { openSimulatedMemory } from '@/lib/server/simulated-memory';
import { readSimulatedLearnerMemory } from '@/lib/server/simulated-learner-memory';
import type { DialogueEvidenceRun } from '@/lib/dialogue/evidence-contracts';

it.skipIf(!process.env.F74_HTTP_PHASE)(
  'F74 frozen actual HTTP shared Memory acceptance',
  async () => {
    const phase = process.env.F74_HTTP_PHASE;
    if (
      !['prepare', 'first', 'second', 'readback'].includes(phase!) ||
      !process.env.F74_ARTIFACT_DIR ||
      !process.env.F74_TEST_MODEL ||
      !process.env.DATABASE_URL?.endsWith('/f74_app') ||
      !process.env.MEMORY_DATABASE_URL?.endsWith('/f74_memory')
    )
      throw Error('F74_ISOLATED_CONFIGURATION_REQUIRED');
    const dir = path.resolve(process.env.F74_ARTIFACT_DIR);
    if (!dir.replaceAll('\\', '/').endsWith('/docs/log/artifacts/F74/live-001'))
      throw Error('F74_ARTIFACT_LOCATION_REQUIRED');
    await mkdir(dir, { recursive: true });
    const envId = '00000000-0000-4000-8000-000000000073';
    process.env.OWNER_SINGLE_USER = 'true';
    process.env.OWNER_SINGLE_USER_ID = 'f73-controlled';
    process.env.OWNER_CLAIM_TRIGGER = 'explicit';
    process.env.PERSISTENCE_SHARED_OWNER_ID = '';
    process.env.OPENMAIC_DIALOGUE_MEMORY_ENABLED = 'true';
    process.env.OPENMAIC_DIALOGUE_EVIDENCE_ENABLED = '';
    process.env.OPENMAIC_SIMULATED_LEARNING_LOOP = JSON.stringify({
      sourceNature: 'synthetic',
      conditions: ['F74 isolated copy of approved F73 sources'],
      memoryEnvironmentId: envId,
    });
    process.env.OPENMAIC_DIALOGUE_EVIDENCE_BINDINGS_FILE = path.join(dir, 'bindings.json');
    const app = await getServerPersistenceProvider(process.env.DATABASE_URL!);
    const resolved = await resolveModel({
      stage: 'quiz-evidence',
      workspaceId: 'f73-controlled',
      modelString: process.env.F74_TEST_MODEL,
    });
    const model = dialogueMemoryModelIdentity(resolved);
    const route = await import('@/app/api/dialogue-memory/[...path]/route');
    const server = createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const c of req) chunks.push(Buffer.from(c));
        const headers = Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [
            k,
            Array.isArray(v) ? v.join(',') : (v ?? ''),
          ]),
        );
        const request = new NextRequest(
          `http://127.0.0.1:${(server.address() as AddressInfo).port}${req.url}`,
          {
            method: req.method,
            headers,
            ...(req.method === 'GET' ? {} : { body: Buffer.concat(chunks) }),
          },
        );
        const result = req.method === 'GET' ? await route.GET(request) : await route.POST(request);
        res.writeHead(result.status, Object.fromEntries(result.headers.entries()));
        res.end(Buffer.from(await result.arrayBuffer()));
      } catch {
        res.writeHead(500);
        res.end('{"error":"HARNESS_ERROR"}');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    async function api(endpoint: string, body?: unknown) {
      const response = await fetch(origin + '/api/dialogue-memory/' + endpoint, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'content-type': 'application/json',
          origin,
          'x-model': process.env.F74_TEST_MODEL!,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(220000),
      });
      const result = await response.json();
      if (!response.ok) throw Error('HTTP_' + response.status + '_' + result.error?.code);
      return result;
    }
    const write = (name: string, value: unknown) =>
      writeFile(path.join(dir, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    const f73 = path.resolve('../docs/log/artifacts/F73/live-001');
    async function checkOriginal() {
      const manifest = JSON.parse(await readFile(path.join(f73, 'artifact-manifest.json'), 'utf8'));
      for (const f of manifest.files)
        expect(
          createHash('sha256')
            .update(await readFile(path.join(f73, f.path)))
            .digest('hex'),
        ).toBe(f.sha256);
      return manifest.files.length;
    }
    try {
      if (phase === 'prepare') {
        expect(await checkOriginal()).toBe(26);
        await ensureGenerationRunSchema(app.pool);
        const bindings = [],
          sources = [];
        for (const caseId of ['D01', 'D02', 'D06']) {
          const evidence: DialogueEvidenceRun = JSON.parse(
            await readFile(path.join(f73, caseId + '.result.json'), 'utf8'),
          );
          const snapshot = evidence.snapshot!,
            binding = evidence.binding!;
          expect(binding.memoryEnvironmentId).toBe(envId);
          await app.pool.query(
            'INSERT INTO document_stages(id,name,created_at,updated_at,data) VALUES($1,$2,$3,$4,$5::jsonb)',
            [
              evidence.stageId,
              'F74 synthetic copy ' + caseId,
              snapshot.createdAt,
              snapshot.updatedAt,
              JSON.stringify({
                id: evidence.stageId,
                name: caseId,
                createdAt: snapshot.createdAt,
                updatedAt: snapshot.updatedAt,
              }),
            ],
          );
          await app.pool.query('INSERT INTO stage_meta(stage_id,owner_id) VALUES($1,$2)', [
            evidence.stageId,
            evidence.ownerId,
          ]);
          await app.pool.query(
            "INSERT INTO generation_runs(id,owner_id,stage_id,input,state) VALUES($1,$2,$3,$4::jsonb,'completed')",
            [
              binding.generationRunId,
              evidence.ownerId,
              evidence.stageId,
              JSON.stringify({ simulatedLearner: binding.student }),
            ],
          );
          if (snapshot.initialContext?.sceneId)
            await app.pool.query(
              'INSERT INTO generation_run_steps(run_id,step_id,output) VALUES($1,$2,$3::jsonb)',
              [
                binding.generationRunId,
                'scene:0:narration',
                JSON.stringify({
                  scene: { id: snapshot.initialContext.sceneId, stageId: evidence.stageId },
                }),
              ],
            );
          const chat = {
            id: snapshot.chatSessionId,
            type: snapshot.type,
            title: snapshot.title,
            status: 'completed' as const,
            createdAt: snapshot.createdAt,
            updatedAt: snapshot.updatedAt,
            messages: snapshot.messages.map((m) => m.message),
            ...(snapshot.initialContext ? { initialContext: snapshot.initialContext } : {}),
            config: { agentIds: [] },
            toolCalls: [],
            pendingToolCalls: [],
          };
          const rid = runtimeSessionId(evidence.stageId, evidence.ownerId, chat.id);
          await app.runtimeStore.createSession({
            id: rid,
            stageId: evidence.stageId,
            learnerKey: evidence.ownerId,
            kind: 'chat',
            status: 'active',
            createdAt: new Date(chat.createdAt).toISOString(),
            updatedAt: new Date(chat.updatedAt).toISOString(),
          });
          for (const m of chat.messages)
            await app.runtimeStore.appendRecord(
              buildChatRecordInit(
                rid,
                {
                  kind: 'chat_message',
                  payloadVersion: 1,
                  role: m.role,
                  content: snapshot.messages.find((x) => x.message.id === m.id)!.text,
                  message: m,
                  sessionUpdatedAt: chat.updatedAt,
                },
                chat,
                'message:' + m.id,
              ),
            );
          await app.runtimeStore.appendRecord(
            buildChatRecordInit(rid, statePayload(chat), chat, 'state'),
          );
          const saved = await readDialogueSource(app, evidence.ownerId, {
            stageId: evidence.stageId,
            chatSessionId: chat.id,
          });
          if (saved.status !== 'available') throw Error(saved.status);
          expect(saved.source.contentDigest).toBe(snapshot.contentDigest);
          expect(saved.source.messages).toEqual(snapshot.messages);
          await app.pool.query(
            'INSERT INTO dialogue_evidence_runs(id,owner_id,stage_id,chat_session_id,reuse_key,retry_of,state,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
            [
              evidence.id,
              evidence.ownerId,
              evidence.stageId,
              evidence.chatSessionId,
              evidence.reuseKey,
              evidence.retryOf,
              evidence.state,
              JSON.stringify(evidence),
            ],
          );
          bindings.push(binding);
          sources.push({
            caseId,
            evidenceRunId: evidence.id,
            sha256: createHash('sha256')
              .update(await readFile(path.join(f73, caseId + '.result.json')))
              .digest('hex'),
          });
        }
        await write('bindings.json', { version: 1, sources: bindings });
        const opened = await openSimulatedMemory();
        try {
          await opened.memory.provider.withTransaction(async (tx) => {
            await tx.query(
              'CREATE TABLE f68_memory_environment(singleton BOOLEAN PRIMARY KEY,id TEXT NOT NULL)',
            );
            await tx.query('INSERT INTO f68_memory_environment VALUES(true,$1)', [envId]);
          });
          await opened.memory.initialize();
          await write('before.json', await opened.memory.read('A'));
        } finally {
          await opened.close();
        }
        const first = await api('deliveries', {
          operationId: 'f74-D01',
          evidenceRunId: sources.find((s) => s.caseId === 'D01')!.evidenceRunId,
        });
        expect(first.delivery.state).toBe('prepared');
        expect(first.memoryRun.prompt.inputBytes).toBeLessThanOrEqual(48000);
        await write('D01.prepared.json', first);
        const empty = await api('deliveries', {
          operationId: 'f74-D06',
          evidenceRunId: sources.find((s) => s.caseId === 'D06')!.evidenceRunId,
        });
        expect(empty.delivery.state).toBe('empty');
        expect(empty.memoryRun).toBeNull();
        await write('D06.empty.json', empty);
        await write('batch.json', {
          synthetic: true,
          sourceUse: 'isolated exact copies of approved F73 outputs, not new student events',
          sources,
          model,
          limits: {
            calls: 2,
            maxOutputTokens: 8192,
            totalOutputTokens: 16384,
            timeoutMs: 180000,
            maxRequestBytes: 48000,
            totalRequestBytes: 96000,
            retries: 0,
          },
          environmentId: envId,
          targetSetup:
            'explicit isolated reservation matching F73 binding; no existing environment rebind',
          cost: {
            value: null,
            basis: 'no verified configured endpoint tariff; unknown is not zero',
          },
          dialogueExtractionCalls: 0,
        });
      } else {
        const batch = JSON.parse(await readFile(path.join(dir, 'batch.json'), 'utf8'));
        expect(model).toEqual(batch.model);
        if (phase === 'first' || phase === 'second') {
          const caseId = phase === 'first' ? 'D01' : 'D02';
          const prepared = JSON.parse(
            await readFile(path.join(dir, caseId + '.prepared.json'), 'utf8'),
          );
          expect(prepared.memoryRun.prompt.inputBytes).toBeLessThanOrEqual(48000);
          const opened = await openSimulatedMemory();
          try {
            const rows = await opened.memory.provider.withTransaction((tx) =>
              tx.query(
                "SELECT state FROM learner_memory_runs WHERE id LIKE 'f74:%' AND state!='prepared'",
              ),
            );
            expect(rows.rows.length).toBe(phase === 'first' ? 0 : 1);
            expect(rows.rows.every((r) => r.state === 'completed')).toBe(true);
          } finally {
            await opened.close();
          }
          const result = await api('deliveries/' + prepared.delivery.id + '/update', {});
          await write(caseId + '.result.json', result);
          expect(result.delivery.state).toBe('completed');
          expect(result.memoryRun.reply.usage?.totalTokens).toBeGreaterThan(0);
          const duplicate = await api('deliveries/' + prepared.delivery.id + '/update', {});
          expect(duplicate.memory.snapshot.revision).toBe(result.memory.snapshot.revision);
          await write(caseId + '.duplicate.json', duplicate);
          if (phase === 'first') {
            const next = await api('deliveries', {
              operationId: 'f74-D02',
              evidenceRunId: batch.sources.find((s: { caseId: string }) => s.caseId === 'D02')
                .evidenceRunId,
            });
            expect(next.delivery.state).toBe('prepared');
            await write('D02.prepared.json', next);
          }
        } else {
          const results = [];
          for (const caseId of ['D01', 'D02']) {
            const prepared = JSON.parse(
              await readFile(path.join(dir, caseId + '.prepared.json'), 'utf8'),
            );
            const result = await api('deliveries/' + prepared.delivery.id);
            expect(result.delivery.state).toBe('completed');
            results.push({ caseId, result });
          }
          const formal = await readSimulatedLearnerMemory('A');
          expect(formal.snapshot.revision).toBe(results[1].result.memory.snapshot.revision);
          expect(formal.coverage.some((s) => s.source_id.includes(':dialogue:'))).toBe(true);
          expect(await checkOriginal()).toBe(26);
          await write('restart-readback.json', {
            results,
            formal,
            f73OriginalHashes: 26,
            additionalModelCalls: 0,
          });
        }
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await app.pool.end();
    }
  },
  600000,
);
