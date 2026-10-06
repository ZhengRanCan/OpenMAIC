# F12 验证计划

## 必需命令（实施时执行）

| 层级 | 命令 | 目的 |
| --- | --- | --- |
| 观察账本单元测试 | 在 `OpenMAIC/` 运行新增 ledger 测试 | 验证关联、最小化、幂等与降级记录。 |
| Fusion 回归 | 在 `OpenMAIC/` 运行 `pnpm test -- tests/fusion` | 确保 F07–F11 的课中闭环不回归。 |
| 质量 | 在 `OpenMAIC/` 运行范围内 lint/类型检查与 `git diff --check` | 检查实现质量。 |
| Harness | `node scripts/harness-gate.mjs` | 验证 Feature 状态与证据。 |

## 人工验证路径

- [ ] 完成一节固定 Demo 课堂，包含正确、错误/补救和诊断失败三类 checkpoint；审阅账本关联是否完整。
- [ ] 重放相同 eventId 与 directiveId，确认账本不重复追加观察。
- [ ] 审阅账本导出/日志，确认不含凭证、Memory、完整 Prompt 或完整会话。

## 通过前的证据要求

- 记录脱敏账本摘要、测试输出、错误/降级路径和 OpenMAIC Git 证据。
- 不记录真实 learner、Token、Cookie、完整题目答案集、Memory 或完整模型输入。
