# F14 验证计划

## 必需命令（实施时执行）

| 层级 | 命令 | 目的 |
| --- | --- | --- |
| Store/Worker 测试 | 在 `OpenMAIC/` 运行新增 Outbox SQLite 测试 | 验证事务、幂等、lease、重试、dead-letter。 |
| Fusion 回归 | 在 `OpenMAIC/` 运行 `pnpm test -- tests/fusion` | 确保既有课堂闭环不回归。 |
| 质量 | 在 `OpenMAIC/` 运行范围内 lint/类型检查与 `git diff --check` | 检查实现质量。 |
| Harness | `node scripts/harness-gate.mjs` | 验证状态和证据。 |

## 人工验证路径

- [ ] 入队同一 Candidate 两次，确认仅有一条待投递记录且 idempotencyKey 不变。
- [ ] 模拟暂时失败、进程在 lease 中断开、永久拒绝和达到重试上限，确认状态流符合预期。
- [ ] 审阅 SQLite 记录与日志，确认没有 Token、Service Key、Memory、完整 Prompt 或真实用户数据。

## 通过前的证据要求

- 记录脱敏状态迁移、测试输出、dead-letter 处理证据和 OpenMAIC Git 证据。
- 不提交 SQLite 数据库文件或任何包含可用凭证的测试材料。
