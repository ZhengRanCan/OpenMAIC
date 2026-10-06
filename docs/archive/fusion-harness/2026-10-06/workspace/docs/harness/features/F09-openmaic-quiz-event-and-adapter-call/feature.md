---
id: F09
title: OpenMAIC Quiz 事件采集与 Adapter 调用
version: v0.1
status: passing
dependsOn: ["F07", "F08"]
scope: {"code":["OpenMAIC/components/scene-renderers/quiz-view.tsx","OpenMAIC/app/api/fusion/classroom-events/route.ts","OpenMAIC/lib/fusion/adapter/**","OpenMAIC/lib/fusion/contracts.ts","OpenMAIC/lib/i18n/locales/*.json"],"tests":["OpenMAIC/tests/fusion/quiz-classroom-event.test.ts","OpenMAIC/tests/fusion/classroom-event-route.test.ts","OpenMAIC/tests/fusion/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F09-openmaic-quiz-event-and-adapter-call/**","docs/log/artifacts/F09/**","docs/harness/incidents/**"]}
evidence: {"lastVerifiedAt":"2026-07-24T15:00:00+08:00","commands":[{"command":"cd OpenMAIC; vitest run tests/fusion","result":"passed","summary":"8 test files, 18 tests passed."},{"command":"range scoped eslint","result":"passed","summary":"No errors or warnings."},{"command":"git -C OpenMAIC diff --check","result":"passed","summary":"No whitespace errors."}],"manualSmoke":"Quiz shows diagnostic checking, then a ready or unavailable-but-continue state. Browser code calls only the same-origin OpenMAIC route and has no DeepTutor configuration or mock learner field."}
completionGate: {"version":"v0.1","l3":"required","userPath":["学习者提交 Quiz 答案后，浏览器只向 OpenMAIC 提交最小课堂事实；OpenMAIC 服务端通过 Adapter 调用 F08 并获得关联诊断结果。"],"integrationEvidence":["docs/log/artifacts/F09/verification-summary.md","docs/log/artifacts/F09/independent-review.md"],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"ad08e049d76da52122313d2f6bf9e180a8f2814e"}]}}
---

# F09 OpenMAIC Quiz 事件采集与 Adapter 调用

## 目标

将 OpenMAIC Quiz 提交连接到 F07 Adapter 与 F08 的 Development Only 同步诊断：浏览器收集原题、学生答案和本地评分，提交给 OpenMAIC 自己的服务端路由；服务端补充可信课程、Scene、checkpoint 和固定 mock learner 上下文，构造 `ClassroomEvent` 并调用 Adapter。该 Feature 只取得和展示/保留诊断结果，不执行 Scene 调整。

## 集成决策

- 集成宿主：`components/scene-renderers/quiz-view.tsx` 与 OpenMAIC server route；浏览器不得知道 DeepTutor base URL、令牌、mock learner 或 F08 传输格式。
- 事实边界：浏览器可提供题目、答案和本地评分候选；服务端负责校验/补齐 `eventId`、`lessonSessionId`、`courseId`、`sceneId`、`checkpointId`、`correlationId` 和固定开发身份。
- 开发限制：只支持 F07/F08 的单个固定知识点和显式 Development Only 配置；无配置或诊断失败时保留正常 Quiz 行为并返回可见的 `continue + reasonCode` 语义。
- UI：遵循现有 OpenMAIC i18n 与可访问性方式，至少覆盖提交中、诊断成功、诊断失败但课堂可继续三种状态；不得把诊断描述为长期画像更新。

## 范围

### 允许改动

- Quiz 提交处的最小事件采集、OpenMAIC server route、Adapter Transport 接线、输入校验、i18n 状态和无密钥测试。
- 测试浏览器请求不带 DeepTutor 凭证/learner 覆盖字段，服务端事件字段完整，Adapter 接收响应与超时/失败安全降级。
- 更新本 Feature 证据及 OpenMAIC Fork 的独立 Git 证据。

### 不在范围内

- DeepTutor API 规则或认证实现（F08）、Scene Catalog/Planner/插页（F10）、长期写回/Outbox、真实身份或 Profile API。
- 重构整个 Quiz 系统、改变题目评分算法、浏览器直连 DeepTutor 或将诊断原始 payload 持久化到 IndexedDB。

## 验收标准

- [x] Quiz 提交生成结构完整、版本化的 `checkpoint_submitted` ClassroomEvent，包含原题、答案、本地评分、知识点与课程/Scene/checkpoint/correlation 上下文。
- [x] 浏览器只调用 OpenMAIC 同源 route；只有服务端 Adapter 调用 F08，mock learner 不能由浏览器覆盖。
- [x] F08 正常响应时，OpenMAIC 得到与提交 eventId 相同的诊断/教学意图；尚不修改 Scene 路径。
- [x] Adapter/诊断超时、不可用或响应非法时，Quiz 状态可理解、课堂继续、记录 reasonCode，且不伪造误区或长期画像结论。
- [x] OpenMAIC 测试、范围内 lint/类型检查、独立审查、Git 提交/推送证据和 Harness gate 通过。

## 完成证据

- 验证证据：`docs/log/artifacts/F09/verification-summary.md`
- 独立审查：`docs/log/artifacts/F09/independent-review.md`
