---
id: F14
title: 开发环境 Outbox Worker
version: v0.1
status: passing
dependsOn: ["F13"]
scope: {"code":["OpenMAIC/lib/fusion/outbox/**","OpenMAIC/lib/fusion/adapter/**","OpenMAIC/lib/fusion/contracts.ts","OpenMAIC/lib/fusion/profile-update-candidate.ts","OpenMAIC/package.json"],"tests":["OpenMAIC/tests/fusion/outbox-store.test.ts","OpenMAIC/tests/fusion/outbox-worker.test.ts","OpenMAIC/tests/fusion/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F14-development-outbox-worker/**","docs/log/artifacts/F14/**","docs/harness/incidents/**"]}
evidence: {"lastVerifiedAt":"2026-07-24T15:00:00+08:00","commands":[{"command":"OpenMAIC Fusion tests","result":"passed","summary":"29/29 passed."}],"manualSmoke":"Development Only server-side SQLite outbox uses leases, retry scheduling and explicit dead-letter without credential storage."}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["维护者可将一个 ProfileUpdateCandidate 入队到 Development Only SQLite Outbox；Worker 以原 candidateId 和 idempotencyKey 重试并最终记录 delivered、retry_scheduled 或 dead_letter。"],"integrationEvidence":["docs/log/artifacts/F14/verification-summary.md","docs/log/artifacts/F14/independent-review.md"],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"b0115d186e5f81e514b19433fb59c6b1fa094410"}]}}
---

# F14 开发环境 Outbox Worker

## 目标

为 F13 的 ProfileUpdateCandidate 建立 OpenMAIC 服务端 Development Only SQLite Outbox 与后台 Worker。它持久化最小 payload，使用 `candidateId` 和 `idempotencyKey` 实现安全重试，并维护 `pending`、`processing`、`delivered`、`retry_scheduled`、`dead_letter` 状态；课堂主路径不等待投递。

## 集成决策

- 所有权：`FusionOutboxStore` 只负责记录、去重、lease 和状态；Worker 负责取件、调用 F13 的提交端口并回写 Receipt。Store 不直接访问 DeepTutor。
- 开发存储：SQLite 仅限 Development Only；文件路径、数据库内容、日志和测试 artifact 不得包含真实 learner、凭证、完整 Prompt、Memory 或完整会话。
- 幂等与 lease：重试必须复用原 `candidateId`、`sourceEventIds` 和 `idempotencyKey`；支持 processing lease、lease 过期恢复和有限重试；上限后转入 dead_letter，不得静默丢失或无限重试。
- 鉴权：本阶段只允许可注入的 Development Only 提交器，不把 F13 请求凭证存入 Outbox。生产 Service Key、凭证刷新、DelegationCredentialStore 和真正后台部署仍是后续 Feature/TBD。
- 事务：课堂事实/候选落库与 Outbox 入队尽量同一 SQLite 事务；具体生产数据库事务不在本 Feature。

## 范围

### 允许改动

- 实现 OpenMAIC 侧 SQLite Outbox Store、Worker、lease、状态机、有限退避、dead-letter、Development Only 配置和无网络测试。
- 接入 F13 的抽象提交端口，验证 receipt success、retryable failure、permanent rejection、lease crash recovery、duplicate enqueue 和 payload 最小化。
- 更新必要依赖、测试、证据以及 OpenMAIC Fork Git 证据。

### 不在范围内

- 真实服务间凭证、token 刷新、生产数据库/加密/保留期、浏览器 Worker、真实 DeepTutor 网络调用、课堂完成 UI 或真正长期画像更新。
- 将 Outbox 用作 FusionSessionStore、浏览器缓存、完整课堂导出或长期观察数据库。

## 验收标准

- [x] Candidate 可在课堂主路径外原子入队；相同 idempotencyKey 不会创建重复待投递记录。
- [x] Worker 通过 lease 独占处理并正确迁移 pending、processing、delivered、retry_scheduled、dead_letter；lease 过期可安全恢复。
- [x] 重试始终复用原 candidateId/sourceEventIds/idempotencyKey；达到上限或永久拒绝后有可追溯 dead-letter，不会静默丢失。
- [x] SQLite payload 只保留 F13 最小 Candidate 与非认证引用；不含 token、Service Key、Memory、完整 Prompt、完整会话或无关个人信息。
- [x] OpenMAIC 范围测试、独立审查、提交/推送 Git 证据和 Harness gate 全部通过。

## 完成证据

- 验证证据：`docs/log/artifacts/F14/verification-summary.md`
- 独立审查：`docs/log/artifacts/F14/independent-review.md`
