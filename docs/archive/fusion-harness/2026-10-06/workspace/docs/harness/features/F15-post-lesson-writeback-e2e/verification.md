# F15 验证计划

## 必需命令（实施时执行）

| 层级 | 命令 | 目的 |
| --- | --- | --- |
| DeepTutor 更新 API | 在 `DeepTutor/` 运行 F13 更新 API 测试 | 验证 Receipt、去重和开发记录隔离。 |
| OpenMAIC 集成/E2E | 在 `OpenMAIC/` 运行 Fusion 与新增课后 E2E 测试 | 验证完成、入队、Worker、总结和故障降级。 |
| 两端质量 | 分别运行范围内 lint/类型检查、相关测试与 `git diff --check` | 检查两个 Fork。 |
| Harness | `node scripts/harness-gate.mjs` | 验证 Feature、分片和证据。 |

## 人工验证路径

- [ ] 完成固定课堂：课堂立即结束，随后看到“候选已入队/DeepTutor 已接收”的准确状态，不出现“长期画像已更新”。
- [ ] 停止 DeepTutor 或让 Worker 重试：课堂仍结束，总结显示待重试；达到上限后显示 dead-letter/需处理状态。
- [ ] 模拟 Outbox 保存失败：总结明确说明未能保存后台同步，而非声称已排队。
- [ ] 重复完成或重放同一 candidate：DeepTutor 仅接受一次，第二次显示 duplicate，且没有重复开发观察记录。

## 通过前的证据要求

- 记录五条路径的脱敏步骤、状态截图/日志摘要、自动测试输出和两 Fork Git 证据。
- 不记录真实 learner、凭证、SQLite 数据库、完整题目答案、Memory、完整 Prompt 或完整会话。
