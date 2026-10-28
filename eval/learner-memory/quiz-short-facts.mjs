import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const rootRequire = createRequire(import.meta.url);
const vitestRequire = createRequire(rootRequire.resolve('vitest/package.json'));
const { createServer } = await import(pathToFileURL(vitestRequire.resolve('vite')).href);

const vite = await createServer({
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true },
  resolve: { alias: { '@': resolve('.') } },
});
try {
  const args = process.argv.slice(2);
  const modulePath =
    args[0] === 'memory'
      ? '/eval/learner-memory/simulated.ts'
      : '/eval/learner-memory/quiz-short-facts.ts';
  const { main } = await vite.ssrLoadModule(modulePath);
  await main(args[0] === 'memory' ? args.slice(1) : args);
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  console.error(/^[A-Z_0-9]+$/.test(message) ? message : 'F68_COMMAND_FAILED');
  process.exitCode = 1;
} finally {
  await vite.close();
}
