# F67 Memory experiment

For the persistent downstream MVP environment (A/B/C, idempotent init, server read, live update and reset), see [SIMULATED_MEMORY.md](../../lib/learner-memory/SIMULATED_MEMORY.md). Entry: `corepack pnpm exec tsx eval/learner-memory/simulated.ts init`. This environment is separate from the evaluation batches below and uses the same PostgreSQL Memory tables.

The v0.3 System candidate comparison is isolated in `candidate-live.ts` (fixed U02/U03/U11/N01, one call each). It injects an explicit System into the experimental store; the default v0.2 System and memory.v2 output schema are unchanged. Artifacts: `../docs/log/artifacts/F67/memory-v0.3-2026-10-26/`. The batch has already run: three completed, U11 failed on extra `conditions` output. Do not rerun its paid commands. `candidate-diagnostic.ts` only diagnoses the saved U11 reply in a temporary in-memory copy; it never adopts that copy.

Run from `OpenMAIC/`, using the existing dependencies. This is an explicit experimental entry, without a public API or production classroom wiring. `f67-test:<batch>` and each case ID isolate synthetic/proxy material. Mastery is deferred.

```powershell
corepack pnpm exec tsx eval/learner-memory/runner.ts prepare manual-001 manual
corepack pnpm exec tsx eval/learner-memory/runner.ts prepare real-001 real
```

Preparation is offline. It writes requests, source/code hashes and manifests to `../docs/log/artifacts/F67/memory-v0.1-2026-10-25/<batch>/`. Existing batches are never overwritten. Manual mode reads only the 12 positive examples (18 facts); real mode uses the 13 frozen unreviewed facts. Rubrics and proposed Memory answers do not enter generation.

For persistence, explicitly configure `MEMORY_DATABASE_URL` (or the existing `PG_CONTRACT_URL`) through the local environment. The CLI creates only the `f67_memory_experiment` schema and experiment tables. It does not load `.env.local` or reuse `DATABASE_URL` automatically. Never put connection strings or keys in reports.

`import` accepts a manually authored response for mechanism testing. It is labelled `manual-fixture`, never reported as an LLM output:

```powershell
corepack pnpm exec tsx eval/learner-memory/runner.ts import manual-001 N04 <response.json>
corepack pnpm exec tsx eval/learner-memory/runner.ts read manual-001 N04
corepack pnpm exec tsx eval/learner-memory/runner.ts repeat manual-001 N04
corepack pnpm exec tsx eval/learner-memory/runner.ts report manual-001
```

For a real run, `configure <batch>` resolves the current server `quiz-evidence` model slot and saves its non-secret identity/capacity. It does not invoke generation. Review this file and the prepared requests before approving a batch. The generation call uses the same existing resolver/wrapper with retries and fallback disabled; no model is hardcoded.

```powershell
corepack pnpm exec tsx eval/learner-memory/runner.ts configure manual-001
# Only after explicit approval of this batch:
corepack pnpm exec tsx eval/learner-memory/runner.ts run manual-001 N04 --approved
corepack pnpm exec tsx eval/learner-memory/runner.ts run manual-001 N02 --approved
```

Inspect both initial results before proceeding to the other ten. A completed technical result does not constitute semantic/user approval. Do not reuse a manually imported scope to measure real generation; prepare a new batch. One case can invoke at most once, with a durable DB claim and exclusive attempt file. Partial/invalid replies and errors retain pending sources. A calling state without captured output is an unknown invocation; no automatic retry is allowed. After storage failure, `resume <batch> <case>` reuses a captured response and does not call the model. A changed code/source/Prompt requires a fresh batch for new paid generation.

`read` uses the database's current state; `report` shows saved execution snapshots. `cleanup <batch> <case>` deletes that explicit test scope and its source/run records, leaving other scopes untouched. Files remain as experiment artifacts; deleting a batch artifact directory requires a separate explicit action.

The reusable store API supports versioned `ingest`, `prepare`, `restrictSource`, `abandon`, `capture`, `commit`, and `read`. Source changes are explicit. Known invalid support is immediately excluded from the usable JSON/Markdown view even if later generation fails. No automatic file watcher, personal learner binding, source deletion subscription or classroom trigger is claimed.

Default text budgets (Unicode code points): background 300, goals 300, teaching requirements 400, experiences 1000, total 2000. Requests also have a 48000 UTF-8-byte ceiling, at most 16 increments and a conservative known context-capacity check including 16000 output tokens plus 1024 wrapper reserve. A capacity failure leaves work pending; the program never truncates content.

The current model protocol is `memory.v2`. Model pieces contain `id`, `text`, `formation`, and `supports`; conditions belong to the program, which binds complete source snapshots and their original conditions. `memory.v1` replies are not reinterpreted under v2. Historical `read` and saved reports remain available without rebuilding their old prompts.

For the 24 authored Memory standards and three supplemental negative cases:

```powershell
corepack pnpm exec tsx eval/learner-memory/standard-cli.ts replay <fresh-batch-name>
corepack pnpm exec tsx eval/learner-memory/standard-cli.ts prepare <fresh-batch-name>
```

`replay` converts reference snapshots into deterministic **manual** patches and verifies actual persistence, source bindings, repeat noop and withdrawal failure behavior. It is a mechanism test, not a model semantic score. `prepare` writes the actual input-only requests for I08/I06/U02/U03/U11, without reference Memory or rubrics. It does not configure or authorize a paid run. Both commands use an isolated temporary PGlite database, or a random temporary PostgreSQL schema when `PG_CONTRACT_URL` is supplied; that database/schema is closed and removed after the command. Artifacts are written once under `memory-v0.2-2026-10-25/<batch>` and remain available for review. No provider is imported by this CLI.

```powershell
corepack pnpm exec vitest run tests/learner-memory tests/persistence/learner-memory-store.test.ts tests/persistence/learner-memory-store.pg.test.ts
```

The `.pg.test.ts` suite needs `PG_CONTRACT_URL`; otherwise it is explicitly skipped. PGlite is a hermetic test fixture, not an application storage fallback.
