# F02 验证计划

> F02 依赖 F01；F01 通过前，此计划不可执行。

## 必需命令

| 层级 | 命令 | 必需 | 证据 |
| --- | --- | --- | --- |
| L1 静态检查 | `cd OpenMAIC; pnpm lint` | 是 | 验证摘要中的 lint 输出 |
| L1 格式检查 | `cd OpenMAIC; pnpm check` | 是 | 验证摘要中的格式检查输出 |
| L2 功能测试 | `cd OpenMAIC; pnpm test -- tests/fusion` | 是 | 聚焦测试输出 |
| L3 集成验证 | 使用演示学生 A/B 在本地走 OpenMAIC 生成路径；使用已配置服务商或有文档记录的无密钥 route stub | 是 | 人工路径记录，含所选模式和可安全保存的截图/结果 |
| Harness | `node scripts/harness-gate.mjs` | 在标记 `passing` 前必须执行 | 验证摘要中的命令输出 |

## 人工验证路径

- [ ] 选择演示学生 A，生成一次函数课程，确认 Demo 标识和基础型教学策略。
- [ ] 选择演示学生 B，以相同主题生成，确认层级、节奏、示例或检查点存在明显差异。
- [ ] 继续或恢复后续场景生成，确认使用同一会话快照。
- [ ] 验证融合失败/未选择融合时的恢复路径和常规生成回退。

## 通过前的证据要求

- 在 `docs/log/artifacts/F02/verification-summary.md` 记录命令日期、完整命令、环境限制与结果。
- 代码改动后，在 `docs/log/artifacts/F02/subagent-review.md` 记录独立审查。
- 在将 feature 标为 `passing` 前，必须清空 `knownUnverified` 和 `humanReviewRequired`。
