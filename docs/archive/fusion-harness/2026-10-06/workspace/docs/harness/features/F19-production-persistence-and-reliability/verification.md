# F19 验证计划

## 必需命令

- 在 OpenMAIC 运行 PostgreSQL Store、事务、CAS、Outbox lease、重试、dead-letter 和故障注入测试。
- 运行真实 Provider 的分能力熔断/降级回归及范围内质量检查。
- 从根目录运行 `node scripts/harness-gate.mjs`。

## Docker PostgreSQL 本地集成演练

1. 用未提交的本地 `.env.local` 配置 Docker PostgreSQL 地址与 Development Only Secret Provider；配置不得包含在 Git 或证据中。`FUSION_TEST_DATABASE_URL` 必须指向专用、可清空的本地测试数据库。
2. 启动 Docker PostgreSQL、OpenMAIC、Outbox Worker 和本地 DeepTutor；创建课堂并确认 `fusion_sessions` 和 `fusion_outbox` 只保存 `credentialRef`，不含 token/secret/prompt/原始 Memory。
3. 刷新 OpenMAIC 并重启 OpenMAIC/Worker；确认 Session、待投递消息和其 idempotencyKey 从 PostgreSQL 恢复。
4. 同时启动两个 Worker；人为中止持有 processing lease 的 Worker，等待 lease 过期后确认另一 Worker 恢复领取，且不会并发投递同一消息。
5. 注入网络、超时、429 和 5xx，确认最多四次总尝试、60 秒基础的带抖动指数退避及 30 分钟单次上限；注入 schema/scope/learner/未知版本错误，确认直接 dead-letter。
6. 以原 idempotencyKey 显式重放 dead-letter，确认产生脱敏操作审计；显式丢弃无效消息。
7. 审阅数据库、浏览器响应和不含敏感信息的日志，确认没有可用凭证或原始学习数据泄露；记录命令、结果和清理步骤到 `docs/log/artifacts/F19/`。

## Deferred / Future Production Validation

托管 PostgreSQL、平台 Secret Manager/KMS、Workload Identity 和真实服务账号演练不属于 F19；须由后续独立 Feature 定义合同和验收。
