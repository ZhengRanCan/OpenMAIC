---
id: F49
title: Pre-class context shadow wiring
version: v0.1
status: passing
dependsOn: ["F48"]
scope: {"code":["OpenMAIC/**"],"tests":["OpenMAIC/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F49-preclass-shadow-wiring/**","docs/log/artifacts/F49/**"]}
evidence: {"lastVerifiedAt":"2026-08-11T12:53:00+08:00","commands":[{"command":"OpenMAIC: pnpm exec prettier --check lib/fusion/adapter/preclass-context-provider.ts lib/fusion/generation-session.ts tests/fusion/preclass-context-shadow.test.ts tests/fusion/generation-session.test.ts","result":"passed"},{"command":"OpenMAIC: pnpm exec vitest run tests/fusion/preclass-context-shadow.test.ts tests/fusion/launch-route.test.ts","result":"11 passed"},{"command":"OpenMAIC: pnpm exec vitest run tests/fusion","result":"92 passed, 3 skipped"},{"command":"OpenMAIC: pnpm exec tsc --noEmit","result":"passed"},{"command":"OpenMAIC: pnpm build","result":"passed"},{"command":"OpenMAIC: node scripts/check-i18n-keys.mjs","result":"passed"},{"command":"node scripts/harness-gate.mjs","result":"50 features, 0 errors"}],"manualSmoke":"Verified at API level: with FUSION_PRECLASS_CONTEXT_SHADOW_ENABLED=true the formal freeze invokes the shadow read after persisting the frozen context and stores only redacted comparison metadata; provider failure is classified as provider_failed without blocking or altering the formal result; with the flag off no shadow call occurs."}
dataPolicy: {"sources":["server-owned formal context and shadow result"],"outbound":["redacted comparison metadata only"],"forbidden":["shadow output affecting formal generation","token/cookie/secret or source body"],"retention":"retain classified comparison metadata with session correlation"}
decisionPolicy: {"shadow":"best-effort and non-blocking","failure":"shadow failure is observable but cannot alter formal result"}
completionGate: {"version":"v0.1","l3":"required","userPath":["formal launch/freeze records optional shadow comparison"],"integrationEvidence":["recordPreClassContextShadow is invoked best-effort and non-blocking after both initial formal freeze and explicit clarification revision freeze when FUSION_PRECLASS_CONTEXT_SHADOW_ENABLED=true; stored shadow contains only request correlation, comparison categories and failure classification; formal output is unchanged and flag-off skips diagnostics. Prettier, targeted/full Fusion tests, tsc, build, i18n and Harness gate pass.","OpenMAIC commit 400e06e2d1283aa7cf3f0c147d797add4cdad8a7 has been pushed to origin/fusion-adapter.","Current-platform independent readonly review: pass; remediation scope, acceptance criteria, evidence and Git state checked."],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"400e06e2d1283aa7cf3f0c147d797add4cdad8a7"}]}}
---

# F49 Pre-class context shadow wiring

## Goal

Wire the existing shadow provider into the formal server flow while preserving strict non-interference。

## Integration decision

- Integration host: OpenMAIC launch/freeze orchestration。
- Identity and authorization owner: formal lesson session。
- Authoritative data owner(s): formal Frozen Context; shadow is diagnostic only。
- Versioned API/event contract: redacted shadow comparison record。
- External AI/data sent and purpose: none beyond existing provider contract。

## Scope

### Allowed changes

- Connect `recordPreClassContextShadow` to server-side launch/freeze and add failure-class tests。

### Out of scope

- Changing formal context selection or retry policy。

## Acceptance Criteria

- [x] Shadow is invoked in the intended formal path when enabled。
- [x] Shadow failures do not block or modify formal generation。
- [x] Stored observability contains no sensitive payloads。

## Risks and compatibility

Feature flag defaults remain unchanged; disablement removes only diagnostics。

## Completion evidence

- Verification evidence: `docs/log/artifacts/F49/verification-summary.md`
- Independent review: `docs/log/artifacts/F49/subagent-review.md`
