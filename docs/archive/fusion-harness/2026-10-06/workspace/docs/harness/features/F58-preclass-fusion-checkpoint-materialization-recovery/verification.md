# F58 verification

## Verification status

- status: `blocked`
- feature: `F58-preclass-fusion-checkpoint-materialization-recovery`
- latestStaticVerification: `classroom/review/F58/20260919-f58-static-verification/`
- automatedTests: `23 passed`
- typecheck: `passed`
- manualFormalExport: `not run`
- independentReview: `fail` (previous review identified gaps; fixes applied, re-review pending)
- scope: pre-class Fusion checkpoint/remediation planning, materialization, persistence, recovery and export traceability

## Harness registry metadata

```yaml
scope:
  repository: OpenMAIC
  branch: fusion-adapter
  paths:
    - app/api/generate/scene-outlines-stream/route.ts
    - app/api/generate/scene-content/route.ts
    - app/api/generate/scene-actions/route.ts
    - app/generation-preview/page.tsx
    - lib/hooks/use-scene-generator.ts
    - lib/fusion/generation-session.ts
    - lib/fusion/scene-catalog.ts
    - lib/generation/scene-builder.ts
    - lib/export/use-export-classroom.ts
    - app/classroom/[id]/page.tsx
    - tests

evidence:
  directory: classroom/review/F58
  required:
    - focused automated tests
    - fresh formal Fusion manual capture
    - export manifest audit
    - first-failure boundary report

completionGate:
  knownUnverified: true
  humanReviewRequired: true
  gitEvidence:
    repositories:
      - path: OpenMAIC
        branch: fusion-adapter
        commit: pending
```

## Harness registry metadata

```yaml
scope:
  repository: OpenMAIC
  branch: fusion-adapter
  paths:
    - app/api/generate/scene-outlines-stream/route.ts
    - app/api/generate/scene-content/route.ts
    - app/api/generate/scene-actions/route.ts
    - app/generation-preview/page.tsx
    - lib/hooks/use-scene-generator.ts
    - lib/fusion/generation-session.ts
    - lib/fusion/scene-catalog.ts
    - lib/generation/scene-builder.ts
    - lib/export/use-export-classroom.ts
    - app/classroom/[id]/page.tsx
    - tests

evidence:
  directory: classroom/review/F58
  required:
    - focused automated tests
    - fresh formal Fusion manual capture
    - export manifest audit
    - first-failure boundary report

completionGate:
  knownUnverified: true
  humanReviewRequired: true
  gitEvidence:
    repositories:
      - path: OpenMAIC
        branch: fusion-adapter
        commit: pending
```

## Why F58 exists

F54 fresh export review of:

```text
classroom/Linear Functions and Graphs.maic/manifest.json
```

found 8 scenes but no formal Fusion checkpoint/remediation pair. One ordinary quiz was titled `Checkpoint: Slope and Intercepts`, but the export contained none of the server-owned binding fields:

```text
checkpointId
mappingId
mappingRevision
lessonKnowledgePointIds
remediationStrategy
```

The export proves final artifact loss, but does not identify the first upstream boundary. F58 is the investigation and repair feature for that complete chain.

## Current architecture hypothesis

```text
Launch / LessonBinding
  → resolveFormalFusion
  → FrozenLessonGenerationContext
  → server-owned pair planning
  → generatedOutlines + sceneCatalog + runtimeState
  → SSE outline events + done.outlines
  → browser session/store
  → scene-content / scene-actions
  → classroom store/materialization
  → session recovery
  → export manifest
```

The server must own pair identity and metadata. The browser may carry content and materialization evidence only.

## Investigation matrix

| Boundary | Required evidence | Status |
|---|---|---|
| Launch/session binding | redacted session association is created and reused | pending |
| Formal resolution | `resolved` for the fresh session | pending |
| Server pair planning | unique checkpoint/remediation IDs and metadata | pending |
| Session persistence | `generatedOutlines`, `sceneCatalog`, `runtimeState` contain pair | pending |
| SSE | outline events and `done.outlines` contain same pair | pending |
| Browser session/store | pair IDs/count survive done handling and store updates | pending |
| Scene content/actions | checkpoint quiz and remediation slide both materialize | pending |
| Classroom store | both scenes plus roles/metadata are present | pending |
| Session recovery | pair and binding survive reload/reopen | pending |
| Export input | pair exists before export projection | pending |
| Export manifest | pair and safe traceability are retained | pending |
| Ordinary/LAN/history control | no formal pair is added | pending |

## Evidence policy

Record only minimal diagnostic facts:

- redacted lesson/session identifiers;
- scene IDs, roles, types and counts;
- resolution status and HTTP status/error category;
- presence booleans for server-owned metadata;
- materialization and export status.

Do not record tokens, cookies, Launch Codes, complete learner profiles, raw DeepTutor responses, private prompts, model traces or unreviewed classroom exports.

Evidence belongs under:

```text
classroom/review/F58/<test-batch>/
```

## Verification plan

### 1. Static code review

Trace and document the actual implementation in:

- `OpenMAIC/lib/fusion/generation-session.ts`;
- `OpenMAIC/lib/fusion/scene-catalog.ts`;
- `OpenMAIC/app/api/generate/scene-outlines-stream/route.ts`;
- `OpenMAIC/app/generation-preview/page.tsx`;
- `OpenMAIC/lib/hooks/use-scene-generator.ts`;
- `OpenMAIC/app/api/generate/scene-content/route.ts`;
- `OpenMAIC/app/api/generate/scene-actions/route.ts`;
- `OpenMAIC/lib/export/use-export-classroom.ts`;
- `OpenMAIC/app/classroom/[id]/page.tsx`;
- relevant session/store/materialization types and tests.

Identify the first boundary where a pair can disappear, be replaced by an ordinary scene, or lose its binding.

### 2. Automated verification

Required focused tests:

```text
formal resolved → canonical pair planning
canonical pair → generatedOutlines/sceneCatalog/runtime persistence
canonical pair → SSE outline events and done.outlines
SSE/browser store preservation
checkpoint/remediation content materialization
session recovery
export manifest traceability
fail-closed incomplete pair
ordinary/LAN/history non-regression
F56/F57 regression suites
```

Commands will be recorded after implementation. At minimum:

```powershell
cd OpenMAIC
pnpm exec vitest run <focused F58 tests>
pnpm exec tsc --noEmit
cd ..
node scripts/harness-gate.mjs
```

### 3. Fresh manual path

Use a new formal Fusion session with:

```text
Linear functions and graphs
```

Capture only redacted summaries at these boundaries:

1. formal resolution;
2. server final outline pair;
3. SSE `outline` events and `done.outlines`;
4. browser outline/session/store;
5. scene-content/actions for each pair member;
6. final classroom scene IDs and roles;
7. reopen/recovery state;
8. export input and manifest.

Expected canonical pair:

```text
fusion-checkpoint-scene-<contextId>
fusion-remediation-scene-<contextId>
```

Expected content shapes:

```text
checkpoint: quiz-shaped
remediation: slide-shaped
```

### 4. Failure classification

The verification report must name the first failing boundary using one of:

```text
FORMAL_SESSION_NOT_RESOLVED
PAIR_PLAN_MISSING
PAIR_PERSISTENCE_FAILED
PAIR_SSE_TRANSFER_FAILED
PAIR_BROWSER_STATE_LOST
PAIR_CONTENT_MATERIALIZATION_FAILED
PAIR_ACTION_BUILD_FAILED
PAIR_CLASSROOM_STORE_LOST
PAIR_RECOVERY_FAILED
PAIR_EXPORT_PROJECTION_FAILED
PAIR_METADATA_MISMATCH
```

No failure may be reported only as “checkpoint missing”.

## Passing gate

F58 may become `passing` only when:

- all feature acceptance criteria pass;
- the first missing boundary is fixed and regression-tested;
- fresh formal manual evidence confirms both pair members reach export;
- ordinary/LAN/history controls remain unchanged;
- no sensitive data is stored in evidence;
- independent read-only review returns `pass`;
- `knownUnverified` and `humanReviewRequired` are empty;
- OpenMAIC `fusion-adapter` commit is pushed and worktree is clean;
- F54 verification is updated from the F58 evidence before F54 is reconsidered.

Until then:

```text
F54 = blocked
F58 = active
```

## Related evidence

- Previous failed export review: `classroom/review/F54/20260919-linear-functions-export/`;
- F54 contract: `docs/harness/features/F54-formal-fusion-checkpoint-materialization/`;
- F56 reconciliation: `docs/harness/features/F56-fusion-outline-reconciliation/`;
- F57 field preservation: `docs/harness/features/F57-outline-field-preservation/`.
