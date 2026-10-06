---
id: F22
title: OpenMAIC LAN shared workspace
version: v0.1
status: passing
dependsOn: ["F21"]
scope: {"code":["OpenMAIC/package.json","OpenMAIC/scripts/lan-shared*","OpenMAIC/app/page.tsx","OpenMAIC/app/api/lan-shared/**","OpenMAIC/lib/lan-shared/**","OpenMAIC/lib/utils/stage-storage.ts","OpenMAIC/lib/i18n/locales/*.json"],"tests":["OpenMAIC/tests/lan-shared/**","OpenMAIC/tests/scripts/lan-shared-preflight.test.mjs"],"docs":["docs/harness/features/feature-index.json","docs/harness/features/F22-openmaic-lan-shared-workspace/**","docs/log/artifacts/F22/**","docs/harness/incidents/**","docs/progress.md","docs/harness/INITIALIZATION_CONTRACT.md"]}
evidence: {"lastVerifiedAt":"2026-07-28","commands":[{"command":"cd OpenMAIC && corepack pnpm exec vitest run tests/lan-shared/classrooms.test.ts tests/server/provider-config.test.ts tests/store/settings-server-sync.test.ts","result":"passed (132 tests)"},{"command":"cd OpenMAIC && corepack pnpm test:lan-shared && corepack pnpm exec tsc --noEmit && scoped eslint/prettier && git diff --check","result":"passed"},{"command":"cd OpenMAIC && OPENMAIC_LAN_SHARED_MODE=true NEXT_PUBLIC_OPENMAIC_LAN_SHARED_MODE=true NODE_ENV=production corepack pnpm build","result":"passed"},{"command":"node scripts/harness-gate.mjs","result":"passed"}],"manualAcceptance":"2026-07-28: user confirmed a second LAN device could open a published classroom and play its published speech audio. The host retained its original localhost IndexedDB workspace. The model/provider catalog was explicitly declared unnecessary for this LAN classroom-viewing use case."}
completionGate: {"version":"v0.1","l3":"required","userPath":["Host starts the shared workspace at the original localhost port and confirmed private IPv4 address; a LAN visitor can see a published classroom, open it, and hear its published speech audio. Ctrl+C stops the temporary sharing service."],"integrationEvidence":["User-confirmed two-device published-classroom opening and audio playback on 2026-07-28."],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"1e17bd76a6984e5e86498a60ebc241f8bcb099a5"}]}}
---

# F22 OpenMAIC LAN shared workspace

## Outcome

F22 adds a temporary LAN sharing path without changing F21's read-only `/lan-demo` boundary. The host keeps using its existing `http://localhost:<port>` browser origin and can explicitly publish local classrooms. The launcher listens on all IPv4 interfaces so LAN visitors use the confirmed private IPv4 address.

Publishing copies the host browser's existing classroom structure into a server-side shared classroom copy and updates the shared manifest. It does not delete or overwrite the host's browser source. Visitors can see the shared list, open a published classroom, and receive their own local viewing copy.

The publish path also copies only pre-generated speech audio referenced by the shared classroom. The host uploads those IndexedDB audio blobs to server-side classroom media; shared speech actions receive same-origin `/api/classroom-media/...` URLs, so visitors can hear the existing lesson audio without a local TTS configuration.

Any LAN visitor may explicitly publish a classroom to refresh the common source, as approved for this short-lived demonstration. Browser-local model/provider settings are not copied; the user explicitly accepted that a provider catalog is unnecessary for the current classroom-viewing deployment.

## Acceptance Criteria

- [x] The LAN launcher preserves host access through the original localhost port while serving the confirmed LAN address; F21 remains unchanged.
- [x] Existing host classrooms can be published without deleting or overwriting their browser IndexedDB source.
- [x] A second LAN device can see and open published classrooms.
- [x] Existing host speech audio is copied to the host service and plays on the second device.
- [x] Concurrent classroom and audio publishing are serialized and covered by regression tests.
- [x] Targeted tests, production build, independent review, pushed Git evidence, and Harness gate pass.

## Boundaries

- This is temporary LAN sharing, not public deployment, authentication, rate limiting, or real-time collaborative editing.
- A visitor's opened classroom is a local copy; only explicit publish updates the common source.
- Other browser-local Blob media is outside this feature's audio migration addition.

## Evidence

- Verification record: `docs/log/artifacts/F22/verification-summary.md`
- Independent review: `docs/log/artifacts/F22/independent-review.md`
