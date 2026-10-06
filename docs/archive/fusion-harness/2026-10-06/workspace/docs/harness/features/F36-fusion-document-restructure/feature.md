---
id: F36
title: Fusion 文档编号与职责重组
version: v0.1
status: passing
dependsOn: ["F35"]
scope: {"code":["scripts/architecture-split.mjs"],"tests":[],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F36-fusion-document-restructure/**","docs/harness/FUSION/**","docs/harness/ARCHITECTURE.md","docs/harness/ARCHITECTURE/F35_ARCHITECTURE_SPLIT/**","docs/log/artifacts/F36/**"]}
evidence: {"lastVerifiedAt":"2026-08-04","commands":[{"command":"node scripts/architecture-split.mjs split","result":"passed","summary":"Regenerated ARCHITECTURE split fragments after updating FUSION references."},{"command":"node scripts/architecture-split.mjs check","result":"passed","summary":"All nine ARCHITECTURE fragments match the canonical document."},{"command":"Markdown link/fence and stale-reference scan","result":"passed","summary":"FUSION/ARCHITECTURE scoped links resolve, code fences are balanced, and stale FUSION route references were removed."},{"command":"node scripts/harness-gate.mjs","result":"passed","summary":"Harness gate: 36 features, 0 errors."}],"manualSmoke":"Documentation restructure only; protocol design and application runtime are unchanged."}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["维护者能从 FUSION 01–10 按路由、阶段协议、阶段迁移和专项基础规范快速定位文档，并确认 ARCHITECTURE 引用均指向新编号。"],"integrationEvidence":["docs/harness/FUSION/01-fusion-document-routing-and-reading-index.md","docs/harness/ARCHITECTURE.md","docs/log/artifacts/F36/verification-summary.md"],"knownUnverified":[],"humanReviewRequired":[]}
---

# F36 Fusion 文档编号与职责重组

## 目标

将 `docs/harness/FUSION/` 按用户指定的 01–10 职责重新编号和收敛：01 只做路由，02/04/06 只做阶段协议，03/05/07 只做阶段迁移，08/09/10 作为跨阶段或专项基础规范。

## 边界

- 保持现有协议设计不变，只做文档重组、职责收敛和链接修正。
- 不修改 DeepTutor/OpenMAIC 应用代码、数据库、配置或 UI。
- 课中、课后迁移继续标记为 provisional/reference。
- `ARCHITECTURE.md` 保持全局架构 SSOT，FUSION 只承接专项细节。

## 验收标准

- [x] FUSION 目录按目标 01–10 文件结构存在，旧编号文件不再存在。
- [x] 01 只承担路由和阅读索引，不再定义全局架构。
- [x] 02/04/06 阶段协议与 03/05/07 阶段迁移职责清晰分离。
- [x] 08/09/10 作为跨阶段或专项基础规范，内部引用指向新编号。
- [x] ARCHITECTURE 与生成分片中的 FUSION 引用均指向新编号。
- [x] ARCHITECTURE 与 FUSION 无明显规范冲突、重复 SSOT 或失效链接。
