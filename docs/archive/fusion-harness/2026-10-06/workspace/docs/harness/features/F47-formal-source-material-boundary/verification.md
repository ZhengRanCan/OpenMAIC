# F47 Verification

## Required commands

| Layer | Command | Required | Evidence |
| --- | --- | --- | --- |
| L1 static | `OpenMAIC: pnpm exec prettier --check lib/fusion/generation-session.ts app/api/generate/scene-outlines-stream/route.ts app/api/generate/scene-content/route.ts tests/fusion/source-material-boundary.test.ts` | yes | pass |
| L2 feature | `OpenMAIC: pnpm exec vitest run tests/fusion/source-material-boundary.test.ts tests/fusion/generation-session.test.ts tests/fusion/classroom-event-route.test.ts` | yes | 16 passed |
| L3 system | `OpenMAIC: pnpm exec tsc --noEmit && pnpm build` | yes | pass |
| Harness | `node scripts/harness-gate.mjs` | yes | 50 features, 0 errors |

## Manual paths

- [x] Formal request with browser-only material is rejected/ignored; ordinary classroom upload still works。

## Passing evidence

- Record results under `docs/log/artifacts/F47/`。
