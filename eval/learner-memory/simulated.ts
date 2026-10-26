/** Local simulated-student environment CLI; no Gold or evaluation corpus is loaded. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { canonicalJson, invariant, sourceSchema } from '@/lib/learner-memory/contracts';
import {
  simulatedSeed,
  simulatedSource,
  SIMULATED_DEMO,
  SIMULATED_SEED_SHA256,
  SIMULATED_SEED_VERSION,
  SIMULATED_STUDENTS,
  type SimulatedStudent,
} from '@/lib/learner-memory/simulated-seeds';
import { SIMULATED_PROMPT_SHA256 } from '@/lib/learner-memory/simulated-prompt';
import {
  invokeSimulatedMemoryModel,
  openSimulatedMemory,
  SIMULATED_MEMORY_SCHEMA,
} from '@/lib/server/simulated-memory';

const student = (value?: string): SimulatedStudent => {
  invariant(SIMULATED_STUDENTS.includes(value as SimulatedStudent), 'USE_STUDENT_A_B_OR_C');
  return value as SimulatedStudent;
};
export async function main(args: string[]) {
  const [command, selected, argument, flag] = args;
  invariant(
    ['init', 'read', 'trace', 'ingest', 'update', 'reset', 'demo'].includes(command),
    'INVALID_COMMAND',
  );
  if (command === 'demo')
    invariant(selected === '--live' && argument, 'USE_DEMO_LIVE_REPORT_DIRECTORY');
  else if (command === 'update')
    invariant(flag === '--live' && argument, 'USE_UPDATE_STUDENT_OPERATION_LIVE');
  else if (command === 'init')
    invariant(
      selected === undefined || SIMULATED_STUDENTS.includes(selected as SimulatedStudent),
      'USE_INIT_OPTIONAL_STUDENT',
    );
  else if (command === 'reset')
    invariant(
      selected === 'all' || SIMULATED_STUDENTS.includes(selected as SimulatedStudent),
      'USE_RESET_STUDENT_OR_ALL',
    );
  else student(selected);
  const environment = await openSimulatedMemory();
  const memory = environment.memory;
  try {
    if (command === 'init' || command === 'reset') {
      const id = selected && selected !== 'all' ? student(selected) : undefined;
      const result = command === 'init' ? await memory.initialize(id) : await memory.reset(id);
      console.log(
        JSON.stringify({
          command,
          seedVersion: SIMULATED_SEED_VERSION,
          seedSha256: SIMULATED_SEED_SHA256,
          result,
        }),
      );
    } else if (command === 'read' || command === 'trace') {
      const view = await memory.read(student(selected));
      if (command === 'trace') {
        const pieces = argument
          ? view.usable.pieces.filter((p) => p.id === argument)
          : view.usable.pieces;
        invariant(!argument || pieces.length > 0, 'MEMORY_PIECE_NOT_FOUND');
        console.log(
          JSON.stringify(
            {
              scope: view.scope,
              revision: view.usable.revision,
              pieces,
              coverage: view.coverage,
              restricted: view.usable.restricted,
            },
            null,
            2,
          ),
        );
      } else console.log(JSON.stringify(view, null, 2));
    } else if (command === 'ingest') {
      invariant(argument, 'SOURCE_JSON_FILE_REQUIRED');
      const sources = z
        .array(sourceSchema)
        .max(64)
        .parse(JSON.parse(fs.readFileSync(path.resolve(argument), 'utf8')));
      await memory.ingest(student(selected), sources);
      console.log(JSON.stringify({ command, student: selected, sourceCount: sources.length }));
    } else if (command === 'update') {
      const result = await memory.update(student(selected), argument, invokeSimulatedMemoryModel);
      console.log(JSON.stringify(result, null, 2));
      if (!['completed', 'noop'].includes(result.run.state)) process.exitCode = 1;
    } else {
      // A new report directory is append-only. Repeated demo operations reuse the stored run.
      const reportDirectory = path.resolve(argument);
      invariant(!fs.existsSync(reportDirectory), 'REPORT_DIRECTORY_EXISTS');
      fs.mkdirSync(reportDirectory, { recursive: true });
      const write = (name: string, value: unknown) =>
        fs.writeFileSync(path.join(reportDirectory, name), JSON.stringify(value, null, 2) + '\n', {
          flag: 'wx',
        });
      const initialized = await memory.initialize();
      const before = await memory.read('C');
      write('before.json', before);
      write('baseline.json', simulatedSeed('C'));
      const evidence = simulatedSource('C', SIMULATED_DEMO.sourceKey);
      write('evidence.json', evidence);
      await memory.ingest('C', [evidence]);
      let modelInvokerCalls = 0;
      const result = await memory.update('C', SIMULATED_DEMO.operationId, async (run) => {
        modelInvokerCalls++;
        write('request.json', {
          scope: run.scope,
          operationId: run.id,
          prompt: run.prompt,
          aliases: run.aliases,
          budgets: run.budgets,
        });
        const reply = await invokeSimulatedMemoryModel(run);
        write('reply.json', reply);
        return reply;
      });
      write('result.json', result);
      const after = await memory.read('C');
      write('after.json', after);
      const repeated =
        result.run.state === 'completed'
          ? await memory.update('C', 'demo-repeat-check-v1', async () => {
              throw new Error('repeat should not invoke');
            })
          : null;
      const report = {
        command: 'demo',
        databaseSchema: SIMULATED_MEMORY_SCHEMA,
        sourceNature: 'synthetic',
        seedVersion: SIMULATED_SEED_VERSION,
        seedSha256: SIMULATED_SEED_SHA256,
        promptVersion: 'v0.3.1',
        promptSha256: SIMULATED_PROMPT_SHA256,
        initialized,
        modelInvokerCalls,
        state: result.run.state,
        errorCode: result.run.errorCode,
        replyOrigin: result.run.reply?.origin,
        model: result.run.reply?.model,
        usage: result.run.reply?.usage,
        decisions: result.run.decisions,
        readback: canonicalJson(after) === canonicalJson(result.memory) ? 'match' : 'mismatch',
        repeated: repeated
          ? {
              state: repeated.run.state,
              unchanged: canonicalJson(after) === canonicalJson(repeated.memory),
            }
          : null,
      };
      write('report.json', report);
      console.log(JSON.stringify(report));
      if (
        result.run.state !== 'completed' ||
        report.readback !== 'match' ||
        report.repeated?.state !== 'noop'
      )
        process.exitCode = 1;
    }
  } finally {
    await environment.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(
      JSON.stringify({
        state: 'failed',
        code:
          error &&
          typeof error === 'object' &&
          'code' in error &&
          typeof error.code === 'string' &&
          /^[A-Z_0-9]+$/.test(error.code)
            ? error.code
            : 'SIMULATED_MEMORY_COMMAND_FAILED',
        automaticRetry: false,
      }),
    );
    process.exitCode = 1;
  });
