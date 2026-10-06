# F10 验证计划

## 必需命令（实施时执行）

| 层级 | 命令 | 目的 |
| --- | --- | --- |
| 纯函数测试 | 在 `OpenMAIC/` 运行 Scene Catalog 与 Planner 测试 | 覆盖三个 intent、匹配、幂等、revision 和循环保护。 |
| Fusion 回归 | 在 `OpenMAIC/` 运行 `pnpm test -- tests/fusion` | 确保现有 F02 路径未受影响。 |
| 质量 | 在 `OpenMAIC/` 运行范围内检查与 `git diff --check` | 检查改动质量。 |
| Harness | `node scripts/harness-gate.mjs` | 验证状态与证据。 |

## 人工验证路径

- [ ] 审阅固定课程的 checkpoint 与 remediation 元数据，确认每个补救页对应明确知识点和教学策略。
- [ ] 用错误策略、未知知识点、已使用补救页和第二次 retry 分别运行 Planner，确认全部安全降级而不循环。

## 通过前的证据要求

- 记录测试矩阵、固定 catalog 的脱敏摘要、降级 reasonCode 与 OpenMAIC Git 证据。
