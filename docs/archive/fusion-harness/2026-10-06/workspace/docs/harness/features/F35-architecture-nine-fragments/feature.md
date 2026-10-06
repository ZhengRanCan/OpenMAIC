---
id: F35
title: Architecture 九主题九分片
version: v0.1
status: passing
dependsOn: ["F34"]
scope: {"code":["scripts/architecture-split.mjs"],"tests":[],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F35-architecture-nine-fragments/**","docs/harness/ARCHITECTURE.md","docs/harness/ARCHITECTURE/F06_ARCHITECTURE_SPLIT/**","docs/log/artifacts/F35/**"]}
evidence: {"lastVerifiedAt":"2026-08-04","commands":[{"command":"node scripts/architecture-split.mjs split","result":"passed","summary":"Generated nine one-to-one fragments from docs/harness/ARCHITECTURE.md."},{"command":"node scripts/architecture-split.mjs check","result":"passed","summary":"All nine generated fragments match the canonical document."},{"command":"PowerShell fragment layout, link and fence check","result":"passed","summary":"Nine numbered fragments exist, each has one numbered H2, links resolve and fences are balanced."},{"command":"node scripts/harness-gate.mjs","result":"passed","summary":"Harness gate: 35 features, 0 errors."}],"manualSmoke":"Documentation generator and fragment-layout change only; architecture body and application runtime are unchanged."}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["维护者在 split 目录中看到九个主题各自对应一个独立分片，并能由同一脚本保持它们与全局 ARCHITECTURE.md 一致。"],"integrationEvidence":[],"knownUnverified":[],"humanReviewRequired":[]}
---

# F35 Architecture 九主题九分片

## 目标

将 F34 已确认的九个全局架构主题从六个历史分片调整为九个一对一生成分片，不改变架构正文和成熟度结论。

## 边界

- 更新生成器 fragment metadata、split README 和物理分片文件。
- 从现有 `ARCHITECTURE.md` 运行 `split` 生成九片；不手工改写架构正文。
- 删除旧六个生成分片；保留历史 `REVIEW.md`。
- 不修改 FUSION、两个 Fork、数据库、配置或 UI。

## 验收标准

- [x] split 目录存在九个编号分片，分别对应全局九个 H2 主题。
- [x] 每个生成分片只包含一个编号 H2 正文。
- [x] 旧六个生成分片不再存在。
- [x] README、生成器 metadata 和全局 H2 顺序一致。
- [x] `split`、`check`、链接/围栏检查和 Harness gate 通过。
