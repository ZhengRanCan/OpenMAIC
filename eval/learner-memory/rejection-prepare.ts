/** Offline preparation only. No provider import, model invocation or PostgreSQL access. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { loadStandardCorpus, prepareStandardInput } from './standard-replay';
import { canonicalJson, digest, invariant } from '@/lib/learner-memory/contracts';
import { SYSTEM } from '@/lib/learner-memory/prompt';
import { LearnerMemoryStore } from '@/lib/persistence/learner-memory-store';
import { ensureMemorySchema } from '@/lib/persistence/learner-memory-schema';

const workspace = path.resolve(process.cwd(), '..');
const base = path.join(workspace, 'docs/log/artifacts/F67');
const root = path.join(base, 'memory-v0.3.1-2026-10-26');
const dir = path.join(root, 'prepared-rejection-three-001');
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

async function main() {
  invariant(path.basename(process.cwd()) === 'OpenMAIC', 'RUN_FROM_OPENMAIC');
  invariant(!fs.existsSync(dir), 'BATCH_EXISTS');
  const priorSystem = fs.readFileSync(
    path.join(base, 'memory-v0.3-2026-10-26/system-prompt.txt'),
    'utf8',
  );
  const system = fs.readFileSync(path.join(root, 'system-prompt.txt'), 'utf8');
  const sentence = 'pieces 每项仅包含 id、text、formation、supports。';
  const anchor = '- **pieces**：只提供新增或改写的片段。';
  invariant(system === priorSystem.replace(anchor, anchor + sentence), 'UNEXPECTED_PROMPT_CHANGE');
  invariant(
    SYSTEM ===
      fs.readFileSync(
        path.join(base, 'memory-v0.2-2026-10-25/prepared-five-002/I08.system-prompt.txt'),
        'utf8',
      ),
    'DEFAULT_SYSTEM_CHANGED',
  );
  const standard = loadStandardCorpus(workspace);
  const negative = loadStandardCorpus(
    workspace,
    'docs/log/artifacts/F67/memory-v0.2-2026-10-25/negative-standard.json',
  );
  const cases = [
    { id: 'N01', corpus: negative },
    { id: 'N02', corpus: negative },
    { id: 'U06', corpus: standard },
  ];
  const db = new PGlite();
  const fixture = {
    db,
    store: new LearnerMemoryStore({
      withTransaction: (body) => db.transaction(body),
      systemPrompt: system,
    }),
    isolatedDatabase: true as const,
  };
  const prepared: unknown[] = [];
  const files: Record<string, string> = {};
  fs.mkdirSync(dir);
  try {
    await ensureMemorySchema(db);
    for (const { id, corpus } of cases) {
      const test = corpus.cases.find((c) => c.id === id)!;
      invariant(test, 'CASE_MISSING');
      const input = { id: test.id, scope: test.scope, input: test.input };
      const run = await prepareStandardInput(fixture, corpus, input, 'rejection-v031-first');
      invariant(
        run.state === 'prepared' && run.batch.length === 1,
        'EXPECTED_ONE_UNPROCESSED_SOURCE',
      );
      invariant(
        run.prompt.system === system && run.prompt.digest === digest([system, run.prompt.user]),
        'PROMPT_CHANGED',
      );
      const saved = await fixture.store.getRun(test.scope, run.id);
      invariant(canonicalJson(saved) === canonicalJson(run), 'PREPARED_READBACK_CHANGED');
      if (id === 'N01') {
        const prior = read(path.join(base, 'memory-v0.3-2026-10-26/live-four-001/N01.json'));
        invariant(prior.run.prompt.user === run.prompt.user, 'SCORE_USER_CHANGED');
      }
      if (id === 'U06') {
        const old = run.snapshot.pieces.find((p) => p.id === 'm-density')!;
        invariant(
          old &&
            old.supports.some(
              (s) =>
                s.id !== run.batch[0].id &&
                canonicalJson(s.refs) === canonicalJson(run.batch[0].refs),
            ),
          'DUPLICATE_ORIGINAL_REF_MISSING',
        );
        invariant(
          Object.entries(run.aliases).some(
            ([alias, s]) => alias.startsWith('s') && s.id === old.supports[0].id,
          ),
          'OLD_SUPPORT_NOT_VISIBLE',
        );
      }
      fs.writeFileSync(
        path.join(dir, id + '.json'),
        JSON.stringify({ caseId: id, input, run }, null, 2) + '\n',
        { flag: 'wx' },
      );
      for (const field of ['system', 'user'] as const)
        fs.writeFileSync(path.join(dir, `${id}.${field}-prompt.txt`), run.prompt[field], {
          flag: 'wx',
        });
      prepared.push({
        caseId: id,
        state: 'not_run',
        preparedState: run.state,
        promptDigest: run.prompt.digest,
        inputBytes: run.prompt.inputBytes,
        sourceCount: run.batch.length,
      });
    }
    for (const file of fs.readdirSync(dir))
      files[file] = sha(fs.readFileSync(path.join(dir, file)));
    const codePaths = [
      'lib/learner-memory/contracts.ts',
      'lib/learner-memory/prompt.ts',
      'lib/learner-memory/output-protocol.ts',
      'lib/learner-memory/transition.ts',
      'lib/learner-memory/read.ts',
      'lib/persistence/learner-memory-store.ts',
      'lib/persistence/learner-memory-schema.ts',
      'eval/learner-memory/standard-replay.ts',
      'eval/learner-memory/rejection-prepare.ts',
    ];
    const manifest = {
      schemaVersion: 'memory-rejection-preparation.v1',
      promptCandidate: 'v0.3.1',
      protocol: 'memory.v2',
      createdAt: new Date().toISOString(),
      systemSha256: sha(system),
      priorSystemSha256: sha(priorSystem),
      onlyPromptChange: sentence,
      cases: prepared,
      files,
      standardHashes: [negative.standardSha256, standard.standardSha256],
      codeFiles: Object.fromEntries(codePaths.map((file) => [file, sha(fs.readFileSync(file))])),
      modelCalls: 0,
      generationEnabled: false,
      configuredModel: null,
      plannedExecution: {
        model: 'deepseek:deepseek-v4-flash',
        maximumCalls: 3,
        maxOutputTokens: 16000,
        timeoutMs: 180000,
        retries: 0,
        fallback: false,
        judge: false,
      },
      databaseLifecycle:
        'temporary in-memory PGlite preparation/readback only; closed after preparation; no PostgreSQL mutation',
      semanticApproved: false,
      classification: 'prepared only; not a model result or live execution approval',
      pendingChecks: [
        'explicit live execution instruction',
        'resolve current model identity/capacity against prior manifest before billing',
        'new isolated PostgreSQL schema',
        'raw output/content review and persistence/repeat checks',
      ],
    };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
      flag: 'wx',
    });
    console.log(
      JSON.stringify({
        state: 'prepared',
        cases: prepared,
        modelCalls: 0,
        generationEnabled: false,
      }),
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      state: 'stopped',
      code:
        error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          ? error.code
          : 'PREPARATION_FAILED',
      modelCalls: 0,
    }),
  );
  process.exitCode = 1;
});
