---
id: F41
title: DeepTutor 课前语义上下文 Route
version: v0.1
status: passing
dependsOn: ["F40"]
scope: {"code":["DeepTutor/**"],"tests":["DeepTutor/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F41-deeptutor-preclass-context-route/**","docs/harness/FUSION/03-pre-class-fusion-code-migration-roadmap.md","docs/log/artifacts/F41/**"]}
evidence: {"lastVerifiedAt":"2026-08-04T19:10:00+08:00","commands":[{"command":"DeepTutor PowerShell: $fusionTests = Get-ChildItem tests/api -Filter 'test_fusion*.py'; $fusionTests += Get-ChildItem tests/fusion -Filter '*.py'; python -m pytest -c NUL $fusionTests -q","result":"passed","detail":"32 passed; the NUL config avoids the local pytest asyncio setting incompatibility"},{"command":"DeepTutor: python -m ruff check deeptutor/api/routers/fusion_preclass_context.py deeptutor/api/services/fusion_preclass_context.py deeptutor/api/services/fusion_delegation.py tests/api/test_fusion_preclass_context.py","result":"passed"},{"command":"DeepTutor: python -m compileall -q deeptutor/api/routers/fusion_preclass_context.py deeptutor/api/services/fusion_preclass_context.py","result":"passed"},{"command":"node scripts/harness-gate.mjs","result":"passed","detail":"Harness gate: 45 features, 0 errors"}],"manualSmoke":"Independent static review confirmed the new route only imports delegation validation, the F40 strict parser, and the explicit synthetic adapter. It does not call Profile/Map fixtures, Memory, Agent, Model, database, or OpenMAIC; the response never contains the authorized learner id or delegation token."}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["A valid delegated request receives one strict Proposal bound to its request id, revision, and digest; invalid authorization, session, scope, audience, expiry, size, schema, references, digest, and browser learner override fail closed."],"integrationEvidence":["The route is registered at DeepTutor POST /api/v1/fusion/pre-class/context and is available only in development/test because its source is explicitly synthetic.","The test-only Fusion app exercises the same route, using anonymized fixture data and a delegation issued for the matching lesson session."],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"DeepTutor","branch":"fusion-adapter","commit":"d4f9f01928e5452de9bf25c96ee30db629b6f9aa"}]}}
---

# F41 DeepTutor 课前语义上下文 Route

## 目标

实现课前迁移阶段 B：在 F40 的稳定契约上新增受 delegation 保护的单一 DeepTutor Pre-Class Context Route，并以显式标记的 synthetic fixture 适配器返回完整 Proposal；不接入真实 Agent 或改变 OpenMAIC 正式路径。

## 边界与验收

- 仅从经验证 delegation 推导 learner、lesson、audience、scope 与 expiry；payload 不得覆盖 learner。
- 合法请求返回共享 request ID、revision、digest 的单一 Proposal；synthetic/development 来源不可被忽略。
- 对授权、lesson、scope、expiry、载荷、schema、引用或 digest 不合法的请求失败关闭。
- 保留旧 Profile/Map Route；不实现 OpenMAIC Provider/Session 写入或真实决策链。
- 通过 DeepTutor 目标测试、独立审查、Git 证据与 Harness gate。

## 验收标准

- [x] `POST /api/v1/fusion/pre-class/context` 只接受 F40 严格解析后的 `LessonSemanticRequest`，并以 `preclass-context:read` delegation 绑定 audience、lesson session 与 expiry。
- [x] 合法匿名 fixture 请求只返回一个同 request ID/revision/digest 的 Proposal，并明确携带 `synthetic-fixture-v1` 与 `synthetic_development_source`。
- [x] 未授权或跨 lesson/scope/audience/expiry、浏览器 learner override、未知字段/schema、越权引用、digest/重复 key 和过大载荷均失败关闭。
- [x] synthetic adapter 仅在 development/test 可用；不读取或输出 learner 原始资料、token、Profile/Map、Memory、Agent、模型、数据库或 OpenMAIC 数据。
- [x] DeepTutor Fusion 回归、Ruff、编译、独立静态审查、commit/push 与 Harness gate 全部通过；既有 Profile/Map Route 未改。
