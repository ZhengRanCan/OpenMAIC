# F05 验证计划

## 必需命令

| 层级 | 命令 | 必需 | 证据 |
| --- | --- | --- | --- |
| L1 静态 | `node --check scripts/harness-gate.mjs` | 是 | F05 验证摘要。 |
| L2 回归 | `node --test docs/harness/features/F05-progress-dashboard-guard/tests/*.test.mjs` | 是 | 测试输出。 |
| Harness | `node scripts/harness-gate.mjs` | 是 | F05 验证摘要。 |

## 人工验证路径

- [x] 阅读 `progress.md`，确认五个栏目仍存在，且可以保留任意数量的风险、完成项和说明。
- [x] 对照 `feature-index.json`，确认 F05 为 active、F03 为 blocked 时二者在仪表盘中各出现一次；完成 F05 后当前栏已恢复为“无 active feature”。

## 通过前的证据要求

- 在 `docs/log/artifacts/F05/verification-summary.md` 记录命令、日期和结果。
- 本 feature 不改 Fork 代码，Fork Git 提交证据和独立代码审查不适用。
