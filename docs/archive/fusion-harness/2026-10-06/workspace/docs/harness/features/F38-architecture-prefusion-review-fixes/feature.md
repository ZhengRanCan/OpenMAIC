---
id: F38
title: Architecture FUSION 审核前修订
version: v0.1
status: passing
dependsOn: ["F37"]
scope: {"code":[],"tests":[],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F38-architecture-prefusion-review-fixes/**","docs/harness/ARCHITECTURE.md","docs/harness/ARCHITECTURE/F35_ARCHITECTURE_SPLIT/**","docs/log/artifacts/F38/**"]}
evidence: {"lastVerifiedAt":"2026-08-04","commands":[{"command":"node scripts/architecture-split.mjs split","result":"passed","summary":"Regenerated the nine ARCHITECTURE split fragments from canonical after review fixes."},{"command":"node scripts/architecture-split.mjs check","result":"passed","summary":"All nine generated fragments match docs/harness/ARCHITECTURE.md."},{"command":"Manual/rg review of six requested fixes","result":"passed","summary":"Confirmed FUSION maturity numbering, branching DeepTutor pipeline, relaxed FusionSessionStore wording, retry-policy granularity, traceable object association and DeepTutor internal Quiz wording."},{"command":"Markdown link/fence check","result":"passed","summary":"Scoped ARCHITECTURE links resolve and code fences are balanced."},{"command":"node scripts/harness-gate.mjs","result":"passed","summary":"Harness gate: 38 features, 0 errors."}],"manualSmoke":"Documentation-only architecture review fixes; FUSION protocols and application runtime are unchanged."}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["维护者能够确认进入 FUSION 审核前，ARCHITECTURE 中旧 FUSION 编号、DeepTutor pipeline、FusionSessionStore 粒度、retry 策略粒度和两个轻微边界歧义已修正。"],"integrationEvidence":["docs/harness/ARCHITECTURE.md","docs/harness/ARCHITECTURE/F35_ARCHITECTURE_SPLIT/README.md","docs/log/artifacts/F38/verification-summary.md"],"knownUnverified":[],"humanReviewRequired":[]}
---

# F38 Architecture FUSION 审核前修订

## 目标

根据人工审核意见，对 `ARCHITECTURE.md` 做进入 FUSION 审核前的最小一致性修订。

## 边界

- 只修改 `ARCHITECTURE.md` 及其生成分片。
- 不修改 FUSION 协议、迁移方案或专项基础规范。
- 不修改 DeepTutor/OpenMAIC 应用代码、数据库、配置或 UI。

## 验收标准

- [x] 第 8 节 FUSION 成熟度表使用 F36 后的新编号结构。
- [x] 第 6 节 DeepTutor 画像处理流程图表达 Mastery 与 Memory/L2/L3 分支处理。
- [x] 第 3 节不把 `FusionSessionStore` 锁死为完整课堂运行态物理/逻辑载体。
- [x] 第 7 节只保留全局可靠性不变量，不锁死具体 retry 数值。
- [x] 第 4 节共同关联改为“直接或可追溯地关联”。
- [x] 第 1 节 DeepTutor Quiz 边界避免与 OpenMAIC checkpoint 混淆。
- [x] split/check、链接/围栏检查和 Harness gate 通过。
