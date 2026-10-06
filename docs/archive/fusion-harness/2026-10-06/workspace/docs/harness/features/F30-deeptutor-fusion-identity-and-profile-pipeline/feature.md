---
id: F30
title: DeepTutor Fusion 身份与自动画像流水线设计
version: v0.1
status: passing
dependsOn: ["F29"]
scope: {"code":[],"tests":[],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F30-deeptutor-fusion-identity-and-profile-pipeline/**","docs/harness/FUSION/08-deeptutor-learner-state-and-identity-resolution.md","docs/harness/FUSION/09-candidate-inbox-driven-profile-pipeline.md","docs/log/artifacts/F30/**"]}
evidence: {"lastVerifiedAt":"2026-07-31","commands":[{"command":"PowerShell UTF-8 Markdown fence and scope checks","result":"passed","summary":"FUSION 06/07 code fences are balanced; FUSION 01–05 and both Forks were not modified."},{"command":"read-only DeepTutor Session, Memory, multi-user context, Mastery and current Fusion fixture inspection","result":"passed","summary":"Current implementation facts were separated from the target Lesson Binding, persistent Inbox, Fact Store and automated consolidation design."},{"command":"node scripts/harness-gate.mjs","result":"passed","summary":"30 Feature contracts, Registry/progress state and architecture split consistency passed with 0 errors."}],"manualSmoke":"Not run: F30 is a documentation-only design Feature and does not modify application code."}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["维护者能够区分 DeepTutor Session、Memory、Mastery 与 Fusion 状态，并从 Candidate 接收追溯到 Learner 解析、内部事实、Mastery 和 L2/L3 更新。"],"integrationEvidence":["docs/harness/FUSION/08-deeptutor-learner-state-and-identity-resolution.md","docs/harness/FUSION/09-candidate-inbox-driven-profile-pipeline.md","docs/log/artifacts/F30/verification-summary.md"],"knownUnverified":[],"humanReviewRequired":[]}
---

# F30 DeepTutor Fusion 身份与自动画像流水线设计

## 目标

将当前讨论形成两份独立设计文档：

1. 解释 DeepTutor 的 Session、L1/L2/L3 Memory、Mastery Progress 与多用户作用域，定稿 Fusion Learner 身份解析方向。
2. 定义 `Candidate Inbox` 事件驱动、无需人类对话的后台画像处理流水线，包括置信度来源、物理持久化、内部事实映射、Agent 边界、Mastery 更新和 Memory Consolidation。

## 设计产物

- `docs/harness/FUSION/08-deeptutor-learner-state-and-identity-resolution.md`
- `docs/harness/FUSION/09-candidate-inbox-driven-profile-pipeline.md`
- `docs/log/artifacts/F30/verification-summary.md`

## 核心边界

- 本 Feature 只归档当前讨论，不修改既有 FUSION `01–05`。
- 不修改 `ARCHITECTURE.md` 或架构分片；新文档不是 SSOT 合并。
- 不修改 OpenMAIC、DeepTutor、数据库、API、Agent prompt、模型或运行配置。
- 不宣称 Candidate Inbox、Lesson Binding、Fusion Fact Store 或自动 Consolidator 已经实现。
- OpenMAIC 不直接读取或写入 DeepTutor Memory、Mastery、Session 或用户目录。
- Candidate Receipt 只表示接收状态，不表示 Mastery 或 L3 已更新。

## 验收标准

- [x] 明确 DeepTutor Session、跨 Session Memory、Mastery Progress 和 Fusion 状态的区别。
- [x] 明确长期画像不是常驻 Agent 进程内状态，也不是单次 Session 自动形成。
- [x] 定稿以 DeepTutor 持久 Lesson Binding 为主的 Learner 解析方向，并比较替代方案。
- [x] 定义 Candidate Inbox 的事务接收、持久幂等、lease、重试和 Receipt 边界。
- [x] 区分 mapping、diagnosis、observation 和 aggregation confidence。
- [x] 定义 Fusion Fact Store、Mastery Projector 和 Memory Fusion Surface 的职责。
- [x] 定义 Agent 只产生结构化候选判断，不直接写 Mastery 或 L3。
- [x] 定义无人化 L1/L2/L3 调度、并发、失败恢复和完成语义。
- [x] Harness gate 通过，且未修改既有 `01–05` 或两个 Fork。
