# F60 verification

## Status

- feature: `F60-preclass-fusion-remove-checkpoint-remediation`
- status: `blocked`
- implementation: not started
- product decision: use scheme A — remove the automatic pair from the new pre-class path, retain/isolate reusable code for historical compatibility and future in-class Fusion

## Target verification matrix

| Boundary | Required result | Status |
|---|---|---|
| New formal outline route | no automatic checkpoint/remediation pair | pending |
| Frozen context | request, validation, freeze, recovery remain unchanged | pending |
| Ordinary scene persistence | ordinary supported scene fields survive | pending |
| Historical sessions | existing pair remains readable or explicit compatibility status | pending |
| In-class handoff | checkpoint/diagnosis/remediation responsibility remains in-class | pending |
| Browser boundary | browser cannot reintroduce pair or override context | pending |
| Architecture | SSOT and generated split agree | pending |
| Regression | focused tests, typecheck, harness checks | pending |

## Required tests/evidence

Planned commands and evidence will be filled after implementation:

```text
OpenMAIC focused Fusion tests
OpenMAIC TypeScript check
node scripts/architecture-split.mjs check
node scripts/harness-gate.mjs
```

Required negative cases:

- formal pre-class resolution does not create `fusion-checkpoint-scene-*`;
- formal pre-class resolution does not create `fusion-remediation-scene-*`;
- a browser payload cannot force either scene into the new formal outline;
- missing pair is not classified as `DEEPTUTOR_CONTEXT_NOT_FROZEN` or another provider failure;
- historical pair recovery does not mutate IDs or mapping metadata;
- ordinary non-Fusion generation remains unchanged.

## Compatibility evidence

The implementation must document the exact treatment of existing sessions containing the old pair. A passing result must distinguish:

```text
new pre-class sessions: no automatic pair
historical sessions: read-only/original compatibility
in-class runtime: checkpoint and remediation remain supported
```

## Current blocker

2026-10-06: the user froze the cross-application Fusion product route and selected an OpenMAIC-native direction. F60 is blocked by that product decision; no implementation, verification, or passing result has been claimed. Original pending checks remain pending. See `freeze.md` for the preservation and recovery points.
