---
id: F39
title: FUSION 协议一致性收口
version: v0.1
status: passing
dependsOn: ["F38"]
scope: {"code":[],"tests":[],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F39-fusion-protocol-consistency-closure/**","docs/harness/FUSION/02-pre-class-semantic-exchange-protocol.md","docs/harness/FUSION/06-post-class-semantic-exchange-protocol.md","docs/harness/FUSION/09-candidate-inbox-driven-profile-pipeline.md","docs/harness/FUSION/10-canonical-hash-digest-and-integrity-specification.md","docs/harness/FUSION/fixtures/canonical-digest-v1.json","docs/log/artifacts/F39/**"]}
evidence: {"lastVerifiedAt":"2026-08-04","commands":[{"command":"Manual/rg review of FUSION 02/06/09/10 consistency points","result":"passed","summary":"Confirmed 09 branching pipeline, 06 provenance fields, Candidate confidence TBD status, 10 semanticRequestDigest wording, 09 Receipt SSOT reference and 02/10 digest projection mapping."},{"command":"Node fixture JSON and SHA-256 verification","result":"passed","summary":"canonical-digest-v1.json parses; all success fixture byte lengths and SHA-256 values match canonicalJson; profile-update-candidate fixture no longer includes generic confidence."},{"command":"Scoped Markdown link/fence check","result":"passed","summary":"Scoped links resolve and Markdown code fences are balanced."},{"command":"node scripts/harness-gate.mjs","result":"passed","summary":"Harness gate: 39 features, 0 errors."}],"manualSmoke":"Documentation and fixture consistency fixes only; no directory renumbering, migration status change or application runtime change."}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["维护者能够确认 FUSION 06/09/10 对 Candidate provenance、confidence、Receipt、semanticRequestDigest 语义和 digest projection mapping 已一致，且 09 的画像流水线文字与 Mermaid 不冲突。"],"integrationEvidence":["docs/harness/FUSION/06-post-class-semantic-exchange-protocol.md","docs/harness/FUSION/09-candidate-inbox-driven-profile-pipeline.md","docs/harness/FUSION/10-canonical-hash-digest-and-integrity-specification.md","docs/harness/FUSION/fixtures/canonical-digest-v1.json","docs/log/artifacts/F39/verification-summary.md"],"knownUnverified":[],"humanReviewRequired":[]}
---

# F39 FUSION 协议一致性收口

## 目标

在不调整目录和编号的前提下，修正 FUSION 协议之间的规范漂移：09 流程文字、06 Candidate provenance、09/10 confidence 状态、10 semanticRequestDigest 表述、09 Receipt SSOT 和 02↔10 digest projection mapping。

## 边界

- 不重组文件、不改编号。
- 不修改 03/05/07 迁移路线成熟度；05/07 继续为 provisional/reference。
- 不修改 DeepTutor/OpenMAIC 应用代码、数据库、配置或 UI。

## 验收标准

- [x] 09 主流程文字与 Mermaid 均表达 Mastery 与 Memory/L2-L3 分支投影。
- [x] 06 Candidate provenance 定义 `sourceDiagnosisId?` 与 `diagnosisRevision?`，并声明 diagnosis 来源时的要求。
- [x] 06 不再把 generic `confidence?` 固定为 Candidate wire 字段；confidence schema 保持待定。
- [x] 10 的 `canonicalPayloadHash` base profile 不再宣称 finalized generic confidence；fixture 同步。
- [x] 10 的 `semanticRequestDigest` 说明不再过度声称能证明 Map/Profile/Guidance 内容完整性。
- [x] 09 Receipt 状态引用 06，不再复制缺少 `queued` 的枚举。
- [x] 02/10 明确 raw intent 到 digest profile 的规范化映射关系。
- [x] 链接/围栏检查、fixture JSON 校验和 Harness gate 通过。
