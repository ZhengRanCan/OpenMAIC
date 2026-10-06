---
id: F47
title: Formal Fusion source material authorization boundary
version: v0.1
status: passing
dependsOn: ["F46"]
scope: {"code":["OpenMAIC/**"],"tests":["OpenMAIC/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F47-formal-source-material-boundary/**","docs/log/artifacts/F47/**"]}
evidence: {"lastVerifiedAt":"2026-08-11T10:50:00+08:00","commands":[{"command":"OpenMAIC: pnpm exec prettier --check lib/fusion/generation-session.ts app/api/generate/scene-outlines-stream/route.ts app/api/generate/scene-content/route.ts tests/fusion/source-material-boundary.test.ts","result":"passed"},{"command":"OpenMAIC: pnpm exec vitest run tests/fusion/source-material-boundary.test.ts tests/fusion/generation-session.test.ts tests/fusion/classroom-event-route.test.ts","result":"16 passed"},{"command":"OpenMAIC: pnpm exec vitest run tests/fusion","result":"69 passed, 3 skipped"},{"command":"OpenMAIC: pnpm exec tsc --noEmit","result":"passed"},{"command":"OpenMAIC: pnpm build","result":"passed"},{"command":"node scripts/harness-gate.mjs","result":"passed: 50 features, 0 errors"}],"manualSmoke":"Formal generation/content route boundary verified at API level: non-empty browser pdfText/pdfImages/researchContext/imageMapping is rejected; ordinary classroom branch remains unchanged."}
dataPolicy: {"sources":["server-owned authorized material references and digests"],"outbound":["minimum authorized refs/digests"],"forbidden":["formal trust in browser pdfText/pdfImages/researchContext","token/cookie/secret"],"retention":"retain references and digest only","exit":"unauthorized body is rejected or ignored with explicit status"}
decisionPolicy: {"formal":"fail closed when authorized material refs are absent or stale","nonFusion":"ordinary classroom material path remains unchanged"}
completionGate: {"version":"v0.1","l3":"required","userPath":["正式 Fusion 只使用服务端授权材料引用"],"integrationEvidence":["Formal outline and content routes fail closed on browser-owned material bodies; non-Fusion path remains unchanged; targeted and full Fusion tests, tsc, build, and Harness gate pass.","Current-platform independent readonly review: pass; scope, acceptance criteria, evidence and Git commit were checked."],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"697ae0b828d620049a7011eaedc204ff26eaef94"}]}}
---

# F47 Formal Fusion source material authorization boundary

## Goal

Formal Fusion no longer treats browser-supplied source bodies as authoritative input。

## Integration decision

- Integration host: OpenMAIC formal generation routes and adapter mapper。
- Identity and authorization owner: server-side lesson binding/material policy。
- Authoritative data owner(s): server-owned material references and digest。
- Versioned API/event contract: material reference schema + digest。
- External AI/data sent and purpose: only authorized excerpt/reference required for generation。

## Scope

### Allowed changes

- Formal outline/content routes and tests.

### Out of scope

- Non-Fusion classroom uploads and F02 historical records。

## Acceptance Criteria

- [x] Formal request cannot override material semantics with `pdfText`, `pdfImages`, or `researchContext`.
- [x] Unauthorized or stale references fail closed with an explicit error。

## Risks and compatibility

Existing non-Fusion requests retain their current material handling。

## Completion evidence

- Verification evidence: `docs/log/artifacts/F47/verification-summary.md`
- Independent review: `docs/log/artifacts/F47/subagent-review.md`
