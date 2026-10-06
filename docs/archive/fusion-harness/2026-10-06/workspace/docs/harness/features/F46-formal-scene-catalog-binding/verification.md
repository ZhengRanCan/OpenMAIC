# F46 Verification

## Required commands

| Layer | Command | Required | Evidence |
| --- | --- | --- | --- |
| L1 static | `OpenMAIC: pnpm exec prettier --check lib/fusion/scene-catalog.ts lib/fusion/generation-session.ts app/api/fusion/classroom-events/route.ts tests/fusion/generation-session.test.ts tests/fusion/classroom-event-route.test.ts` | yes | pass |
| L2 feature | `OpenMAIC: pnpm exec vitest run tests/fusion/generation-session.test.ts tests/fusion/classroom-event-route.test.ts` | yes | 14 passed |
| L3 system | `OpenMAIC: pnpm exec tsc --noEmit && pnpm build` | yes | passed |
| Harness | `node scripts/harness-gate.mjs` | yes | passed |

## Manual paths

- [x] Launch formal lesson, generate outlines, submit checkpoint, and continue (verified at API/integration level through the production route handlers; F46 adds no client surface and the browser dev-mode path uses the development mock branch).

## Passing evidence

- Record results in `docs/log/artifacts/F46/verification-summary.md` and readonly review in `docs/log/artifacts/F46/subagent-review.md`.
