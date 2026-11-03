import { it, expect } from 'vitest';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { ensureGenerationRunSchema } from '@/lib/persistence/generation-runs';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { openSimulatedMemory } from '@/lib/server/simulated-memory';
import { readSimulatedLearnerMemory } from '@/lib/server/simulated-learner-memory';
import { makeDocument, makeSlideScene } from '../agent-runtime/_stage-fixtures';
import { DIALOGUE_EVIDENCE_SYSTEM } from '@/lib/dialogue/evidence-prompt';
import { DIALOGUE_MEMORY_SYSTEM } from '@/lib/learner-memory/dialogue-prompt';
import { DialogueLoopStore } from '@/lib/server/dialogue-learning-loop/store';
import { spawn } from 'node:child_process';
import { resolveModel } from '@/lib/server/resolve-model';
import { getProvider } from '@/lib/ai/providers';
import { readDialogueEvidenceRun } from '@/lib/persistence/dialogue-evidence-read';
import { DialogueMemoryService } from '@/lib/server/dialogue-memory';
import { loadDialogueMemorySettings } from '@/lib/server/dialogue-memory-authority';
const phase = process.env.F75_LIVE_PHASE;
it.skipIf(!phase)(
  'F75 isolated native page preparation/readback; never invokes a model itself',
  async () => {
    if (
      !['prepare', 'readback', 'serve'].includes(phase!) ||
      !process.env.DATABASE_URL?.endsWith('/f75_app') ||
      !process.env.MEMORY_DATABASE_URL?.endsWith('/f75_memory')
    )
      throw Error('F75_ISOLATED_DATABASES_REQUIRED');
    const dir = path.resolve(process.env.F75_ARTIFACT_DIR ?? '');
    if (!dir.replaceAll('\\', '/').endsWith('/docs/log/artifacts/F75/live-001'))
      throw Error('F75_ARTIFACT_DIR_REQUIRED');
    await mkdir(dir, { recursive: true });
    const owner = 'f75-controlled',
      environmentId = '00000000-0000-4000-8000-000000000075';
    process.env.OWNER_SINGLE_USER = 'true';
    process.env.OWNER_SINGLE_USER_ID = owner;
    process.env.PERSISTENCE_SHARED_OWNER_ID = '';
    process.env.OPENMAIC_SIMULATED_LEARNING_LOOP = JSON.stringify({
      sourceNature: 'proxy',
      conditions: [
        'F75 isolated synthetic classroom; operator knows reference answers; not real learner evidence',
      ],
      memoryEnvironmentId: environmentId,
    });
    process.env.OPENMAIC_DIALOGUE_EVIDENCE_BINDINGS_FILE = '';
    const app = await getServerPersistenceProvider(process.env.DATABASE_URL!);
    const opened = await openSimulatedMemory();
    const write = (name: string, data: unknown) =>
      writeFile(path.join(dir, name), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
    try {
      if (phase === 'serve') {
        const noPaid = process.env.F75_NO_PAID === '1';
        const resolved = noPaid
          ? null
          : await resolveModel({
              stage: 'quiz-evidence',
              workspaceId: owner,
              modelString: 'deepseek:deepseek-v4-flash',
            });
        const upstream = noPaid
          ? 'https://example.invalid/v1'
          : (resolved?.baseUrl ?? getProvider('deepseek')?.defaultBaseUrl);
        const key = noPaid ? 'F75-NO-PAID-CONTROL' : resolved?.apiKey;
        if (!upstream || !key) throw Error('F75_CONFIGURED_PROVIDER_REQUIRED');
        await new Promise<void>((resolve, reject) => {
          const child = spawn(process.execPath, [path.join(dir, 'start-server.mjs')], {
            cwd: process.cwd(),
            windowsHide: true,
            stdio: 'inherit',
            env: { ...process.env, F75_PROVIDER_KEY: key, F75_UPSTREAM_URL: upstream },
          });
          const stop = () => child.kill('SIGINT');
          process.once('SIGINT', stop);
          child.on('error', reject);
          child.on('exit', (code) => {
            process.removeListener('SIGINT', stop);
            if (code === 0) resolve();
            else reject(Error('F75_SERVER_EXIT'));
          });
        });
        return;
      }
      const originals: Record<string, number> = {};
      for (const [rel, manifest] of [
        ['F73/live-001', 'artifact-manifest.json'],
        ['F74/live-001', 'artifact-manifest.json'],
      ]) {
        const base = path.resolve('../docs/log/artifacts', rel),
          m = JSON.parse(await readFile(path.join(base, manifest), 'utf8'));
        for (const f of m.files)
          expect(sha(await readFile(path.join(base, f.path)))).toBe(f.sha256);
        originals[rel] = m.files.length;
      }
      if (phase === 'prepare') {
        await opened.memory.provider.withTransaction(async (tx) => {
          await tx.query(
            'CREATE TABLE f68_memory_environment(singleton BOOLEAN PRIMARY KEY,id TEXT NOT NULL)',
          );
          await tx.query('INSERT INTO f68_memory_environment VALUES(true,$1)', [environmentId]);
        });
        await opened.memory.initialize();
        const before = await opened.memory.read('A');
        await write('memory-before.json', before);
        await ensureGenerationRunSchema(app.pool);
        const stage = 'f75-classroom',
          run = 'run-F75controlled001';
        expect(run).toMatch(/^run-[\w-]{16}$/);
        const one = makeSlideScene('f75-density-one', stage, 0, '密度与质量：QA');
        const two = makeSlideScene('f75-conversion-two', stage, 1, '单位换算：Discussion');
        if (one.content.type === 'slide') one.content.canvas.viewportRatio = 9 / 16;
        if (two.content.type === 'slide') two.content.canvas.viewportRatio = 9 / 16;
        two.actions = [
          {
            id: 'f75-discussion-action',
            type: 'discussion',
            topic: '密度计算中的单位换算求助',
            prompt:
              '本次为合成隔离讨论。请先给出1 kg=1000 g、0.6 kg=600 g、体积30 cm³这些条件，邀请用户算600÷30，再等用户回答。保留教师已给出的帮助条件。',
            agentId: 'default-1',
          },
        ];
        const doc = makeDocument(stage, 'F75 合成密度课堂', [one, two]);
        doc.outline = {
          ...doc.outline!,
          producer: 'server-job',
          producerRef: run,
          generationComplete: true,
        };
        const documents = await getOwnerScopedDocumentStore(owner);
        await documents.createDocument(doc);
        const input = {
          requirement: 'F75 authored synthetic fixed slides, not a newly model-generated course',
          simulatedLearner: 'A',
          materialIds: [],
          interactive: false,
          taskEngine: false,
          agents: { mode: 'preset', agentIds: ['default-1'] },
          outlineReview: 'wait',
        };
        await app.pool.query(
          "INSERT INTO generation_runs(id,owner_id,stage_id,input,state,outline) VALUES($1,$2,$3,$4::jsonb,'completed',$5::jsonb)",
          [
            run,
            owner,
            stage,
            JSON.stringify(input),
            JSON.stringify({
              outlines: [],
              languageDirective: 'zh-CN',
              taskEngineMode: false,
              courseTitle: doc.stage.name,
            }),
          ],
        );
        for (const scene of doc.scenes)
          await app.pool.query(
            'INSERT INTO generation_run_steps(run_id,step_id,output) VALUES($1,$2,$3::jsonb)',
            [run, 'scene:' + scene.order + ':narration', JSON.stringify({ scene })],
          );
        await write('seed-document.json', doc);
        await write('batch.json', {
          version: 'f75-live-001.v1',
          sourceNature: 'proxy',
          synthetic: true,
          operatorKnowsAnswers: true,
          owner,
          environmentId,
          stageId: stage,
          generationRunId: run,
          model: 'deepseek:deepseek-v4-flash',
          scope:
            'real native page QA/Discussion + automatic stages + next-course planning context; fixed authored initial slides',
          limits: {
            totalCalls: 16,
            evidenceCalls: 2,
            memoryCalls: 2,
            maxOutputPerOtherCall: 8192,
            totalConfiguredOutput: 131072,
            totalRequestBytes: 2097152,
            timeoutMs: 180000,
            retries: 0,
            fallback: false,
          },
          systemHashes: {
            evidence: sha(DIALOGUE_EVIDENCE_SYSTEM),
            memory: sha(DIALOGUE_MEMORY_SYSTEM),
          },
          inputs: {
            qa: '质量80 g、体积20 cm³，我能算80÷20=4，但不知道为什么不能只看质量大小判断密度。请解释，不要另出新题。',
            discussionAnswer:
              '我需要你刚才的换算提示才能继续：600÷30=20 g/cm³。我还不能独立把kg换成g。',
            nextClass:
              '为模拟学生A准备一堂关于密度与单位换算的后续课，参考最近受助计算经历，不要把受助表现当独立掌握。',
          },
          monetaryCost: 'unknown',
          originalHashes: originals,
        });
      } else {
        const jobs = (
          await app.pool.query(
            'SELECT id FROM dialogue_loop_jobs WHERE owner_id=$1 ORDER BY created_at',
            [owner],
          )
        ).rows;
        expect(jobs).toHaveLength(2);
        const store = new DialogueLoopStore(app),
          memory = new DialogueMemoryService(app, opened.memory, loadDialogueMemorySettings);
        const result = [];
        for (const row of jobs) {
          const job = await store.read(owner, row.id as string);
          expect(job.state).toBe('completed');
          const evidence = await readDialogueEvidenceRun(app, owner, job.evidenceRunId!);
          const delivery = job.memoryDeliveryId
            ? await memory.read(owner, job.memoryDeliveryId)
            : null;
          result.push({ job, evidence, delivery });
        }
        const formal = await readSimulatedLearnerMemory('A');
        expect(formal.coverage.some((s) => s.source_id.includes(':dialogue:'))).toBe(true);
        await write('restart-readback.json', {
          results: result,
          formal,
          originalHashes: originals,
          additionalModelCalls: 0,
        });
      }
    } finally {
      await opened.close();
      await app.pool.end();
    }
  },
  3_600_000,
);
