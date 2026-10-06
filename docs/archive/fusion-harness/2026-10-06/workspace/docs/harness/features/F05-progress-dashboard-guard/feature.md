---
id: F05
title: 进度面板门禁
version: v0.1
status: passing
dependsOn: []
scope: {"code":["scripts/harness-gate.mjs"],"tests":["docs/harness/features/F05-progress-dashboard-guard/tests/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F05-progress-dashboard-guard/**","docs/log/artifacts/F05/**"]}
evidence: {"lastVerifiedAt":"2026-07-23T00:00:00.000Z","commands":[{"command":"node --check scripts/harness-gate.mjs","result":"passed","runAt":"2026-07-23","summary":"语法检查通过。"},{"command":"node --test docs/harness/features/F05-progress-dashboard-guard/tests/*.test.mjs","result":"passed","runAt":"2026-07-23","summary":"4/4 通过，覆盖有效面板、缺失标题、重复 active 和 blocked 状态错配。"},{"command":"node scripts/harness-gate.mjs","result":"passed","runAt":"2026-07-23","summary":"5 features，0 errors。"}],"manualSmoke":"人工核对 progress.md 的五个固定栏目；当前 F05 与暂停 F03 均和 Registry 一致。"}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["维护者更新 progress.md 后运行 Harness gate，能够在标题缺失、状态错配或多个 current feature 时获得明确失败信息。"],"integrationEvidence":[],"knownUnverified":[],"humanReviewRequired":[]}
---

# F05 进度面板门禁

## 目标

为 `docs/progress.md` 增加自动门禁，保护它作为持续更新的状态仪表盘：固定结构不能被误删，当前 active 与暂停 blocked 条目必须准确反映 `feature-index.json`。

## 集成决策

- 集成宿主：根级 harness 的 `scripts/harness-gate.mjs`。
- 身份、授权、外部 AI 与数据：不适用；只读取本地 Feature 索引和进度面板。
- 权威数据所有者：`feature-index.json` 是 Feature 状态的权威来源；`progress.md` 是供人阅读、但必须与其一致的仪表盘。
- 兼容性：只要求五个固定二级标题；不限制每个栏目下的文字长度、风险数量或完成项数量。

## 范围

### 允许改动

- 在 Harness gate 中读取并验证 `docs/progress.md`。
- 创建 F05 合同、验证计划、测试和证据；更新进度面板及索引。

### 不在范围内

- 修改两个 Fork 的代码、Git 配置或运行环境。
- 限制 progress.md 的自由文本内容，或把它改为完整历史日志。
- 改变 F03 暂停、F01/F02/F04 通过的产品结论。

## 验收标准

- [x] 缺少任一固定标题时，Harness gate 失败并说明缺失标题。
- [x] current feature 出现多条 active 条目，或与 Registry 的 active Feature 不一致时，Harness gate 失败。
- [x] blocked Feature 与 Registry 不一致、缺失或重复时，Harness gate 失败。
- [x] 当前有效 `progress.md` 与回归测试均通过；正文长度和其他栏目内容不受限制。

## 风险与兼容性

- 解析只识别以 `F数字` 开头、带 `active` 或 `blocked` 状态标记的仪表盘条目；其他说明性文字不受约束。
- 标题或状态表示法如需变化，必须先同步修改 F05 测试与本合同，避免静默放宽门禁。

## 完成证据

- 验证证据：`docs/log/artifacts/F05/verification-summary.md`
- 独立审查：不需要；本 feature 不修改 Fork 代码。
