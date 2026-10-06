---
id: F07
title: Fusion 开发契约与 Adapter 骨架
version: v0.1
status: passing
dependsOn: ["F06"]
scope: {"code":["DeepTutor/integrations/openmaic/fusion/classroom-contracts.ts","DeepTutor/integrations/openmaic/fusion/dev-classroom-diagnosis.ts","DeepTutor/integrations/openmaic/fusion/tests/classroom-contracts.test.ts","OpenMAIC/lib/fusion/contracts.ts","OpenMAIC/lib/fusion/adapter/**","OpenMAIC/tests/fusion/adapter-contracts.test.ts"],"tests":["DeepTutor/integrations/openmaic/fusion/tests/**","OpenMAIC/tests/fusion/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F07-fusion-dev-contracts-and-adapter-skeleton/**","docs/log/artifacts/F07/**","docs/harness/incidents/**"]}
evidence: {"lastVerifiedAt":"2026-07-24T14:24:00+08:00","commands":[{"command":"cd DeepTutor; node --experimental-strip-types --experimental-loader ./integrations/openmaic/fusion/tests/typescript-loader.mjs --test integrations/openmaic/fusion/tests/classroom-contracts.test.ts","result":"passed","summary":"4/4 passed: JSON boundary, schema rejection, fixed mock guard, and unknown intent rejection."},{"command":"cd OpenMAIC; .\\node_modules\\.bin\\vitest.cmd run tests/fusion/adapter-contracts.test.ts","result":"passed","summary":"2/2 passed: server-side facade preserves event identity and rejects invalid configuration and intent."},{"command":"git -C DeepTutor diff --check; git -C OpenMAIC diff --check; node scripts/harness-gate.mjs","result":"passed","summary":"No whitespace errors; Harness gate reports 11 features and 0 errors."}],"manualSmoke":"Static API-boundary review confirmed the fixed Development Only mock learner and knowledge-point constants are server-side only; production and disabled configuration fail before diagnosis, and public adapter types contain no URL, token, cookie, memory, or UI directive fields."}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["维护者可在 Development Only 配置中用固定 mock learner 构造版本化 ClassroomEvent，并在不暴露 DeepTutor 传输细节的前提下经 OpenMAIC 服务端 Adapter 获得可验证的诊断领域结果。"],"integrationEvidence":["docs/log/artifacts/F07/verification-summary.md","docs/log/artifacts/F07/independent-review.md"],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"DeepTutor","branch":"fusion-adapter","commit":"6738e678ed41baf105beb4f59231fefaac30d95e"},{"path":"OpenMAIC","branch":"fusion-adapter","commit":"fd108e13182741a94a6d2294d837303d8e5d7c11"}]}}
---

# F07 Fusion 开发契约与 Adapter 骨架

## 目标

为阶段 1 的课中动态调整建立最小、版本化、可测试的领域边界：`ClassroomEvent`、`LearningDiagnosis`、`TeachingIntent` 与 `SceneDirective`，以及 OpenMAIC 服务端内部的协议无关 Adapter Facade。建立只能在本地开发/测试启用的固定 `mockLearnerId`，但不实现 DeepTutor HTTP API、Quiz UI 接入、Scene 运行时调整或长期画像写回。

## 集成决策

- 集成宿主：OpenMAIC 服务端内部 `lib/fusion/adapter/`；浏览器不得导入 Adapter Transport 或直接访问 DeepTutor。
- 权威边界：DeepTutor 仍是 `learnerId` 和长期画像的权威来源；F07 的固定 learner 是 Development Only 测试替身，不是登录身份、授权凭证或真实用户 ID。
- 开发身份：仅在显式 development/test 配置下，服务端可解析固定、合成的 `mockLearnerId`。生产配置启用它必须快速失败；浏览器输入不得指定或覆盖 learner。
- 契约：采用 F06 的 `schemaVersion`、`eventId`、`eventType`、`courseId`、`sceneId`、`correlationId`、本地评分、`correctness`、`recommendedStrategy` 与 `sourceEventId` 语义。`eventId` 是幂等键；`correlationId` 只用于追溯操作链。
- 兼容性：F01 既有 `contracts.ts` 与 `contractVersion` 是离线画像 Demo 契约，不能被破坏或伪装成 Fusion Event API。F07 另建课堂诊断契约，后续通过 JSON 传输而非跨仓库直接导入 TypeScript 源文件。
- 数据与 AI：只允许合成题目、合成答案、固定知识点和本地评分测试数据；不读 Memory/L3、数据库、会话全文或真实凭证，不调用 LLM。

## 预期开发契约

F07 完成后，后续 Feature 只能依赖以下语义，不得提前增加 UI 命令或产品专有字段：

```text
ClassroomEvent
  schemaVersion / eventId / eventType: checkpoint_submitted
  lessonSessionId / courseId / sceneId / correlationId / checkpointId
  mappingId / mappingRevision / lessonKnowledgePointIds[]
  originalQuestion / studentAnswer / localAssessment / occurredAt

LearningDiagnosis
  schemaVersion / eventId / correctness
  diagnoses[] / teachingIntent / warnings[] / createdAt

TeachingIntent
  schemaVersion / kind: continue | insert_remediation | retry_checkpoint
  targetLessonKnowledgePointIds[] / recommendedStrategy / rationaleCode?

SceneDirective
  schemaVersion / directiveId / sourceEventId / kind
  targetSceneId? / reasonCode? / expectedRuntimeRevision
```

`TeachingIntent` 不含 Scene ID、route、组件名或 UI 命令；`SceneDirective` 由 OpenMAIC 一侧的 F10 Planner 产生。`recommendedStrategy` 必须可与 Scene Catalog 的 `teachingStrategyTags` 匹配，但具体标签枚举在 F10 固化。

## 范围

### 允许改动

- 在两个 Fork 的 Fusion 边界建立同语义、版本化的开发契约、序列化/校验辅助与无网络单元测试。
- 在 OpenMAIC 服务端建立 Adapter Facade、端口和 Development Only 配置守卫；Transport 可以是可注入占位，不得由浏览器调用。
- 增加测试，证明未知版本、缺字段、伪造 learner 输入、生产 Mock 配置和未知 intent 会被明确拒绝或降级。
- 更新本 Feature 的合同、证据和必要 incident；代码完成时按各 Fork 独立 Git 闭环提交。

### 不在范围内

- 创建 DeepTutor FastAPI 路由、HTTP/WebSocket 调用、真实认证、Launch Code、服务密钥或浏览器 Cookie。
- 修改 Quiz 提交 UI、将事件发送到 DeepTutor、建立 Scene Catalog/Planner、插入补救页、重试 checkpoint 或课堂结束写回。
- 读取或更新真实画像、Memory、Mastery、Quiz 记录、数据库、Outbox 或长期学习结论。

## 验收标准

- [x] F06 规定的四个领域对象以独立的课堂诊断契约定义，含版本、关联与幂等字段；不破坏 F01 离线画像契约。
- [x] OpenMAIC 仅能经服务端 Adapter Facade 使用协议无关的诊断端口；客户端模块无法获得 DeepTutor URL、令牌或 mock learner 覆盖入口。
- [x] 固定 mock learner 和固定知识点只在 Development Only/test 显式配置下可用；生产或未配置环境明确失败，不自动回退 Mock。
- [x] 无网络的契约/边界测试覆盖合法事件、错误版本、无效 event、关联 ID 保留、未知 intent 和配置守卫。
- [x] 代码变更完成后，DeepTutor/OpenMAIC 各自通过范围内测试、独立审查、`git diff --check`、提交并推送 Git 证据，以及 `node scripts/harness-gate.mjs`。

## 风险与兼容性

- F07 的 mock identity 只为缩短课中闭环验证，不得演化为生产共享 API Key、浏览器参数或真实 learner 映射。
- 两个 Fork 暂无共享运行时包；测试必须验证 JSON 边界的兼容语义，不能以本地路径导入绕过跨应用边界。
- 真实身份、授权、服务间凭证、Profile Snapshot、知识映射和画像写回均留给后续 Integrated MVP Feature。

## 完成证据

- 验证证据：`docs/log/artifacts/F07/verification-summary.md`
- 独立审查：`docs/log/artifacts/F07/independent-review.md`
