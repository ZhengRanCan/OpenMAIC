# Simulated learner Memory

This is a persistent local MVP environment, using the existing PostgreSQL Memory tables and update protocol. It is separate from the 27-case evaluation corpus. All three identities and all sources are authored synthetic data, not real learners or a reconstructed learning history.

Set `MEMORY_DATABASE_URL` locally to the dedicated development PostgreSQL connection (the verified instance uses loopback port 55467). It never falls back to the application's `DATABASE_URL`. Run commands from `OpenMAIC/`:

```powershell
corepack pnpm exec tsx eval/learner-memory/simulated.ts init
corepack pnpm exec tsx eval/learner-memory/simulated.ts read B
corepack pnpm exec tsx eval/learner-memory/simulated.ts trace B m-density
corepack pnpm exec tsx eval/learner-memory/simulated.ts reset C
```

`init` creates missing identities and retains existing states, including updates. `reset C` explicitly restores C's exact baseline, source versions and processed state, removing C's simulation run receipts and increments; A/B and other environments are untouched. `reset all` restores only A/B/C. Prepared, calling or captured operations block reset; callers must finish or explicitly abandon the operation before resetting. Never reset to recover an unknown model invocation and then treat it as an automatic retry.

| Identity | Initial Memory |
| --- | --- |
| A | Four empty sections |
| B | Grade, goal, persistent teaching requirement, past-tense choices/rewrite, density calculation/conversion |
| C | Grade, goal, persistent teaching requirement and past-tense choice experience; ready for new rewrite evidence |

The schema is `f67_simulated_memory`, namespace `f67-test:simulated-memory-v1`, learner keys `sim-a`, `sim-b`, `sim-c`. Initialization/reset use one transaction and the same state row locks as Memory maintenance. Seed IDs and snapshots are stable. The version and file SHA identify the exact seed definition; do not silently edit a baseline for a comparative experiment.

## Server-side consumer

```ts
import { openSimulatedMemory } from '@/lib/server/simulated-memory';

const environment = await openSimulatedMemory();
try {
  const memory = await environment.memory.read('B');
  // These are actual database pieces from the trusted read projection.
  const learnerContext = {
    background: memory.sections.background.map((p) => p.text),
    goals: memory.sections.goals.map((p) => p.text),
    teachingRequirements: memory.sections.teaching_requirements.map((p) => p.text),
    learningExperiences: memory.sections.learning_experiences.map((p) => p.text),
  };
  // Pass learnerContext to the later module's own task-dependent context selection.
} finally {
  await environment.close();
}
```

`environment.memory.read` delegates to the shared `readMemory(store, scope)` in `lib/server/learner-memory.ts`, which uses `LearnerMemoryStore.read`. The returned `sections` contains usable pieces, with IDs, text, formation, supports and conditions. Restricted pieces are excluded. `usable.restricted`, `maintenancePending` and `coverage` retain maintenance status; `snapshot` is an audit view and must not be used to bypass restrictions.

This is a server-side TypeScript interface, not a new public HTTP endpoint. Real identity authorization and actual F65/F66 selection/teaching wiring remain separate work. Consumers use the server read interface, not seed JSON or evaluation snapshots. Reading before initialization reports `SIMULATED_MEMORY_NOT_INITIALIZED`.

## Incremental update and demo

```ts
import { simulatedSource } from '@/lib/learner-memory/simulated-seeds';
import { invokeSimulatedMemoryModel } from '@/lib/server/simulated-memory';

await environment.memory.ingest('C', [simulatedSource('C', 'past-rewrite')]);
const updated = await environment.memory.update(
  'C', 'lesson-rewrite-001', invokeSimulatedMemoryModel,
);
```

`simulatedSource` only constructs the small built-in authored samples. A future Evidence producer can supply a `MemorySource` built with `versionSource`, using `synthetic`/`proxy` provenance and an ID prefixed `sim:<student>:`. The adapter rejects another simulated student's prefix. For external authored JSON arrays:

```powershell
corepack pnpm exec tsx eval/learner-memory/simulated.ts ingest C ./my-evidence.json
corepack pnpm exec tsx eval/learner-memory/simulated.ts update C lesson-rewrite-001 --live
corepack pnpm exec tsx eval/learner-memory/simulated.ts read C
```

`update` reuses prepare/claim/updateMemory/capture/commit. The model uses the exact frozen v0.3.1 System and memory.v2 protocol, with 16000 output tokens, 180 seconds and no retry/fallback. Failed replies leave valid Memory and pending increments intact. Use a new operation ID for new batches; the same ID reuses its recorded operation. A later new ID with no pending data returns noop without invoking the model.

One end-to-end demo command (creates missing students, then operates only on C):

```powershell
corepack pnpm exec tsx eval/learner-memory/simulated.ts demo --live ../docs/log/artifacts/F67/my-memory-demo-001
```

Use a fresh report directory. The first call can incur one Flash invocation. Repeating before resetting C reuses `demo-past-rewrite-v1` and incurs zero new model calls; `usage` in that repeated report belongs to the stored reply, not a second bill. After an explicit reset, another demo starts a fresh simulation and can call the model again. The report preserves before/after reads, Evidence, request, response, adopted meaning and duplicate noop. Initialization/reset never call a model.

The real 2026-10-26 demonstration made one invocation (2784 tokens), verified a repeated demo with zero invocations, checked that `init` preserved the update, and then explicitly reset C. The environment was left at stable A/B/C initial states. Tests using a scripted invoker are labeled plumbing fixtures; they are not model semantic scores. Memory Judge, broad semantic acceptance and Mastery are deferred.
