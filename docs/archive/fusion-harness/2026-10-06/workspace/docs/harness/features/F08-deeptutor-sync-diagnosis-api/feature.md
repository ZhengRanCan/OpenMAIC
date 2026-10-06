---
id: F08
title: DeepTutor 同步诊断 API
version: v0.1
status: passing
dependsOn: ["F07"]
scope: {"code":["DeepTutor/deeptutor/api/main.py","DeepTutor/deeptutor/api/routers/fusion_diagnosis.py","DeepTutor/deeptutor/api/services/fusion_diagnosis.py","DeepTutor/integrations/openmaic/fusion/classroom-contracts.ts"],"tests":["DeepTutor/tests/api/test_fusion_diagnosis.py","DeepTutor/integrations/openmaic/fusion/tests/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F08-deeptutor-sync-diagnosis-api/**","docs/log/artifacts/F08/**","docs/harness/incidents/**"]}
evidence: {"lastVerifiedAt":"2026-07-24T15:00:00+08:00","commands":[{"command":"conda activate skill; python -m pytest tests/api/test_fusion_diagnosis.py","result":"passed","summary":"3/3 API tests passed."},{"command":"node --experimental-transform-types --experimental-loader ./integrations/openmaic/fusion/tests/typescript-loader.mjs --test integrations/openmaic/fusion/tests/adapter.test.ts","result":"passed","summary":"6/6 Fusion regressions passed."},{"command":"git -C DeepTutor diff --check","result":"passed","summary":"No whitespace errors."}],"manualSmoke":"Production or disabled configuration rejects before diagnosis. Responses preserve eventId and contain no learner identity, Memory, credential, Scene, route, or UI fields; incorrect is an immediate checkpoint result only."}
completionGate: {"version":"v0.1","l3":"required","userPath":["开发环境中的 OpenMAIC 服务端提交一个固定知识点的 checkpoint ClassroomEvent 后，DeepTutor 同步返回关联同一 eventId 的 LearningDiagnosis 和 TeachingIntent。"],"integrationEvidence":["docs/log/artifacts/F08/verification-summary.md","docs/log/artifacts/F08/independent-review.md"],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"DeepTutor","branch":"fusion-adapter","commit":"4a476b5fadab8e6d80660b8e359c391f025dbd7b"}]}}
---

# F08 DeepTutor 同步诊断 API

## 目标

在 DeepTutor 提供仅供 Development Only 阶段 1 使用的同步 Fusion Event API。它接收 F07 的一个固定知识点 `checkpoint_submitted` 事件，使用确定性诊断规则返回 `LearningDiagnosis` 与协议无关的 `TeachingIntent`；响应必须回显对应 `eventId`、包含 `correctness` 和 `recommendedStrategy`。

## 集成决策

- 集成宿主：DeepTutor FastAPI；新路由复用其既有应用注册方式，但具体路由、请求/响应 JSON v1 与错误码在实施前写入本 Feature evidence。
- 身份：仅允许 F07 的 Development Only server-to-server mock 配置。请求体中的 `learnerId` 不可信且不得决定身份；真实 `require_auth`、Launch Code 和委托令牌不在本 Feature 实现。
- 诊断：固定知识点和合成题目/答案采用确定性规则，无 LLM、无 WebSocket、无 Memory/L3、无数据库读写。`incorrect` 只表达本题诊断，不能写成长久弱点。
- 输出边界：DeepTutor 只返回 `LearningDiagnosis` 与 `TeachingIntent`；不得返回 Scene ID、Route、组件名、播放器命令、原始评分流或 UI 指令。

## 范围

### 允许改动

- 注册受 Development Only guard 保护的同步 Fusion 诊断路由、请求校验、确定性诊断服务和 API 测试。
- 验证合法/非法版本、固定知识点、eventId 回显、correctness 枚举、recommendedStrategy、未知事件和配置拒绝。
- 记录 API 形状、测试结果和 DeepTutor Fork 的独立 Git 证据。

### 不在范围内

- OpenMAIC UI、Adapter 调用、Scene Catalog、SceneDirective、课堂完成、画像写回或 Outbox。
- LLM 诊断、现有 Quiz Judge WebSocket 透传、真实学生记录、Memory/Mastery 聚合、真实认证或生产 API。

## 验收标准

- [x] DeepTutor 对合法固定知识点事件同步返回同一 `eventId`、合法 `correctness`、结构化 diagnosis 和含 `recommendedStrategy` 的 TeachingIntent。
- [x] 正确、错误和无法判定输入各有确定性测试；错误诊断不会改变长期画像或持久化学习数据。
- [x] 无效 schema、缺失字段、未知知识点、非 checkpoint event 和未启用 Development Only 配置均以安全、可测试的错误拒绝。
- [x] 响应不含 Scene/UI 命令、原始会话、Memory、附件、Token 或真实 learner 数据。
- [x] DeepTutor 范围测试、独立审查、Git 提交/推送证据和 Harness gate 全部通过。

## 完成证据

- 验证证据：`docs/log/artifacts/F08/verification-summary.md`
- 独立审查：`docs/log/artifacts/F08/independent-review.md`
