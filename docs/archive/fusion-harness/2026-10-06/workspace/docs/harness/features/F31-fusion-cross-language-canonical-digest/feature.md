---
id: F31
title: Fusion 跨语言 Canonical Digest 规范
version: v0.1
status: passing
dependsOn: ["F30"]
scope: {"code":[],"tests":[],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F31-fusion-cross-language-canonical-digest/**","docs/harness/FUSION/10-canonical-hash-digest-and-integrity-specification.md","docs/harness/FUSION/fixtures/canonical-digest-v1.json","docs/log/artifacts/F31/**"]}
evidence: {"lastVerifiedAt":"2026-07-31","commands":[{"command":"Node.js canonical JSON, reversed-key-order, UTF-8 byte length and SHA-256 fixture verification","result":"passed","summary":"All 3 digest purposes matched golden canonical bytes and SHA-256; reversing object insertion order did not change results."},{"command":"Python independent canonical JSON, UTF-8 byte length and SHA-256 fixture verification","result":"passed","summary":"All 3 success fixtures matched the same canonical bytes and SHA-256 as Node.js."},{"command":"PowerShell JSON uniqueness, placeholder, Markdown fence and scope checks","result":"passed","summary":"Fixture parsed with unique IDs and no placeholders; specification fences were balanced; FUSION 01–07 and both Forks were not modified."},{"command":"node scripts/harness-gate.mjs","result":"passed","summary":"31 Feature contracts, Registry/progress state and architecture split consistency passed with 0 errors."}],"manualSmoke":"Not run: F31 is a documentation and synthetic fixture Feature with no application runtime changes."}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["维护者无需了解哈希内部原理，也能根据规范判断某个字段是否参与摘要，并让 TypeScript/Python 对相同语义输入产生相同 canonical bytes 与 SHA-256。"],"integrationEvidence":["docs/harness/FUSION/10-canonical-hash-digest-and-integrity-specification.md","docs/harness/FUSION/fixtures/canonical-digest-v1.json","docs/log/artifacts/F31/verification-summary.md"],"knownUnverified":[],"humanReviewRequired":[]}
---

# F31 Fusion 跨语言 Canonical Digest 规范

## 目标

关闭 F29 可行性审查的第一个高优先级缺口，为 `semanticRequestDigest`、`factSetDigest` 和 `canonicalPayloadHash` 定义唯一、版本化、可跨 TypeScript/Python 复现的算法。

规范覆盖：

1. 先按具体 digest 类型投影允许字段，再执行通用语义规范化。
2. Unicode、时间、数字、空值、数组和对象字段的处理。
3. RFC 8785 JSON Canonicalization Scheme 与 SHA-256 输出。
4. 三种 digest 的字段白名单、排除字段和重算边界。
5. TypeScript/Python 共用 golden fixtures 与失败条件。

## 产物

- `docs/harness/FUSION/10-canonical-hash-digest-and-integrity-specification.md`
- `docs/harness/FUSION/fixtures/canonical-digest-v1.json`
- `docs/log/artifacts/F31/verification-summary.md`

## 边界

- 本 Feature 只定稿规范，不在 OpenMAIC 或 DeepTutor 实现 canonicalizer。
- 不修改 FUSION `01–07`、`ARCHITECTURE.md` 或架构分片。
- 不改变现有数据库、API、Receipt 或 Candidate 运行时行为。
- fixture 只包含合成数据，不包含真实 learner、课堂、Token 或材料正文。
- 规范以 schema-specific projection 为前置，不允许对任意运行时对象直接 `JSON.stringify` 后计算 hash。

## 验收标准

- [x] 定义完整的 canonicalization pipeline 和版本标识。
- [x] 明确对象排序、数组、Unicode、时间、整数、小数、负零、null、缺失字段和默认值规则。
- [x] 分别定义三种 digest 的语义输入与排除字段。
- [x] 使用字段白名单和 domain separation，防止新增元数据或跨用途复用改变语义。
- [x] 提供可由 TypeScript/Python 共同消费的 golden fixtures，包含正常与拒绝样例。
- [x] 所有 golden fixture 的 canonical UTF-8 长度和 SHA-256 均经独立命令重算一致。
- [x] Harness gate 通过，且未修改两个 Fork或 FUSION `01–07`。
