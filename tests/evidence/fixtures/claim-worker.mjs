import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import pg from 'pg';

try {
  const root = createRequire(path.resolve('eval/learner-memory/quiz-short-facts.mjs'));
  const vitest = createRequire(root.resolve('vitest/package.json'));
  const { createServer } = await import(pathToFileURL(vitest.resolve('vite')).href);
  const vite = await createServer({
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true },
    resolve: { alias: { '@': process.cwd() } },
  });
  const pool = new pg.Pool({
    connectionString: process.env.F68_TEST_DATABASE_URL,
    options: `-c search_path=${process.env.F69_TEST_SCHEMA}`,
  });
  try {
    const store = await vite.ssrLoadModule('/lib/server/quiz-learning-loop/store.ts');
    if (process.env.F69_WORKER_MODE === 'bootstrap') {
      const lock = await vite.ssrLoadModule('/lib/persistence/schema-bootstrap-lock.ts');
      const facts = await vite.ssrLoadModule('/lib/server/quiz-short-facts.ts');
      await lock.withSchemaBootstrapLock(pool, async (tx) => {
        await store.ensureLearningLoopSchema(tx);
        await facts.ensureShortFactsSchema(tx);
      });
      process.stdout.write(JSON.stringify({ initialized: true }));
    } else {
      const job = await store.claimLearningLoop(pool, process.env.F69_WORKER_ID);
      process.stdout.write(JSON.stringify({ claimed: !!job }));
    }
  } finally {
    await pool.end();
    await vite.close();
  }
} catch {
  process.stderr.write('CLAIM_WORKER_FAILED');
  process.exitCode = 1;
}
