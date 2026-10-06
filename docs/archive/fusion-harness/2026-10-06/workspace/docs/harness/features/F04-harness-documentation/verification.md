# F04 验证计划

## 必需命令

| 层级 | 命令 | 必需 | 证据 |
| --- | --- | --- | --- |
| 文档引用 | `rg -n 'harness/README|lessons\\.jsonl|DeepTutor-main|OpenMAIC-main' AGENTS.md docs scripts --glob '!docs/harness/features/F04-harness-documentation/**' --glob '!docs/log/artifacts/F04/**'` | 是 | F04 验证摘要；命令应无活动引用。 |
| Harness | `node scripts/harness-gate.mjs` | 是 | F04 验证摘要。 |

## 人工验证路径

- [x] 从 `AGENTS.md` 出发，确认能定位当前 Feature、产品/架构/约束、本地验证、Git 工作流和课堂导出审查说明。
- [x] 对照 F01/F02 合同和 `ARCHITECTURE.md`，确认 Demo 投影、OpenMAIC 服务端消费和未来生产适配层没有混淆。

## 通过前的证据要求

- 在 `docs/log/artifacts/F04/verification-summary.md` 记录命令、日期和结果。
- 不修改 Fork 代码时，独立代码审查和 Fork Git 提交证据不适用；根目录仍不得伪造为 Fork 提交。
- 完成验收后，同步索引、合同和 `docs/progress.md`，再运行 Harness 门禁。
