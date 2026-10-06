---
id: F04
title: Harness 文档整理
version: v0.1
status: passing
dependsOn: []
scope: {"code":["scripts/harness-gate.mjs"],"tests":[],"docs":["AGENTS.md","docs/progress.md","docs/git-workflow.md","docs/classroom-review-workflow.md","docs/harness/PRODUCT_SPEC.md","docs/harness/CONSTRAINTS.md","docs/harness/ARCHITECTURE.md","docs/harness/DESIGN.md","docs/harness/INITIALIZATION_CONTRACT.md","docs/harness/README.md","docs/harness/lessons.jsonl","docs/harness/incidents/README.md","docs/harness/features/feature-index.json","docs/harness/features/README.md","docs/harness/features/feature-template.md","docs/harness/features/verification-template.md","docs/harness/features/F01-simulated-deeptutor-profile/feature.md","docs/harness/features/F02-profile-driven-ppt/feature.md","docs/harness/features/F03-classroom-manifest-audit/feature.md","docs/harness/features/F04-harness-documentation/**","docs/log/artifacts/F04/**"]}
evidence: {"lastVerifiedAt":"2026-07-23T00:00:00.000Z","commands":[{"command":"node --check scripts/harness-gate.mjs","result":"passed","runAt":"2026-07-23","summary":"Harness gate 脚本语法检查通过。"},{"command":"node scripts/harness-gate.mjs","result":"passed","runAt":"2026-07-23","summary":"4 features，0 errors。"},{"command":"rg -n 'harness/README|lessons\\.jsonl|DeepTutor-main|OpenMAIC-main' AGENTS.md docs scripts --glob '!docs/harness/features/F04-harness-documentation/**' --glob '!docs/log/artifacts/F04/**'","result":"passed","runAt":"2026-07-23","summary":"未发现过时活动引用。"}],"manualSmoke":"人工复核 AGENTS 路由、Feature Registry 流程及 F01/F02 离线 Demo 与未来生产适配层的区分；结果一致。"}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["维护者能从 AGENTS 与 Feature Registry 找到当前任务、所需文档和本地验证入口。"],"integrationEvidence":[],"knownUnverified":[],"humanReviewRequired":[]}
---

# F04 Harness 文档整理

## 目标

将根级 harness 文档整理为当前工作区的可靠操作入口：移除重复和空文档，修正过时目录名，明确 F01/F02 已实现的离线适配边界，并把任务路由、Feature 工作流和本地验证规则放在清晰且不重复的位置。

## 集成决策

- 集成宿主：无。本 feature 只维护根级 harness，不修改 DeepTutor 或 OpenMAIC 的运行时。
- 身份与授权所有者：不适用；不得新增或记录真实用户、凭证或外部服务配置。
- 权威数据所有者：harness 文档是工作流程规则的权威来源；两个 Fork 仍各自拥有代码、依赖、Git 历史与运行命令。
- 版本化契约：不新增运行时契约。文档只能描述已存在的 F01/F02 Demo 投影与未来生产适配层的边界。
- 外部 AI/数据：无。

## 范围

### 允许改动

- 精简 `AGENTS.md`，将按任务类型的路由合并到一个入口；将标准 Feature 工作流集中到 `docs/harness/features/README.md`。
- 删除重复的 `docs/harness/README.md` 与空的 `docs/harness/lessons.jsonl`，并清理所有活动引用。
- 更新产品、架构、约束、设计和本地验证说明，使其使用实际的 `DeepTutor/`、`OpenMAIC/` 目录并准确描述 F01/F02。
- 修正 F01–F03 合同、模板和 incident 文档中受上述删除影响的路径或流程引用。
- 记录本 feature 的验证摘要。

### 不在范围内

- 修改任一 Fork 的业务代码、依赖、运行环境、Git 分支、远程或上游配置。
- 改变 F01/F02/F03 的产品目标、验收结论或实现状态；F03 仅因优先级暂停。
- 建立根级 Git 仓库、统一包管理、生产集成 API、真实身份授权或数据迁移。

## 验收标准

- [x] `AGENTS.md` 不再重复标准工作流程，并能按任务类型路由到所需文档。
- [x] Feature Registry 集中包含选择、创建和通过门禁流程，且模板包含 Fork 代码 feature 的 Git 证据要求。
- [x] 核心 harness 文档不含过时的 `DeepTutor-main`、`OpenMAIC-main`、已删除 README 或 `lessons.jsonl` 活动引用。
- [x] 产品与架构明确区分 F01/F02 已实现的离线 Demo 适配和未来的生产集成适配层。
- [x] 本地运行说明使用实际目录和当前 OpenMAIC Windows 启动入口；F04 验证命令通过。

## 风险与兼容性

- 文档改动可能误导后续 feature，因此只描述已验证事实；未来生产集成仍须由独立 feature 决策。
- 根目录不是 Git 仓库。本 feature 不产生 Fork 代码改动，不能伪造提交/推送证据；若未来为 harness 建立版本库，需另行纳入流程。

## 完成证据

- 验证证据：`docs/log/artifacts/F04/verification-summary.md`
- 独立审查：不需要；本 feature 不修改 Fork 代码。
