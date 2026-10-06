---
id: F42
title: OpenMAIC 课前 Context 双写与 Shadow
version: v0.1
status: passing
dependsOn: ["F41"]
scope: {"code":["OpenMAIC/**"],"tests":["OpenMAIC/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F42-openmaic-preclass-context-shadow/**","docs/harness/FUSION/03-pre-class-fusion-code-migration-roadmap.md","docs/log/artifacts/F42/**"]}
evidence: {"lastVerifiedAt":"2026-08-04","commands":[{"command":"pnpm exec vitest run tests/fusion/preclass-context-shadow.test.ts tests/fusion/launch-route.test.ts tests/fusion/generation-session.test.ts tests/fusion/preclass-contracts.test.ts","result":"21 passed"},{"command":"pnpm exec tsc --noEmit","result":"passed"},{"command":"pnpm run build","result":"passed"},{"command":"pnpm exec prettier --check <F42 changed files>","result":"passed"},{"command":"git diff --check","result":"passed"}],"manualSmoke":"Code review: the browser receives only lessonSessionId; the server-owned feature switch runs the shadow read after legacy context freeze, and formal generation does not read the shadow field."}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["维护者可确认新课前结果以服务端拥有的 request/proposal/resolution/frozen context 写入 Session 并作为 shadow 观测，但旧正式课堂结果保持不变。"],"integrationEvidence":["OpenMAIC fusion-adapter f65b4cfa67d1ac79275cc4c384c7061912c3d370 pushed to origin/fusion-adapter; HEAD and origin ref match."],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"f65b4cfa67d1ac79275cc4c384c7061912c3d370"}]}}
---

# F42 OpenMAIC 课前 Context 双写与 Shadow

## 目标

实现课前迁移阶段 C：新增 OpenMAIC `PreClassContextProvider`，在服务端构造 Intent、调用 F41 Route，并将 request、Proposal、Resolution 与 Frozen Context 以新版本写入 Session；正式课堂仍使用完整旧路径，shadow 仅用于观测。

## 边界与验收

- 浏览器不得选择 Provider/schema/learner，亦不得读取 delegation；服务端拥有开关、构造与写入。
- 新旧对象严格隔离：不得以旧 Profile + 新 Map/Guidance，或不同 digest/revision 拼接上下文。
- shadow 记录可追踪但脱敏的主题/范围/错误分类差异，不产生课堂或长期画像双重副作用。
- 新 Provider 失败不得回退 Mock；旧正式路径行为保持不变。
- 通过 OpenMAIC 测试、类型/构建、独立审查、Git 证据与 Harness gate。

## 验收标准

- [x] 新 Provider 只从服务端已冻结的 legacy context、Session credential reference 和受限 delegation 构造并发送严格解析的 request；不接受 browser learner、Provider、schema、token 或原始材料覆盖。
- [x] Session 以独立的 `preclass-context-shadow-v1` 对象记录 request、Proposal、Resolution、ready 时的 Frozen Context，以及脱敏的 topic/scope/error-type 比较；旧字段与 `f23-v1` 正式读取保持不变。
- [x] `FUSION_PRECLASS_CONTEXT_SHADOW_ENABLED=true` 是唯一开关；Provider/scope/response 失败写入显式 `provider_failed` 分类，不回退 Mock，也不改变旧课堂输出。
- [x] `/api/fusion/launch` 不再向浏览器回显 learner identity；浏览器仅获得 `lessonSessionId`，delegation 仍局限在服务端。
- [x] 目标测试、类型检查、生产构建、格式/差异检查、独立代码审查和 OpenMAIC Git push 均已通过。
