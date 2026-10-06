# F22 verification

## Automated verification

| Layer | Command | Result |
| --- | --- | --- |
| Shared publishing | `cd OpenMAIC && corepack pnpm exec vitest run tests/lan-shared/classrooms.test.ts tests/server/provider-config.test.ts tests/store/settings-server-sync.test.ts` | Passed: 132 tests. |
| Launcher | `cd OpenMAIC && corepack pnpm test:lan-shared` | Passed: 5 tests. |
| Quality | TypeScript, scoped ESLint, Prettier, and `git diff --check` | Passed. |
| Production build | `cd OpenMAIC && OPENMAIC_LAN_SHARED_MODE=true NEXT_PUBLIC_OPENMAIC_LAN_SHARED_MODE=true NODE_ENV=production corepack pnpm build` | Passed. |
| Harness | `node scripts/harness-gate.mjs` | Passed. |

## Manual acceptance

- [x] Host started F22 at the original localhost port and confirmed private LAN address.
- [x] Host published existing browser-local classrooms without losing the original workspace.
- [x] A second LAN device opened a published classroom.
- [x] The second device played the host-published classroom audio.
- [x] The user accepted that the server-managed provider catalog is not needed for this classroom-viewing LAN deployment.

## Independent review

- [x] Standards review since `5281a0f`: pass; no documented non-tooling violations.
- [x] Spec review since `5281a0f`: pass; concurrent publishing and same-origin speech-audio sharing satisfy F22 without scope creep.
