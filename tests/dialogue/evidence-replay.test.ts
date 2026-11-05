import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  dialogueReplaySource,
  replayDialogueEvidence,
  validateDialogueOrigin,
} from '@/scripts/dialogue-evidence-replay';
import type { DialogueEvidenceRun } from '@/lib/dialogue/evidence-contracts';
describe('Dialogue offline replay', () => {
  it('uses actual captured source and raw response, without API calls or Gold', () => {
    const input = JSON.parse(
      readFileSync(
        '../docs/harness/features/F71-native-dialogue-evidence-standard/details/release-v0.2/d06.input.json',
        'utf8',
      ),
    );
    expect(
      replayDialogueEvidence(input, { text: '{"facts":[]}', finishReason: 'stop' }),
    ).toMatchObject({ state: 'empty', facts: [] });
    expect(() =>
      replayDialogueEvidence({ core: [] }, { text: '{"facts":[]}', finishReason: 'stop' }),
    ).toThrow('INVALID_REPLAY_SOURCE');
  });
  it('validates exact refs and 240 code points using the production validator', () => {
    const input = JSON.parse(
      readFileSync(
        '../docs/harness/features/F71-native-dialogue-evidence-standard/details/release-v0.2/d01.input.json',
        'utf8',
      ),
    );
    const result = (refs: string[], evidence: string) =>
      replayDialogueEvidence(input, {
        text: JSON.stringify({ facts: [{ type: 'question_help', evidence, refs }] }),
        finishReason: 'stop',
      });
    expect(result(['d01-m01'], '学生询问质量与密度的关系。').state).toBe('completed');
    expect(result(['missing'], '问').state).toBe('invalid');
    expect(result(['d01-m01'], '字'.repeat(241)).state).toBe('invalid');
  });
  it('only permits explicit loopback HTTP origins without embedded credentials or paths', () => {
    expect(validateDialogueOrigin('http://127.0.0.1:3073')).toBe('http://127.0.0.1:3073');
    for (const origin of [
      'https://remote.example',
      'http://user:pass@localhost',
      'http://localhost/a',
      'file:///tmp/a',
    ])
      expect(() => validateDialogueOrigin(origin)).toThrow();
  });
  it.each([
    ['qa', 'question_help', '教师解释千克除以立方厘米'],
    ['discussion', 'learning_performance', '教师确认12 g/cm³计算正确'],
  ])(
    'replays the frozen F76 %s semantic negative at the structural boundary',
    (mode, kept, bad) => {
      const batch = JSON.parse(
        readFileSync(`../docs/log/artifacts/F76/live-001/after-${mode}.json`, 'utf8'),
      ) as { dialogue: { evidence: DialogueEvidenceRun }[] };
      const { evidence } = batch.dialogue.at(-1)!;
      const structural = replayDialogueEvidence(evidence, evidence.reply!);
      // The human-reviewed negative is intentionally structure-valid.
      expect(structural.state).toBe('completed');
      expect(structural.facts[0].type).toBe(kept);
      expect(structural.facts[1]).toMatchObject({
        type: 'learning_performance',
        evidence: expect.stringContaining(bad),
      });
    },
  );
});

// Explicit, synthetic-only acceptance harness. No automatic model execution.
it.skipIf(!process.env.F73_HTTP_PHASE)(
  'F73 actual loopback HTTP and frozen synthetic batch',
  async () => {
    const phase = process.env.F73_HTTP_PHASE;
    if (
      !['prepare', 'smoke', 'remaining', 'readback'].includes(phase!) ||
      !process.env.F73_ARTIFACT_DIR ||
      !process.env.DATABASE_URL?.endsWith('/f73_http') ||
      !process.env.F73_TEST_MODEL
    )
      throw Error('F73_ISOLATED_HTTP_CONFIGURATION_REQUIRED');
    const { readFile, writeFile, mkdir } = await import('node:fs/promises');
    const path = await import('node:path');
    const { createHash } = await import('node:crypto');
    const { createServer } = await import('node:http');
    const { NextRequest } = await import('next/server');
    const { getServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
    const { ensureGenerationRunSchema } = await import('@/lib/persistence/generation-runs');
    const { buildChatRecordInit, statePayload, runtimeSessionId } =
      await import('@/lib/utils/chat-storage-core');
    const { readDialogueSource } = await import('@/lib/persistence/dialogue-trace-read');
    const { dialogueModelIdentity } = await import('@/lib/server/dialogue-evidence');
    const { resolveModel } = await import('@/lib/server/resolve-model');
    const dir = path.resolve(process.env.F73_ARTIFACT_DIR);
    if (!dir.replaceAll('\\', '/').endsWith('/docs/log/artifacts/F73/live-001'))
      throw Error('INVALID_ARTIFACT_DIRECTORY');
    await mkdir(dir, { recursive: true });
    process.env.OWNER_SINGLE_USER = 'true';
    process.env.OWNER_SINGLE_USER_ID = 'f73-controlled';
    process.env.OWNER_CLAIM_TRIGGER = 'explicit';
    process.env.PERSISTENCE_SHARED_OWNER_ID = '';
    process.env.OPENMAIC_DIALOGUE_EVIDENCE_ENABLED = 'true';
    process.env.MEMORY_DATABASE_URL = '';
    process.env.OPENMAIC_SIMULATED_LEARNING_LOOP = JSON.stringify({
      sourceNature: 'synthetic',
      conditions: ['F71 authored fixture, not real student'],
      memoryEnvironmentId: '00000000-0000-4000-8000-000000000073',
    });
    process.env.OPENMAIC_DIALOGUE_EVIDENCE_BINDINGS_FILE = path.join(dir, 'bindings.json');
    const provider = await getServerPersistenceProvider(process.env.DATABASE_URL!);
    const resolved = await resolveModel({
      stage: 'quiz-evidence',
      workspaceId: 'f73-controlled',
      modelString: process.env.F73_TEST_MODEL,
    });
    const model = dialogueModelIdentity(resolved);
    const route = await import('@/app/api/dialogue-evidence/[...path]/route');
    const server = createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const headers = Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [
            k,
            Array.isArray(v) ? v.join(',') : (v ?? ''),
          ]),
        );
        const request = new NextRequest(
          `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}${req.url}`,
          {
            method: req.method,
            headers,
            ...(req.method !== 'GET' ? { body: Buffer.concat(chunks) } : {}),
          },
        );
        const response =
          req.method === 'GET'
            ? await route.GET(request)
            : req.method === 'DELETE'
              ? await route.DELETE(request)
              : await route.POST(request);
        res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        res.writeHead(500);
        res.end('{"error":"HARNESS_ERROR"}');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    async function api(endpoint: string, body?: unknown) {
      const response = await fetch(origin + '/api/dialogue-evidence/' + endpoint, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'content-type': 'application/json',
          origin,
          'x-model': process.env.F73_TEST_MODEL!,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(150000),
      });
      const data = await response.json();
      if (!response.ok) throw Error('HTTP_' + response.status + '_' + data.error?.code);
      return data;
    }
    const write = async (name: string, value: unknown) =>
      writeFile(path.join(dir, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    try {
      if (phase === 'prepare') {
        const release = path.resolve(
          '../docs/harness/features/F71-native-dialogue-evidence-standard/details/release-v0.2',
        );
        const manifest = JSON.parse(
          await readFile(path.join(release, 'release-manifest.json'), 'utf8'),
        );
        for (const file of manifest.files)
          expect(
            createHash('sha256')
              .update(await readFile(path.join(release, file.path)))
              .digest('hex'),
          ).toBe(file.sha256);
        await ensureGenerationRunSchema(provider.pool);
        const bindings = [],
          cases = [];
        for (const caseId of ['D01', 'D02', 'D03', 'D04', 'D05', 'D06']) {
          const input = JSON.parse(
            await readFile(path.join(release, caseId.toLowerCase() + '.input.json'), 'utf8'),
          );
          const source = dialogueReplaySource(input),
            stageId =
              source.stageId === 'unknown-stage'
                ? 'f73-' + caseId.toLowerCase() + '-stage'
                : source.stageId;
          const runId = 'f73-synthetic-' + caseId.toLowerCase(),
            now = Date.now();
          await provider.pool.query(
            'INSERT INTO document_stages(id,name,created_at,updated_at,data) VALUES($1,$2,$3,$3,$4::jsonb)',
            [
              stageId,
              'F71 authored ' + caseId,
              now,
              JSON.stringify({ id: stageId, name: caseId, createdAt: now, updatedAt: now }),
            ],
          );
          await provider.pool.query('INSERT INTO stage_meta(stage_id,owner_id) VALUES($1,$2)', [
            stageId,
            'f73-controlled',
          ]);
          await provider.pool.query(
            'INSERT INTO generation_runs(id,owner_id,stage_id,input,state) VALUES($1,$2,$3,\'{"simulatedLearner":"A"}\',\'completed\')',
            [runId, 'f73-controlled', stageId],
          );
          if (source.initialContext?.sceneId)
            await provider.pool.query(
              'INSERT INTO generation_run_steps(run_id,step_id,output) VALUES($1,$2,$3::jsonb)',
              [
                runId,
                'scene:0:narration',
                JSON.stringify({ scene: { id: source.initialContext.sceneId, stageId } }),
              ],
            );
          const chat = {
            id: source.chatSessionId,
            type: source.type,
            title: caseId,
            status: 'completed' as const,
            createdAt: now,
            updatedAt: now,
            ...(source.initialContext ? { initialContext: source.initialContext } : {}),
            messages: source.messages.map((m) => m.message),
            config: { agentIds: ['authored-agent'] },
            toolCalls: [],
            pendingToolCalls: [],
          };
          const rid = runtimeSessionId(stageId, 'f73-controlled', chat.id);
          await provider.runtimeStore.createSession({
            id: rid,
            stageId,
            learnerKey: 'f73-controlled',
            kind: 'chat',
            status: 'active',
            createdAt: new Date(now).toISOString(),
            updatedAt: new Date(now).toISOString(),
          });
          for (const m of chat.messages)
            await provider.runtimeStore.appendRecord(
              buildChatRecordInit(
                rid,
                {
                  kind: 'chat_message',
                  payloadVersion: 1,
                  role: m.role,
                  content: source.messages.find((item) => item.message.id === m.id)!.text,
                  message: m,
                  sessionUpdatedAt: now,
                },
                chat,
                'message:' + m.id,
              ),
            );
          await provider.runtimeStore.appendRecord(
            buildChatRecordInit(rid, statePayload(chat), chat, 'state'),
          );
          const saved = await readDialogueSource(provider, 'f73-controlled', {
            stageId,
            chatSessionId: chat.id,
          });
          if (saved.status !== 'available') throw Error(saved.status);
          bindings.push({
            ownerId: 'f73-controlled',
            stageId,
            chatSessionId: chat.id,
            sourceDigest: saved.source.contentDigest,
            generationRunId: runId,
            student: 'A',
            sourceNature: 'synthetic',
            conditions: ['F71 authored fixture; synthetic run/checkpoint; not real learner'],
            memoryEnvironmentId: '00000000-0000-4000-8000-000000000073',
          });
          cases.push({ caseId, stageId, chatSessionId: chat.id });
        }
        await write('bindings.json', { version: 1, sources: bindings });
        const prepared = [];
        for (const c of cases) {
          const run = await api('runs', {
            operationId: 'prepare-' + c.caseId,
            stageId: c.stageId,
            chatSessionId: c.chatSessionId,
          });
          expect(run.state).toBe('prepared');
          expect(run.context.inputBytes).toBeLessThanOrEqual(8192);
          await write(c.caseId + '.request.json', run);
          prepared.push({ ...c, runId: run.id, inputBytes: run.context.inputBytes });
        }
        await write('batch.json', {
          phase: 'frozen',
          synthetic: true,
          releaseVersion: manifest.releaseVersion,
          model,
          cases: prepared,
          limits: {
            calls: 6,
            requestBytesPerCase: 8192,
            totalRequestBytes: 49152,
            maxOutputTokensPerCase: 4096,
            totalOutputTokens: 24576,
            automaticRetries: 0,
          },
          pricing: {
            estimate: null,
            basis:
              'No verified configured endpoint tariff; record usage, do not report unknown cost as zero. Authorized batch is bounded by six calls and output tokens, with no monetary guarantee.',
          },
          goldToGenerator: false,
        });
      } else {
        const batch = JSON.parse(await readFile(path.join(dir, 'batch.json'), 'utf8'));
        expect(model).toEqual(batch.model);
        const selected =
          phase === 'smoke'
            ? ['D01', 'D04', 'D06']
            : phase === 'remaining'
              ? ['D02', 'D03', 'D05']
              : [];
        for (const caseId of selected) {
          const c = batch.cases.find((v: { caseId: string }) => v.caseId === caseId);
          const prior = await api('runs/' + c.runId);
          expect(prior.state).toBe('prepared');
          const states = await provider.pool.query(
            "SELECT state FROM dialogue_evidence_runs WHERE state IN ('calling','captured','completed','empty','unknown','invalid','truncated')",
          );
          expect(states.rows.length).toBeLessThan(6);
          expect(
            states.rows.some((r) =>
              ['unknown', 'invalid', 'truncated', 'calling', 'captured'].includes(r.state),
            ),
          ).toBe(false);
          const result = await api('runs/' + c.runId + '/extract', {});
          await write(caseId + '.result.json', result);
          expect(['completed', 'empty']).toContain(result.state);
          expect(result.reply.usage).not.toBeNull();
        }
        if (phase === 'readback') {
          const results = [];
          for (const c of batch.cases) {
            const run = await api('runs/' + c.runId);
            results.push({ caseId: c.caseId, run });
            expect(['completed', 'empty']).toContain(run.state);
          }
          await write('restart-readback.json', results);
          expect(
            (
              await provider.pool.query(
                "SELECT to_regclass('learner_memory_runs') AS memory, to_regclass('quiz_learning_loop_jobs') AS jobs",
              )
            ).rows[0],
          ).toEqual({ memory: null, jobs: null });
          // Real HTTP recovery controls, with no additional external calls. The
          // calling lease is a deliberate harness claim, not a claimed provider failure.
          const old = results.find((r) => r.caseId === 'D06')!.run;
          const chat: import('@/lib/types/chat').ChatSession = {
            id: 'f73-recovery-session',
            type: 'qa' as const,
            title: 'Recovery harness',
            status: 'completed' as const,
            messages: old.snapshot.messages.map(
              (m: {
                message: import('ai').UIMessage<import('@/lib/types/chat').ChatMessageMetadata>;
              }) => m.message,
            ),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            initialContext: old.snapshot.initialContext,
            config: { agentIds: [] },
            toolCalls: [],
            pendingToolCalls: [],
          };
          const rid = runtimeSessionId(old.stageId, 'f73-controlled', chat.id);
          await provider.runtimeStore.createSession({
            id: rid,
            stageId: old.stageId,
            learnerKey: 'f73-controlled',
            kind: 'chat',
            status: 'active',
            createdAt: new Date(chat.createdAt).toISOString(),
            updatedAt: new Date(chat.updatedAt).toISOString(),
          });
          for (const m of chat.messages)
            await provider.runtimeStore.appendRecord(
              buildChatRecordInit(
                rid,
                {
                  kind: 'chat_message',
                  payloadVersion: 1,
                  role: m.role,
                  content: m.parts
                    .filter((p) => p.type === 'text')
                    .map((p) => p.text)
                    .join(''),
                  message: m,
                  sessionUpdatedAt: chat.updatedAt,
                },
                chat,
                'message:' + m.id,
              ),
            );
          await provider.runtimeStore.appendRecord(
            buildChatRecordInit(rid, statePayload(chat), chat, 'state'),
          );
          const saved = await readDialogueSource(provider, 'f73-controlled', {
            stageId: old.stageId,
            chatSessionId: chat.id,
          });
          if (saved.status !== 'available') throw Error(saved.status);
          const bindings = JSON.parse(
            await readFile(process.env.OPENMAIC_DIALOGUE_EVIDENCE_BINDINGS_FILE!, 'utf8'),
          );
          bindings.sources.push({
            ...old.binding,
            chatSessionId: chat.id,
            sourceDigest: saved.source.contentDigest,
          });
          await write('recovery-bindings.json', bindings);
          process.env.OPENMAIC_DIALOGUE_EVIDENCE_BINDINGS_FILE = path.join(
            dir,
            'recovery-bindings.json',
          );
          const pending = await api('runs', {
            operationId: 'recovery-prepare',
            stageId: old.stageId,
            chatSessionId: chat.id,
          });
          const { DialogueEvidenceStore } =
            await import('@/lib/persistence/dialogue-evidence-store');
          const { loadDialogueEvidenceSettings } =
            await import('@/lib/server/dialogue-evidence-provenance');
          const store = new DialogueEvidenceStore(provider);
          await store.claim('f73-controlled', pending.id, await loadDialogueEvidenceSettings());
          await provider.pool.query(
            `UPDATE dialogue_evidence_runs SET data=jsonb_set(data,'{leaseExpiresAt}','"2000-01-01T00:00:00Z"') WHERE id=$1`,
            [pending.id],
          );
          const unknown = await api('runs/' + pending.id);
          expect(unknown.state).toBe('unknown');
          const stopped = await api('runs/' + pending.id + '/extract', {});
          expect(stopped.state).toBe('unknown');
          await expect(
            api('runs/' + pending.id + '/recover', {
              action: 'confirm_paid_retry',
              operationId: 'unconfirmed',
            }),
          ).rejects.toThrow('HTTP_400');
          const retry = await api('runs/' + pending.id + '/recover', {
            action: 'confirm_paid_retry',
            operationId: 'confirmed',
            acknowledgeUnknownCost: true,
          });
          expect(retry.state).toBe('prepared');
          expect(retry.retryOf).toBe(pending.id);
          const deletion = await fetch(origin + '/api/dialogue-evidence/runs/' + retry.id, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json', origin },
            body: '{}',
          });
          expect(deletion.status).toBe(204);
          expect((await api('runs/' + retry.id)).state).toBe('revoked');
          await expect(
            api('runs', {
              operationId: 'cannot-resurrect',
              stageId: old.stageId,
              chatSessionId: chat.id,
            }),
          ).rejects.toThrow('HTTP_410');
          await write('http-recovery.json', {
            externalCalls: 0,
            nature: 'synthetic harness lease; no provider failure was induced',
            unknown,
            stopped,
            retry,
            deleted: true,
            tombstoneRefused: true,
          });
        }
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await provider.pool.end();
    }
  },
  600000,
);
