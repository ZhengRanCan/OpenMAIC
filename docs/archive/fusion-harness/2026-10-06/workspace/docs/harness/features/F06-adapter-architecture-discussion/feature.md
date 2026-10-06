---
id: F06
title: Adapter 层方案讨论
version: v0.1
status: passing
dependsOn: ["F01", "F02"]
scope: {"code":["scripts/architecture-split.mjs","scripts/harness-gate.mjs"],"tests":[],"docs":["docs/progress.md","docs/decisions.md","docs/harness/ARCHITECTURE.md","docs/harness/ARCHITECTURE/**","docs/harness/features/feature-index.json","docs/harness/features/F06-adapter-architecture-discussion/**","docs/log/artifacts/F06/**"]}
evidence: {"lastVerifiedAt":"2026-07-24","commands":[{"command":"node scripts/architecture-split.mjs check","result":"passed"},{"command":"node scripts/harness-gate.mjs","result":"passed"}],"manualSmoke":"用户已审阅并确认 Adapter 架构、契约修订、Demo/Integrated MVP 边界和分片 SSOT 维护方案。"}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["维护者能够从 ARCHITECTURE.md 了解真实 Adapter 层的部署位置、职责边界、核心契约、状态流和从 F01/F02 Demo 的迁移路径。"],"integrationEvidence":[],"knownUnverified":[],"humanReviewRequired":[]}
---

# F06 Adapter 层方案讨论

## 目标

在不实现真实跨应用集成的前提下，和用户确认 Adapter 层的架构方案，并将已确认的部署位置、职责、最小契约、身份与授权、课堂状态流、结果回写和 F01/F02 迁移路径写入 `docs/harness/ARCHITECTURE.md`。

## 集成决策

- 本 feature 只讨论和记录方案；可维护仅服务于架构文档单一真源的 harness 脚本，但不创建 Adapter API、共享包、数据库、身份系统或运行时服务。
- F01/F02 的离线 Demo 投影继续存在，不能被表述为真实 Adapter 层。
- 真实用户数据、授权、外部 AI 调用和学习结果回写均需由后续实现 feature 单独批准。

## 范围

### 允许改动

- 新建 F06 合同、验证记录和必要的长期决策。
- 扩充 `ARCHITECTURE.md` 中真实 Adapter 层的部署、接口、状态和迁移设计。
- 维护架构文档分片、交叉阅读锚点及其同步校验脚本。

### 不在范围内

- 修改 DeepTutor/OpenMAIC 代码、账户体系、存储、网络调用、模型配置或 Git 配置。
- 将讨论中的接口视为已实现或与 F01/F02 的 Demo 实现混淆。

## 验收标准

- [x] 用户确认 Adapter 层的部署位置与调用方向。
- [x] 架构文档说明最小请求/结果契约、数据 owner、身份授权与版本规则。
- [x] 架构文档说明课堂创建到结果回写的状态流、错误、取消、重试和幂等边界。
- [x] 架构文档说明 F01/F02 静态 Demo 投影迁移到真实 Adapter 的步骤与不兼容边界。

## 风险与兼容性

- 在真实身份、授权和数据最小化规则未确定前，方案不能直接进入实现。
- 讨论结论必须明确区分“已实现”“已批准待实现”和“待决定”。

## 完成证据

- 验证证据：`docs/log/artifacts/F06/verification-summary.md`
- 独立审查：不需要；本 feature 不修改 Fork 代码。
