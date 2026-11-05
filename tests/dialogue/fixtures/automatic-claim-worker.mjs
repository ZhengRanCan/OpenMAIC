import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import pg from 'pg';
try {
  const schema = process.env.F75_TEST_SCHEMA;
  if (
    !/^f73_test_[a-f0-9]+$/.test(schema ?? '') ||
    !process.env.PG_CONTRACT_URL?.endsWith('/f75_contract')
  )
    throw Error('isolated configuration required');
  const require = createRequire(path.resolve('package.json'));
  const vitest = createRequire(require.resolve('vitest/package.json'));
  const { createServer } = await import(pathToFileURL(vitest.resolve('vite')).href);
  const vite = await createServer({
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true },
    resolve: { alias: { '@': process.cwd() } },
  });
  const pool = new pg.Pool({
    connectionString: process.env.PG_CONTRACT_URL,
    options: '-c search_path=' + schema,
  });
  try {
    const { DialogueLoopStore } = await vite.ssrLoadModule(
      '/lib/server/dialogue-learning-loop/store.ts',
    );
    const { nodePostgresTransaction } = await vite.ssrLoadModule(
      '/packages/@openmaic/storage/src/server/reference.ts',
    );
    const provider = {
      withTransaction: nodePostgresTransaction(pool),
    };
    const job = await new DialogueLoopStore(provider).claim();
    if (job && process.env.F75_WORKER_CAPTURE === '1') {
      const { DialogueEvidenceStore } = await vite.ssrLoadModule(
        '/lib/persistence/dialogue-evidence-store.ts',
      );
      const { model, reply } = await vite.ssrLoadModule(
        '/tests/persistence/dialogue-evidence-fixture.ts',
      );
      const store = new DialogueEvidenceStore(provider),
        settings = { memoryEnvironmentId: job.binding.memoryEnvironmentId, bindings: [] };
      const run = await store.prepareSnapshot(
        job.ownerId,
        { operationId: 'f75:e:' + job.id, stageId: job.stageId, chatSessionId: job.chatSessionId },
        job.snapshot,
        settings,
        model,
      );
      const claim = await store.claim(job.ownerId, run.id, settings);
      await store.capture(job.ownerId, claim, reply, settings);
      // Deliberately exit without finalizing or saving the stage ID/checkpoint.
    }
    process.stdout.write(JSON.stringify({ claimed: !!job, id: job?.id ?? null }));
  } finally {
    await pool.end();
    await vite.close();
  }
} catch (error) {
  process.stderr.write(
    'F75_CLAIM_WORKER_FAILED: ' + String(error?.code ?? error?.message ?? 'unknown').slice(0, 300),
  );
  process.exitCode = 1;
}
