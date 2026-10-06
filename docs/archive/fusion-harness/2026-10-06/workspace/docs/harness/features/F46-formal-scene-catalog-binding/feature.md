---
id: F46
title: Formal Fusion Scene Catalog binding
version: v0.1
status: passing
dependsOn: ["F45"]
scope: {"code":["OpenMAIC/**"],"tests":["OpenMAIC/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F46-formal-scene-catalog-binding/**","docs/log/artifacts/F46/**"]}
evidence: {"lastVerifiedAt":"2026-08-11T10:20:00+08:00","commands":[{"command":"OpenMAIC: pnpm exec prettier --check lib/fusion/scene-catalog.ts lib/fusion/generation-session.ts app/api/fusion/classroom-events/route.ts tests/fusion/generation-session.test.ts tests/fusion/classroom-event-route.test.ts","result":"passed"},{"command":"OpenMAIC: pnpm exec vitest run tests/fusion/generation-session.test.ts tests/fusion/classroom-event-route.test.ts","result":"14 passed"},{"command":"OpenMAIC: pnpm exec vitest run tests/fusion","result":"67 passed, 3 skipped"},{"command":"OpenMAIC: pnpm exec tsc --noEmit","result":"passed"},{"command":"OpenMAIC: pnpm build","result":"passed"}],"manualSmoke":"User path verified through the production route handlers at integration level: formal launch persists the server-owned catalog bound to semanticRequestDigest, formal checkpoint rejects missing or mismatched catalogs, and continue is recorded as executed. F46 adds no client surface; the browser dev-mode path uses the development mock branch and cannot reach the production formal catalog binding, so the API-level end-to-end tests are the authoritative user-path verification."}
dataPolicy: {"sources":["server-owned FrozenLessonGenerationContext","server-generated outlines"],"outbound":["versioned Scene Catalog references"],"forbidden":["browser-owned catalog or learner/profile override","token/cookie/secret"],"retention":"Catalog is persisted with the Fusion Session and tied to semanticRequestDigest","exit":"No formal classroom event is accepted without the matching server-owned catalog"}
decisionPolicy: {"catalog":"derive once from the frozen context and accepted outline revision","continue":"normal continue is not degraded","failure":"missing or mismatched catalog fails closed"}
completionGate: {"version":"v0.1","l3":"required","userPath":["正式课前生成、课堂 checkpoint 与 continue 使用同一服务端 Scene Catalog"],"integrationEvidence":["Formal outline persistence derives and stores a non-empty catalog bound to semanticRequestDigest (generation-session tests); classroom-events rejects missing or stale/mismatched formal catalogs with 409 and records normal continue as executed (classroom-event-route tests); full fusion suite 67 passed; production build passed."],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"a450002e1f274f4b5ff915d4e4b95aa01a19b5a5"}]}}
---

# F46 Formal Fusion Scene Catalog binding

## Goal

正式 Fusion 生成、checkpoint 和课堂事件共同读取与 Frozen Context 绑定的服务端 Scene Catalog。

## Integration decision

- Integration host: OpenMAIC Fusion generation/session store.
- Identity and authorization owner: OpenMAIC Lesson Session Binding。
- Authoritative data owner(s): OpenMAIC server-owned Frozen Context and generated outline revision。
- Versioned API/event contract: `semanticRequestDigest` + catalog revision。
- External AI/data sent and purpose: no new external data。

## Scope

### Allowed changes

- 在正式 outline 完成后派生并持久化 Catalog。
- 让 classroom events 只读取匹配 Catalog；修复正常 `continue` 的状态。

### Out of scope

- 不改变 F02 Demo 或普通课堂的生成路径。

## Acceptance Criteria

- [x] Formal launch/generation persists a non-empty catalog tied to the frozen context.
- [x] Formal checkpoint rejects absent, stale, or mismatched catalog.
- [x] Normal continue is recorded as successful, not degraded.

## Risks and compatibility

Historical sessions remain read-only; no silent catalog synthesis from browser payloads。

## Completion evidence

- Verification evidence: `docs/log/artifacts/F46/verification-summary.md`
- Independent review: `docs/log/artifacts/F46/subagent-review.md`
- Git evidence: record OpenMAIC commit before passing。
