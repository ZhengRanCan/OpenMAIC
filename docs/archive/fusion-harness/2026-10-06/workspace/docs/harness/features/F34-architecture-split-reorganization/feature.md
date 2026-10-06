---
id: F34
title: Architecture Split 全局架构重组
version: v0.1
status: passing
dependsOn: ["F33"]
scope: {"code":["scripts/architecture-split.mjs"],"tests":[],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F34-architecture-split-reorganization/**","docs/harness/ARCHITECTURE.md","docs/harness/ARCHITECTURE/F06_ARCHITECTURE_SPLIT/**","docs/log/artifacts/F34/**"]}
evidence: {"lastVerifiedAt":"2026-08-04","commands":[{"command":"node scripts/architecture-split.mjs merge","result":"passed","summary":"Merged the six reorganized split fragments into docs/harness/ARCHITECTURE.md without manual edits to the canonical file."},{"command":"node scripts/architecture-split.mjs check","result":"passed","summary":"All six generated fragments match the canonical document."},{"command":"PowerShell ARCHITECTURE/FUSION link, fence and nine-section check","result":"passed","summary":"All scoped links resolve, Markdown fences are balanced, and the generated architecture contains exactly nine requested H2 themes."},{"command":"node scripts/harness-gate.mjs","result":"passed","summary":"Harness gate: 34 features, 0 errors."}],"manualSmoke":"Documentation-only architecture review completed; no application runtime, Fork, FUSION document, database or UI was changed."}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["维护者能从架构 SSOT 和生成分片理解系统职责、Adapter、身份状态、阶段交接、主链路、画像边界、可靠性、成熟度和待决事项，并能区分 FUSION 正式设计与 provisional 迁移参考。"],"integrationEvidence":["docs/harness/ARCHITECTURE.md","docs/harness/ARCHITECTURE/F06_ARCHITECTURE_SPLIT/README.md","docs/log/artifacts/F34/verification-summary.md"],"knownUnverified":[],"humanReviewRequired":[]}
---

# F34 Architecture Split 全局架构重组

## 目标

以当前 `ARCHITECTURE.md` 为基线，吸收 FUSION `01–04、06–08` 中已确认的系统级架构决策，重组 `F06_ARCHITECTURE_SPLIT/` 为九个全局主题，并由现有脚本生成全局架构。

## 边界

- 先编辑 split，再由 `architecture-split.mjs merge` 生成 `docs/harness/ARCHITECTURE.md`；不手工编辑全局文件。
- 只吸收系统级职责、边界、主链路和必须成立的不变量，不复制 Fusion 详细 schema、状态机、DDL、fixtures 或实现步骤。
- `FUSION/03` 只作为已审核的课前迁移参考；`FUSION/05`、`FUSION/07` 只标记为 provisional/reference，不提升其实现路径或技术决策。
- 不修改两个 Fork、FUSION 文档、应用代码、数据库或 UI。

## 验收标准

- [x] split 由九个全局主题组成：职责、Adapter、身份状态、领域交接、主链路、画像边界、完整性可靠性、成熟度、待决事项。
- [x] 六个生成分片和脚本 metadata 与九个主题一致。
- [x] `ARCHITECTURE.md` 只包含全局粒度内容，并引用 FUSION 专项规范。
- [x] 课前 `FrozenLessonGenerationContext`、课中可信事实、课后 Candidate/Receipt 主链路闭合。
- [x] 持久 Lesson Binding、Candidate 不携带 learner、planned/executed 分离和 accepted 不等于画像更新进入全局不变量。
- [x] FUSION 09/10 仅以 provisional/reference 记录，不出现其具体迁移阶段、DDL 或切换门槛。
- [x] architecture split check、Harness gate、链接和 Markdown 围栏检查通过。
