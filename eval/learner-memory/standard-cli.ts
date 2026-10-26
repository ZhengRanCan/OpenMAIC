/** Offline/reference preparation only. This entry never imports a provider or calls a model. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import type { Queryable, WithTransaction } from '@openmaic/storage/document/pg';
import type { ConnectableQueryable } from '@openmaic/storage/server/reference';
import {
  loadStandardCorpus,
  prepareStandardInput,
  replayStandardReference,
} from './standard-replay';
import { invariant } from '@/lib/learner-memory/contracts';
import { LearnerMemoryStore } from '@/lib/persistence/learner-memory-store';
import { ensureMemorySchema } from '@/lib/persistence/learner-memory-schema';

const workspace = path.resolve(process.cwd(), '..');
const artifactRoot = path.join(workspace, 'docs/log/artifacts/F67/memory-v0.2-2026-10-25');
const negativeFile = 'docs/log/artifacts/F67/memory-v0.2-2026-10-25/negative-standard.json';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

async function isolatedDatabase() {
  const url = process.env.PG_CONTRACT_URL;
  let db: Queryable, withTransaction: WithTransaction, close: () => Promise<void>;
  if (url) {
    const { nodePostgresTransaction } = await import('@openmaic/storage/server/reference');
    const schema = 'f67_replay_' + randomUUID().replaceAll('-', '');
    invariant(/^f67_replay_[a-f0-9]{32}$/.test(schema), 'ISOLATED_SCHEMA_REQUIRED');
    const admin = new Pool({ connectionString: url });
    await admin.query('CREATE SCHEMA ' + schema);
    const pool = new Pool({ connectionString: url, options: '-c search_path=' + schema, max: 4 });
    db = pool;
    withTransaction = nodePostgresTransaction(pool as unknown as ConnectableQueryable);
    close = async () => {
      await pool.end();
      try {
        await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
      } finally {
        await admin.end();
      }
    };
  } else {
    const local = new PGlite();
    db = local;
    withTransaction = (body) => local.transaction((tx) => body(tx));
    close = () => local.close();
  }
  try {
    await ensureMemorySchema(db);
  } catch (error) {
    await close();
    throw error;
  }
  return {
    db,
    store: new LearnerMemoryStore({ withTransaction }),
    isolatedDatabase: true as const,
    engine: url ? 'postgresql' : 'pglite',
    close,
  };
}

async function main() {
  const [command, batch] = process.argv.slice(2);
  invariant(command === 'prepare' || command === 'replay', 'USE_PREPARE_OR_REPLAY');
  invariant(batch && /^[\w-]{1,80}$/.test(batch), 'INVALID_BATCH');
  const directory = path.join(artifactRoot, batch);
  invariant(!fs.existsSync(directory), 'BATCH_ALREADY_EXISTS');
  fs.mkdirSync(directory);
  const write = (name: string, value: unknown) =>
    fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', {
      flag: 'wx',
    });
  const corpora = [loadStandardCorpus(workspace), loadStandardCorpus(workspace, negativeFile)];
  const fixture = await isolatedDatabase();
  const preparedCases = ['I08', 'I06', 'U02', 'U03', 'U11'];
  const results: unknown[] = [];
  const files: Record<string, string> = {};
  try {
    for (const corpus of corpora)
      for (const test of corpus.cases) {
        if (command === 'prepare' && !preparedCases.includes(test.id)) continue;
        const result =
          command === 'replay'
            ? await replayStandardReference(fixture, corpus, test)
            : {
                caseId: test.id,
                input: { id: test.id, scope: test.scope, input: test.input },
                run: await prepareStandardInput(fixture, corpus, {
                  id: test.id,
                  scope: test.scope,
                  input: test.input,
                }),
              };
        write(test.id + '.json', result);
        const prompt = 'prompt' in result ? result.prompt : result.run.prompt;
        for (const field of ['system', 'user'] as const)
          fs.writeFileSync(path.join(directory, `${test.id}.${field}-prompt.txt`), prompt[field], {
            flag: 'wx',
          });
        results.push({ caseId: test.id, digest: prompt.digest, inputBytes: prompt.inputBytes });
      }
    for (const name of fs.readdirSync(directory))
      files[name] = sha(fs.readFileSync(path.join(directory, name)));
    const codePaths = [
      'lib/learner-memory/contracts.ts',
      'lib/learner-memory/prompt.ts',
      'lib/learner-memory/output-protocol.ts',
      'lib/learner-memory/transition.ts',
      'lib/persistence/learner-memory-store.ts',
      'eval/learner-memory/standard-replay.ts',
      'eval/learner-memory/standard-cli.ts',
    ];
    write('manifest.json', {
      command,
      engine: fixture.engine,
      createdAt: new Date().toISOString(),
      modelCalls: 0,
      model: null,
      semanticApproved: false,
      classification:
        command === 'prepare'
          ? 'input-only preparation; not a configured/approved paid batch'
          : 'authored reference mechanical replay; not LLM semantic evaluation',
      cases: results,
      standardHashes: corpora.map((corpus) => corpus.standardSha256),
      codeFiles: Object.fromEntries(
        codePaths.map((name) => [name, sha(fs.readFileSync(path.resolve(name)))]),
      ),
      files,
      databaseLifecycle: 'dedicated temporary schema/database; closed and removed after run',
    });
    console.log(
      JSON.stringify({ command, cases: results.length, engine: fixture.engine, modelCalls: 0 }),
    );
  } finally {
    await fixture.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(() => {
    console.error('Standard CLI stopped; no model call was made. Inspect the incomplete batch.');
    process.exitCode = 1;
  });
