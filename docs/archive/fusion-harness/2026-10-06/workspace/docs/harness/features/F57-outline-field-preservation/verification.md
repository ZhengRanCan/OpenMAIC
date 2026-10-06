# F57 verification

## Verification status

- status: `passing`
- feature: `F57-outline-field-preservation`

## Root cause

`storedOutline()` reconstructed formal session outlines using only `id/type/title/description/keyPoints/order` and quiz/checkpoint fields. The stream and `done` payloads still contained interactive and pedagogical fields, but the session projection discarded them. `completeFormalLessonOutlines()` also rebuilt ordinary scenes from the same minimal projection before persistence.

## Implemented

- `storedOutline()` now preserves validated shared fields (`teachingObjective`, `estimatedDuration`, `languageNote`, image/media references), interactive legacy/widget configuration, PBL configuration, quiz configuration, and server-owned checkpoint metadata.
- `completeFormalLessonOutlines()` spreads the source outline before normalizing identity/order, so ordinary formal scenes retain their complete outline fields while generated checkpoint/remediation scenes remain server-owned.
- Added regression assertions for interactive widget fields and teaching metadata through formal generation persistence/recovery.

## Automated verification

```text
pnpm exec vitest run tests/fusion/generation-session.test.ts
16 tests passed

pnpm exec tsc --noEmit
exit code 0
```

The first Vitest attempt hit the known Windows sandbox `spawn EPERM`; the exact command was retried with approved controlled access and passed.

## Independent review

A final independent read-only review returned `PASS`. It confirmed that ordinary source bindings are stripped, server-generated checkpoint metadata remains authoritative, complete outline fields survive the formal persistence/recovery round trip, and the focused tests and typecheck are consistent.

## Git evidence

```yaml
completionGate:
  gitEvidence:
    repositories:
      - path: OpenMAIC
        branch: fusion-adapter
        commit: 5109bc5
```

## Manual boundary

A fresh manual stream → done → session → browser run remains recommended for visual confirmation. The automated persistence/recovery evidence covers the authoritative server path; no secrets, learner data, or raw model traces are recorded.
