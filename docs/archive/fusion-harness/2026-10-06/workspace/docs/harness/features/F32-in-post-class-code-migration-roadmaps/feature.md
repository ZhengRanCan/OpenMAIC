---
id: F32
title: Fusion 课中与课后代码迁移路线
version: v0.1
status: passing
dependsOn: ["F31"]
scope: {"code":[],"tests":[],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F32-in-post-class-code-migration-roadmaps/**","docs/harness/FUSION/05-in-class-fusion-code-migration-roadmap.md","docs/harness/FUSION/07-post-class-fusion-code-migration-roadmap.md","docs/log/artifacts/F32/**"]}
evidence: {"lastVerifiedAt":"2026-07-31","commands":[{"command":"read-only review of current OpenMAIC/DeepTutor in-class and post-class routes, stores, contracts, workers, identity and receipt paths","result":"passed","summary":"Current HEADs match F26/F27 baselines; 18 referenced component paths were mapped to reuse, extend, add, replace or retire decisions."},{"command":"PowerShell roadmap structure, code-path existence, finding-count and Markdown fence checks","result":"passed","summary":"Both roadmaps contain database, dual-track, shadow, rollback, retirement and ledgers; F26 7/7 and F27 8/8 findings are covered; all fences are balanced."},{"command":"node scripts/harness-gate.mjs","result":"passed","summary":"32 Feature contracts, Registry/progress state and architecture split consistency passed with 0 errors."}],"manualSmoke":"Not run: F32 is a documentation-only migration review and does not modify application runtime or databases."}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["维护者能从当前 OpenMAIC/DeepTutor 组件追溯到课中和课后目标组件、数据库迁移、兼容阶段、shadow 证据、回滚点、退役条件及课前依赖。"],"integrationEvidence":["docs/harness/FUSION/05-in-class-fusion-code-migration-roadmap.md","docs/harness/FUSION/07-post-class-fusion-code-migration-roadmap.md","docs/log/artifacts/F32/current-component-and-finding-trace.md","docs/log/artifacts/F32/verification-summary.md"],"knownUnverified":[],"humanReviewRequired":[]}
---

# F32 Fusion 课中与课后代码迁移路线

## 目标

参照课前代码迁移路线的结构，对照当前两个 Fork、F26/F27 审查和 F29–F31 目标设计，完成：

1. 课中 Fusion 代码迁移路线。
2. 课后 Fusion 代码迁移路线。
3. 当前组件到目标组件的处置与证据追踪。

两份路线均覆盖：

- 现状组件处置矩阵。
- 数据库 migration 与兼容读写。
- legacy/new 双轨和 shadow 验证。
- 分阶段回滚、旧路径退役与状态台账。
- 每阶段完成判据与实现 Feature 拆分。
- `FrozenLessonGenerationContext` 及 canonical digest 的前置门禁。

## 产物

- `docs/harness/FUSION/05-in-class-fusion-code-migration-roadmap.md`
- `docs/harness/FUSION/07-post-class-fusion-code-migration-roadmap.md`
- `docs/log/artifacts/F32/current-component-and-finding-trace.md`
- `docs/log/artifacts/F32/verification-summary.md`

## 边界

- 只读审查 OpenMAIC/DeepTutor，不修改业务代码、测试、配置、数据库或依赖。
- 不修改 FUSION `01–08`、`ARCHITECTURE.md` 或架构分片。
- 不把目标组件、migration、shadow 或切换阶段表述为已实现。
- 不运行服务、模型、数据库、容器或浏览器，不读取真实课堂、用户、Token 或 Secret。
- 路线图必须承认 F26/F27 findings 尚未修复；`passing` 只表示迁移设计完成。

## 验收标准

- [x] 两份路线均包含当前代码基线与端到端目标路径。
- [x] 两份路线均包含复用、扩展、新增、替换和退役处置矩阵。
- [x] 数据库表/字段变化、回填、兼容读写、约束启用和清理顺序明确。
- [x] legacy/new 双轨、shadow 输入输出、差异分级和切换门槛明确。
- [x] 每阶段具有回滚点、不可逆边界、旧路径退役条件和状态台账。
- [x] 课中正式切换受 `FrozenLessonGenerationContext`、canonical digest 和 Map revision 门禁约束。
- [x] F26 的 7 项和 F27 的 8 项 findings 均映射到迁移阶段或完成判据。
- [x] 后续工作拆成小型、可独立验证的代码 Feature，不形成一次性大迁移。
- [x] Harness gate 通过，且未修改两个 Fork或 FUSION `01–08`。
