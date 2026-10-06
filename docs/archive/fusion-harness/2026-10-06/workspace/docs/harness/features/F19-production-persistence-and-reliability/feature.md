---
id: F19
title: 生产兼容的服务端持久化与可靠性
version: v0.1
status: passing
dependsOn: ["F18"]
scope: {"code":["OpenMAIC/app/api/fusion/**","OpenMAIC/lib/fusion/contracts.ts","OpenMAIC/lib/fusion/session/**","OpenMAIC/lib/fusion/session-store/**","OpenMAIC/lib/fusion/identity/**","OpenMAIC/lib/fusion/credentials/**","OpenMAIC/lib/fusion/outbox/**","OpenMAIC/lib/fusion/reliability/**","OpenMAIC/lib/fusion/adapter/**","OpenMAIC/lib/fusion/post-lesson-closeout.ts","OpenMAIC/types/**","OpenMAIC/packages/@openmaic/storage/**","OpenMAIC/package.json","OpenMAIC/pnpm-lock.yaml","OpenMAIC/docker-compose.yml","OpenMAIC/.env.example"],"tests":["OpenMAIC/tests/fusion/session-store.test.ts","OpenMAIC/tests/fusion/outbox-reliability.test.ts","OpenMAIC/tests/fusion/**"],"docs":["docs/progress.md","docs/harness/INITIALIZATION_CONTRACT.md","docs/harness/ARCHITECTURE.md","docs/harness/ARCHITECTURE/F06_ARCHITECTURE_SPLIT/**","docs/harness/features/feature-index.json","docs/harness/features/F19-production-persistence-and-reliability/**","docs/log/artifacts/F19/**","docs/harness/incidents/**"]}
evidence: {"lastVerifiedAt":"2026-07-26","commands":[{"command":"cd OpenMAIC && corepack pnpm test -- tests/fusion/docker-postgres.integration.test.ts","result":"passed"},{"command":"cd OpenMAIC && corepack pnpm test -- tests/fusion","result":"passed"},{"command":"cd OpenMAIC && corepack pnpm lint","result":"passed"},{"command":"cd OpenMAIC && corepack pnpm build","result":"passed"},{"command":"git -C OpenMAIC diff --check","result":"passed"}],"manualSmoke":"Passed: Docker PostgreSQL restart recovery, single-message concurrent lease, retry idempotency, retention cleanup, and credential reference isolation."}
completionGate: {"version":"v0.1","l3":"required","userPath":["本地 OpenMAIC、Outbox Worker 与 DeepTutor 集成使用 Docker PostgreSQL 保存权威 Session、凭证引用和 Outbox 状态；重启后可恢复，失败可降级且不会泄露凭证或静默丢失候选。"],"integrationEvidence":["Docker PostgreSQL local integration passed 3 checks; Fusion regression, lint and production build pass. See docs/log/artifacts/F19/verification-summary.md."],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"609bb6a6503e9ee99aa87f8365edc8847d8b37e3"}]}}
---

# F19 生产兼容的服务端持久化与可靠性

## 目标

交付可部署到生产的 PostgreSQL 持久化端口与可靠性实现，并在本地 Docker PostgreSQL 集成环境验证 `FusionSessionStore`、`FusionOutboxStore` 与 `DelegationCredentialStore` 的行为。F19 不部署或认证任何云平台。

## 集成决策

- Session、Outbox、Credential 三个端口职责独立，可共用支持事务的生产数据库；浏览器状态不是权威来源。
- Session 保存不可变 Profile/Map 快照、RuntimeState、降级状态和 revision；更新使用 CAS/乐观并发控制。
- Outbox payload 最小化且只持 credentialRef；Worker 使用受限 Service Key/service principal 或受控刷新，不能依赖过期课堂委托 token。
- profile-read、diagnosis、classroom-event-write、profile-update-submit 独立健康与熔断；无快照时只能重试或明确普通课堂，有快照可 snapshot_degraded。
- 本地集成使用 Docker PostgreSQL；Session 与 Outbox 使用同一 PostgreSQL 连接内的事务，端口和表保持独立。开发凭证仅来自未提交的本地配置或明确标记的 Development Only Secret Provider，且不得写入 PostgreSQL、浏览器、日志或 Git。

## F19 本地集成策略

- Docker PostgreSQL 是本地权威 Fusion 存储；内存、JSON 文件和 SQLite 不得代替它验证 F19 的 Session/Outbox 路径。
- 本地 Secret Provider 只可从未提交配置读取凭证，并只返回不可认证的 `credentialRef` 给数据库记录。Token、私钥、客户端秘密、Prompt 和原始 Memory 不得进入 PostgreSQL、浏览器、日志、课堂导出或 Git。
- 本地 Worker 使用最小权限的模拟服务端身份，仅允许 `classroom-event:write`、`profile-update:submit`；DeepTutor 本地集成仍校验消息 learner 绑定与 idempotencyKey。
- 自动投递最多 4 次总尝试（首次加 3 次重试），以 60 秒为基础、带随机抖动的指数退避，单次等待最多 30 分钟。网络、超时、429 与可恢复 5xx 可重试；认证/scope、schema、learner、永久拒绝和未知契约版本直接 dead-letter/rejected。
- 已投递 Outbox payload 保留 7 天；dead-letter 最多 30 天；不含敏感 payload 的审计元数据 90 天；FusionSession 在课堂结束后最多 30 天。支持按 `learnerId` / `lessonSessionId` 删除；更严格的机构或隐私策略优先。
- dead-letter 仅允许受限管理入口查看脱敏元数据、显式重放或显式丢弃；重放复用原 idempotencyKey，并记录操作者、时间和原因。dead-letter 堆积、重复认证失败与 lease 异常必须告警。

## Deferred / Future Production Validation

- 托管 PostgreSQL 的备份、恢复、传输/静态加密与网络隔离。
- 平台 Secret Manager/KMS、密钥轮换、撤销与审计。
- Workload Identity、真实服务账号短期令牌和 DeepTutor 的服务间授权演练。
- 云平台告警、保留期自动清理、dead-letter 运维入口与真实生产 SLA。

这些事项属于后续独立 Feature；它们不阻止 F19 的 Docker PostgreSQL 本地集成验收。

## 验收标准

- [x] PostgreSQL 兼容 Store 持久化 FusionSessionRecord、最小 Outbox 和不可认证 credentialRef；凭证、Token、Prompt 和原始 Memory 不进入普通存储/日志。
- [x] 课堂事实与 Outbox 入队具备事务一致性；lease 过期恢复、幂等、有限重试和 dead-letter 可测试。
- [x] 四类能力独立熔断/降级；Outbox/认证失败不会阻塞课堂，也不会声称未保存数据已排队。
- [x] 本地集成路径不会以 Mock、文件或 SQLite 作为权威 Fusion Store；缺失本地 PostgreSQL/Secret Provider 配置会显式失败。
- [x] Docker PostgreSQL 演练、存储/故障注入测试、独立审查、Git 证据和 Harness gate 通过。

## 完成证据

- 验证证据：`docs/log/artifacts/F19/verification-summary.md`
- 独立审查：`docs/log/artifacts/F19/independent-review.md`
