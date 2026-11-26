import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { configSchema, safeError } from './contracts';
import { validateInputs, runExperiment, hasIncompleteResults } from './engine';
import { createInvoker, ModelSession } from './model';
import { digest } from '@/lib/learner-memory/contracts';
import { summarize, reviewRows, reviewSummary } from './report';
import { importLongTutor } from './longtutor';
import { readRecords, output, createOutput, sourceFiles } from './io';

async function main() {
  const { values: args, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      events: { type: 'string' },
      questions: { type: 'string' },
      config: { type: 'string' },
      output: { type: 'string' },
      sequences: { type: 'string' },
      bank: { type: 'string' },
      gold: { type: 'string' },
      limit: { type: 'string' },
      review: { type: 'string' },
    },
  });
  const command = positionals[0] ?? 'help';
  if (command === 'help') {
    console.log(
      'eval:learner-profile validate|run --events FILE --questions FILE --config FILE [--output NEW_DIR]\nimport-longtutor --sequences FILE --bank FILE --gold FILE --output NEW_DIR [--limit 2]\nreview-report --review FILE',
    );
    return;
  }
  if (command === 'review-report') {
    if (!args.review) throw new Error('REVIEW_REQUIRED');
    console.log(JSON.stringify(reviewSummary(readRecords(args.review))));
    return;
  }
  if (command === 'import-longtutor') {
    if (!args.sequences || !args.bank || !args.gold || !args.output)
      throw new Error('IMPORT_ARGUMENTS_REQUIRED');
    const limit = Number(args.limit ?? 2);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new Error('IMPORT_LIMIT_INVALID');
    const result = await importLongTutor(args.sequences, args.bank, args.gold, limit);
    const target = createOutput(args.output, [args.sequences, args.bank, args.gold]);
    output(resolve(target, 'events.json'), result.events);
    output(resolve(target, 'questions.json'), result.questions);
    output(resolve(target, 'import.json'), result.manifest);
    console.log(JSON.stringify(result.manifest));
    return;
  }
  if (!['validate', 'run'].includes(command)) throw new Error('COMMAND_INVALID');
  if (!args.events || !args.questions || !args.config) throw new Error('INPUT_ARGUMENTS_REQUIRED');
  const config = configSchema.parse(readRecords(args.config));
  const data = validateInputs(readRecords(args.events), readRecords(args.questions));
  if (
    config.mode === 'live' &&
    data.events.some((e) => e.origin === 'public') &&
    !config.allowPublicExternal
  )
    throw new Error('PUBLIC_EXTERNAL_PROCESSING_NOT_AUTHORIZED');
  if (command === 'validate') {
    console.log(
      JSON.stringify({
        valid: true,
        events: data.events.length,
        questions: data.questions.length,
        duplicates: data.duplicates,
        mode: config.mode,
      }),
    );
    return;
  }
  if (!args.output) throw new Error('OUTPUT_REQUIRED');
  const invoke = await createInvoker(config);
  const target = createOutput(args.output, [args.events, args.questions, args.config]);
  const callsPath = resolve(target, 'calls.jsonl');
  const session = new ModelSession(config, invoke, (record) =>
    appendFileSync(callsPath, JSON.stringify(record) + '\n'),
  );
  const manifest = {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    code: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '',
    sourceFiles: sourceFiles(),
    eventsDigest: digest(data.events),
    questionsDigest: digest(data.questions),
    config,
    configDigest: digest(config),
    duplicates: data.duplicates,
    scoring: config.mode === 'fixture' ? 'fixture-exact-v1' : 'local-semantic-v1',
    fixtureOnly: config.mode === 'fixture',
    oldSources:
      'currently supported raw sources, 512 characters each, production capacity fallback',
    projection:
      'Native answer-bearing events use classroomMemorySources; public outcome-only events use explicit unavailable-answer projection',
  };
  output(resolve(target, 'manifest.json'), manifest);
  try {
    const result = await runExperiment(
      data.events,
      data.questions,
      config,
      session,
      (learner, method, step) => {
        appendFileSync(
          resolve(target, 'steps.jsonl'),
          JSON.stringify({ learnerId: learner, method, ...step }) + '\n',
        );
      },
    );
    output(resolve(target, 'results.json'), result);
    const report = summarize(result.results, data.questions, session.calls);
    output(resolve(target, 'report.json'), report);
    output(resolve(target, 'review.json'), reviewRows(result.results, data.events));
    const incomplete = hasIncompleteResults(result.results);
    output(resolve(target, incomplete ? 'failed.json' : 'completed.json'), {
      finishedAt: new Date().toISOString(),
      calls: session.calls.length,
      complete: !incomplete,
      ...(incomplete ? { error: 'OUTCOME_INCOMPLETE' } : {}),
    });
    console.log(JSON.stringify({ output: target, ...report }));
    if (incomplete) process.exitCode = 1;
  } catch (error) {
    output(resolve(target, 'failed.json'), {
      error: safeError(error),
      calls: session.calls.length,
    });
    throw error;
  }
}
main().catch((error) => {
  console.error(safeError(error));
  process.exitCode = 1;
});
