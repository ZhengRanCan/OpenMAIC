---
id: F48
title: Pre-class clarification revision flow
version: v0.1
status: passing
dependsOn: ["F47"]
scope: {"code":["OpenMAIC/**","DeepTutor/**"],"tests":["OpenMAIC/**","DeepTutor/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F48-preclass-clarification-revision/**","docs/log/artifacts/F48/**"]}
evidence: {"lastVerifiedAt":"2026-08-11T11:30:00+08:00","commands":[{"command":"DeepTutor: python -m compileall -q deeptutor","result":"passed"},{"command":"DeepTutor: ruff check + ruff format --check (changed files)","result":"passed"},{"command":"DeepTutor: mypy deeptutor/api/services/fusion_preclass_context.py","result":"passed"},{"command":"DeepTutor: pytest tests/api/test_fusion_preclass_context.py tests/fusion/test_preclass_contracts.py tests/api/test_fusion_launch.py","result":"27 passed"},{"command":"OpenMAIC: pnpm exec prettier --check (F48 changed files)","result":"passed"},{"command":"OpenMAIC: pnpm exec vitest run tests/fusion","result":"85 passed, 3 skipped"},{"command":"OpenMAIC: pnpm exec tsc --noEmit","result":"passed"},{"command":"OpenMAIC: pnpm build","result":"passed"},{"command":"OpenMAIC: node scripts/check-i18n-keys.mjs","result":"passed"},{"command":"node scripts/harness-gate.mjs","result":"passed: 50 features, 0 errors"}],"manualSmoke":"Clarification flow verified at API level: initiator submits one supplement; new revision/digest is created, prior frozen session remains immutable; partial/unresolved/rejected and second revisions fail closed."}
dataPolicy: {"sources":["initiator-authorized clarification fields","server-owned prior request"],"outbound":["new semantic request revision and digest"],"forbidden":["silent retry of partial/unresolved/rejected","token/cookie/secret"],"retention":"retain revision lineage and resolution status"}
decisionPolicy: {"needs_clarification":"explicit initiator supplement may create one new revision/session","partial":"unresolved/rejected remain fail-closed and non-retryable"}
completionGate: {"version":"v0.1","l3":"required","userPath":["发起人补充澄清后重新冻结正式课前上下文"],"integrationEvidence":["Explicit initiator clarification creates semantic request revision 2 with a new digest and freezes a new formal context; the prior frozen session remains immutable; partial/unresolved/rejected outcomes and second revisions fail closed. Targeted and full Fusion tests, prettier, tsc, build, i18n checks, and Harness gate pass.","Current-platform independent readonly review: pass; scope, acceptance criteria, evidence and both Fork commits were checked."],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"9be95f603b94aa07e0b1b1623d3d355b8c69f31f"},{"path":"DeepTutor","branch":"fusion-adapter","commit":"bfb148ef8631bf76bf4075e154ee3b365431723b"}]}}
---

# F48 Pre-class clarification revision flow

## Goal

`needs_clarification` has an explicit, auditable initiator revision path without mutating a frozen context。

## Integration decision

- Integration host: OpenMAIC pre-class orchestration with DeepTutor semantic context route。
- Identity and authorization owner: bound lesson initiator and service delegation。
- Authoritative data owner(s): request revision, digest, proposal/resolution, frozen context。
- Versioned API/event contract: new request revision and Fusion Session lineage。
- External AI/data sent and purpose: minimum clarification fields only。

## Scope

### Allowed changes

- Add explicit clarification/revision endpoint, UI state, and persistence.

### Out of scope

- Automatic retries or changes to in-class/post-class protocols。

## Acceptance Criteria

- [x] Initiator can submit one explicit clarification and receive a new digest/session。
- [x] Existing frozen context remains immutable。
- [x] `partial`, `unresolved`, and `rejected` cannot auto-retry。

## Risks and compatibility

Revision limit and stale-session handling must fail closed。

## Completion evidence

- Verification evidence: `docs/log/artifacts/F48/verification-summary.md`
- Independent review: `docs/log/artifacts/F48/subagent-review.md`
