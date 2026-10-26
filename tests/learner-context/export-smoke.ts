/** Read-only F65 request/artifact export. Never calls a model or changes Memory. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import {
  buildPreclassLearnerContext,
  renderPreclassLearnerContext,
} from '@/lib/server/preclass-learner-context';
import { openSimulatedMemory } from '@/lib/server/simulated-memory';

export const task =
  '为初二学生生成一节关于密度和单位换算的简短普通课堂。只需要1页讲解和1道Quiz，重点是g/cm³与kg/m³的数值换算。先讲规则，再给一个例子。不要生成图片、视频或音频。';
async function main() {
  const { buildOutlinePrompt } = await import('@openmaic/generation');
  const [command, directory, runId] = process.argv.slice(2);
  if (!directory || !['prepare', 'inspect'].includes(command))
    throw new Error('USE_PREPARE_OR_INSPECT_DIRECTORY_OPTIONAL_RUN_ID');
  const destination = path.resolve(directory);
  await fs.mkdir(destination, { recursive: true });
  const save = (name: string, data: unknown) =>
    fs.writeFile(path.join(destination, name), JSON.stringify(data, null, 2) + '\n');

  if (command === 'prepare') {
    const session = await openSimulatedMemory();
    try {
      const views = Object.fromEntries(
        await Promise.all(
          (['A', 'B', 'C'] as const).map(
            async (id) => [id, await session.memory.read(id)] as const,
          ),
        ),
      );
      await save('memory-before.json', views);
      let captured = false;
      const stop = new Error('EXPORT_ONLY');
      try {
        await buildPreclassLearnerContext(
          { student: 'B', task, content: {} },
          {
            select: async (prompt) => {
              captured = true;
              await fs.writeFile(path.join(destination, 'selection.system.txt'), prompt.system);
              await fs.writeFile(path.join(destination, 'selection.user.json'), prompt.user);
              throw stop;
            },
          },
        );
      } catch (error) {
        if (error !== stop) throw error;
      }
      if (!captured) throw new Error('EXPECTED_NONEMPTY_B');
      await save('manifest.json', {
        task,
        student: 'B',
        route: 'original-homepage/classic',
        materials: [],
        selection: {
          stage: 'scene-outlines-stream',
          maxOutputTokens: 2000,
          retries: 0,
          fallback: false,
          maxCalls: 1,
        },
        scope:
          'One short outline; inspect before confirmation; one slide and one Quiz requested; no media/tts provider enabled. Native downstream retry policies remain unchanged.',
        modelCallsMadeByExporter: 0,
      });
      console.log(
        JSON.stringify({
          exported: true,
          modelCalls: 0,
          students: Object.keys(views),
          revisions: Object.fromEntries(
            Object.entries(views).map(([id, view]) => [id, view.usable.revision]),
          ),
        }),
      );
    } finally {
      await session.close();
    }
  } else {
    if (!runId || !/^[A-Za-z0-9_-]+$/.test(runId)) throw new Error('INVALID_RUN_ID');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const result = await pool.query(
        'SELECT id,state,step,input,outline,outline_revision,stage_id,error,created_at FROM generation_runs WHERE id=$1',
        [runId],
      );
      const run = result.rows[0];
      if (!run) throw new Error('RUN_NOT_FOUND');
      // This exporter accepts only the frozen synthetic smoke request, never arbitrary owner content.
      if (
        run.input.simulatedLearner !== 'B' ||
        run.input.requirement !== task ||
        run.input.learnerProfile
      )
        throw new Error('NOT_F65_SYNTHETIC_SMOKE');
      await save('run.json', run);
      const steps = await pool.query(
        'SELECT step_id,output FROM generation_run_steps WHERE run_id=$1',
        [runId],
      );
      await save('steps.json', steps.rows);
      const context =
        run.outline?.learnerContext ??
        steps.rows.find((row) => row.step_id === 'learner-context')?.output;
      if (context) {
        await save('frozen-context.json', context);
        const prompt = buildOutlinePrompt(
          { requirement: task },
          {
            learnerContext: renderPreclassLearnerContext(context),
            imageGenerationEnabled: false,
            videoGenerationEnabled: false,
            teacherContext: '',
          },
        );
        await save('planner-prompt.json', prompt);
        await save('planner-export-note.json', {
          reconstruction: true,
          reason:
            'Deterministic reconstruction from frozen run; no material/research/teacher/media inputs for this controlled request. Not a wire capture.',
        });
        await save('selection.validated.json', {
          selected: context.selected.map((p: { pieceId: string; reason: string }) => ({
            pieceId: p.pieceId,
            reason: p.reason,
          })),
        });
      }
      const events = await pool.query(
        'SELECT type,data FROM generation_run_events WHERE run_id=$1 ORDER BY seq',
        [runId],
      );
      await save('events.json', events.rows);
      if (run.stage_id) {
        const stages = await pool.query('SELECT data FROM document_stages WHERE id=$1', [
          run.stage_id,
        ]);
        const scenes = await pool.query(
          'SELECT data FROM document_scenes WHERE stage_id=$1 ORDER BY scene_order,id',
          [run.stage_id],
        );
        const classroomDirectory = path.resolve(
          '../classroom/F65-simulated-context-mvp/live-one-001',
        );
        await fs.mkdir(classroomDirectory, { recursive: true });
        await fs.writeFile(
          path.join(classroomDirectory, 'manifest.json'),
          JSON.stringify(
            {
              formatVersion: '1.0',
              stage: stages.rows[0]?.data,
              scenes: scenes.rows.map((row) => row.data),
            },
            null,
            2,
          ) + '\n',
        );
      }
      const usageText = await fs.readFile(path.resolve('data/usage/2026-10.jsonl'), 'utf8');
      const usage = usageText
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .filter((row) => row.createdAt >= Number(run.created_at));
      await save('usage-window.json', {
        attribution: 'Time window since this run began; app usage log does not bind run IDs.',
        records: usage,
      });
      const session = await openSimulatedMemory();
      try {
        const after = Object.fromEntries(
          await Promise.all(
            (['A', 'B', 'C'] as const).map(async (id) => [id, await session.memory.read(id)]),
          ),
        );
        await save('memory-after.json', after);
        const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
        const before = JSON.parse(
          await fs.readFile(path.join(destination, 'memory-before.json'), 'utf8'),
        );
        if (hash(before) !== hash(after)) throw new Error('MEMORY_CHANGED_DURING_READONLY_SMOKE');
      } finally {
        await session.close();
      }
      console.log(
        JSON.stringify({
          state: run.state,
          step: run.step,
          selected: context?.selected?.map((p: { pieceId: string }) => p.pieceId),
          memoryUnchanged: true,
        }),
      );
    } finally {
      await pool.end();
    }
  }
}
main().catch(() => {
  console.error('F65_SMOKE_EXPORT_FAILED');
  process.exitCode = 1;
});
