---
id: F40
title: 课前 Fusion 契约内核与严格解析
version: v0.1
status: passing
dependsOn: ["F39"]
scope: {"code":["OpenMAIC/**","DeepTutor/**"],"tests":["OpenMAIC/**","DeepTutor/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F40-preclass-fusion-contract-kernel/**","docs/harness/FUSION/03-pre-class-fusion-code-migration-roadmap.md","docs/harness/FUSION/10-canonical-hash-digest-and-integrity-specification.md","docs/harness/FUSION/fixtures/canonical-digest-v1.json","docs/log/artifacts/F40/**"]}
evidence: {"lastVerifiedAt":"2026-08-04T18:24:00+08:00","commands":[{"command":"OpenMAIC: pnpm exec vitest run tests/fusion/preclass-contracts.test.ts","result":"passed","detail":"12 passed"},{"command":"OpenMAIC: pnpm exec tsc --noEmit","result":"passed"},{"command":"OpenMAIC: pnpm build","result":"passed"},{"command":"DeepTutor: python -m ruff check deeptutor/fusion/preclass_contracts.py tests/fusion/test_preclass_contracts.py","result":"passed"},{"command":"DeepTutor: python -m pytest -c NUL tests/fusion/test_preclass_contracts.py -q","result":"passed","detail":"12 passed; isolated config because installed pytest rejects the repository's asyncio_default_fixture_loop_scope option"},{"command":"node scripts/harness-gate.mjs","result":"passed","detail":"Harness gate: 45 features, 0 errors"}],"manualSmoke":"Reviewed both pure contract modules: no Route, Provider, Cookie, Token, browser learner override, model, database, or existing official session path is imported or called."}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["维护者可在 OpenMAIC 与 DeepTutor 分别验证同一课前语义输入产生一致的 canonical bytes/digest，且未知字段、版本、digest、引用与 UI 命令均失败关闭。"],"integrationEvidence":["两端测试共同读取 docs/harness/FUSION/fixtures/canonical-digest-v1.json，并逐项断言 canonical JSON、UTF-8 byte length 与 SHA-256。","OpenMAIC 3844d41c31b95892d7ddca20b281990155f9c34c 与 DeepTutor 9aadeabb4d9ea82b16bdea08be3fa72a39b8da9d 已推送至各自 origin/fusion-adapter。"],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"3844d41c31b95892d7ddca20b281990155f9c34c"},{"path":"DeepTutor","branch":"fusion-adapter","commit":"9aadeabb4d9ea82b16bdea08be3fa72a39b8da9d"}]}}
---

# F40 课前 Fusion 契约内核与严格解析

## 目标

实现课堂前迁移阶段 A：在两个 Fork 中建立等价、版本化的课前语义对象、严格 parser、`fusion-c14n-v1` digest 投影和共享 fixture 验证；不改变任何正式用户路径、Provider 或课堂生成结果。

## 允许范围

- OpenMAIC 与 DeepTutor 各自实现其本地的契约 model、projection/canonicalizer、严格 request/response parser、稳定错误码和契约测试；根目录不得新增共享运行时、数据库或依赖。
- 使用 `FUSION/02` 定义的 `LessonSemanticRequest`、`PreClassTeachingContextProposal`、Map、Cognitive Projection、Guidance、Resolution 与 Frozen Context 边界，以及 `FUSION/10` 的 canonicalization SSOT。
- 复用并必要时扩展匿名合成 golden fixture；不得从真实 learner、课堂、Cookie、Token、Secret、数据库或模型读取输入。
- 记录两个 Fork 的文件范围、测试命令、独立审查、分支、commit SHA 与 push 证据。

## 明确排除

- 不新增 DeepTutor 课前 Context Route（F41）。
- 不接入 OpenMAIC Provider、Session 双写、shadow 或正式读取路径（F42/F43）。
- 不实现真实 Agent、Knowledge、Mastery 或 Memory 计算（F44）。
- 不改变旧 Profile/Map Route、固定 slope 正式兼容路径或迁移状态（F45）。
- 不自行决定 `needs_clarification`、`partial`、`unresolved` 或普通课堂恢复的产品策略。

## 必须满足的不变量

1. schema 解析先于 canonicalization；未知字段、重复 key、未知版本、无效 Unicode/时间/数字、digest 错配、越界权威引用和 UI/Scene 控制字段全部失败关闭。
2. 两端对同一 fixture 的 canonical UTF-8 bytes、byte length 和 SHA-256 结果一致；不得实现另一个课前专用 hash 算法。
3. Adapter/contract 层不接受浏览器 learner 覆盖，不透传 Cookie、Token、Secret、模型思维过程或 DeepTutor 内部数据。
4. 实现只建立契约能力；不把 fixture 或 synthetic 输出表述为真实教学决策。

## 验收标准

- [x] 两个 Fork 具有等价的版本化课前输入、Proposal、Resolution 和 Frozen Context 契约边界。
- [x] `semanticRequestDigest` 使用文档 10 的投影白名单和 golden fixtures；两端结果逐字节一致。
- [x] request/response parser 对未知字段、未知版本、digest/revision 错配、越界引用、超限载荷和 UI 命令执行失败关闭。
- [x] 共享合法与负向 fixture 驱动两端测试；不读取真实数据或调用外部模型。
- [x] 各 Fork 完成目标测试、类型/构建检查、独立审查及 branch/commit/push 证据；Harness gate 通过。
