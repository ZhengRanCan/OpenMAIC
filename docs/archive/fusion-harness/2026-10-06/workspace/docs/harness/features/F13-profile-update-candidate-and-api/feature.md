---
id: F13
title: ProfileUpdateCandidate 与 DeepTutor 更新 API
version: v0.1
status: passing
dependsOn: ["F12"]
scope: {"code":["OpenMAIC/lib/fusion/profile-update-candidate.ts","OpenMAIC/lib/fusion/contracts.ts","DeepTutor/deeptutor/api/main.py","DeepTutor/deeptutor/api/routers/fusion_profile_updates.py","DeepTutor/deeptutor/api/services/fusion_profile_updates.py","DeepTutor/integrations/openmaic/fusion/classroom-contracts.ts"],"tests":["OpenMAIC/tests/fusion/profile-update-candidate.test.ts","DeepTutor/tests/api/test_fusion_profile_updates.py","DeepTutor/integrations/openmaic/fusion/tests/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F13-profile-update-candidate-and-api/**","docs/log/artifacts/F13/**","docs/harness/incidents/**"]}
evidence: {"lastVerifiedAt":"2026-07-24T15:00:00+08:00","commands":[{"command":"OpenMAIC Fusion tests","result":"passed","summary":"27/27 passed."},{"command":"conda activate skill; pytest F13/F08 API tests","result":"passed","summary":"5/5 passed."},{"command":"git diff check","result":"passed","summary":"Both Forks passed."}],"manualSmoke":"Candidate carries only mapped immediate observation evidence and idempotency identifiers. DeepTutor accepts it only behind Development Only guard; accepted means candidate received, not long-term profile updated."}
completionGate: {"version":"v0.1","l3":"required","userPath":["OpenMAIC 可将 F12 的最小课堂观察转换为 ProfileUpdateCandidate；DeepTutor 同步返回与同一 candidateId 关联的 accepted、queued、duplicate 或 rejected 回执。"],"integrationEvidence":["docs/log/artifacts/F13/verification-summary.md","docs/log/artifacts/F13/independent-review.md"],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"b8d8ffee7bcb1607c4fe7059a9ffd2eb721ab022"},{"path":"DeepTutor","branch":"fusion-adapter","commit":"e9f5fa58cc15efb0bfe5ad7ebbd5b265f0b90d68"}]}}
---

# F13 ProfileUpdateCandidate 与 DeepTutor 更新 API

## 目标

将 F12 的最小观察投影为版本化 `ProfileUpdateCandidate`，并在 DeepTutor 提供 Development Only 接收 API，返回 `ProfileUpdateReceipt`（`accepted`、`queued`、`duplicate`、`rejected`）。候选表达可审计的课堂观察证据；DeepTutor 决定是否接收，但本阶段不修改真实长期 mastery 或生产学习记录。

## 集成决策

- 权威边界：OpenMAIC 只构造候选；DeepTutor 是候选校验、去重、接收状态与未来长期画像聚合的唯一 owner。
- 候选边界：必须包含 `schemaVersion`、`candidateId`、`lessonSessionId`、`sourceEventIds`、`mappingId/mappingRevision`、最小 observations、创建时间和幂等键；不得写入最终 mastery 数值、长期偏好或长期薄弱点。
- 知识点：仅 `mapped` 观察可带 `authoritativeRef` 并有资格进入候选；`lesson_local`/`unresolved` 可记录为当前课堂事实，但不得转换为长期 mastery 证据。固定 Demo 映射仍需显式标记其 Development Only 语义。
- 接收 API：Development Only guard 必须独立于真实认证路径。请求体 learner 身份不可信；重复 `candidateId` 或 idempotency key 返回 `duplicate`，不得重复写入。
- 记录语义：`accepted`/`queued` 表示 DeepTutor 接收或排队候选，不表示真实长期画像已经更新；为本阶段可使用隔离的开发观察记录，不能触碰真实用户存储。

## 范围

### 允许改动

- 在 OpenMAIC 实现 Ledger → Candidate 的纯函数投影和校验；在 DeepTutor 注册开发更新 API、接收/去重服务、隔离开发记录与测试。
- 覆盖 accepted、queued、duplicate、rejected、无效 schema、重复 candidate、未映射知识点、过度 payload 与禁用开发模式。
- 记录两 Fork 的契约兼容性、测试、独立审查和 Git 证据。

### 不在范围内

- Outbox/异步 Worker/SQLite、课堂完成触发、UI 总结、服务间凭证、token refresh、真实 Launch Code 或生产认证。
- 写入真实 Memory、Mastery、Quiz、长期误区/偏好/薄弱点，或将单题错误当成长期结论。

## 验收标准

- [x] F12 账本可确定性转换成最小化 Candidate，保留 candidateId/sourceEventIds/idempotencyKey 追溯，并拒绝无效或不合格观察。
- [x] DeepTutor API 对合法候选返回对应 candidateId 的 accepted/queued 回执；重复投递稳定返回 duplicate；无效/越界输入返回 rejected 与安全 reasonCode。
- [x] 映射状态规则受测试保护：lesson_local/unresolved 不会生成可写长期 mastery 的 authoritativeRef 或观察。
- [x] API 和开发记录不接触真实画像、Memory、Mastery、真实身份、凭证或浏览器状态；accepted 不被显示/记录为长期画像已更新。
- [x] 两 Fork 范围测试、独立审查、提交/推送 Git 证据与 Harness gate 全部通过。

## 完成证据

- 验证证据：`docs/log/artifacts/F13/verification-summary.md`
- 独立审查：`docs/log/artifacts/F13/independent-review.md`
