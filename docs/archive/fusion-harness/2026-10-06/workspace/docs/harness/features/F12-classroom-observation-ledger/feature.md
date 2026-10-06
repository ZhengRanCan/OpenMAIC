---
id: F12
title: 课堂观察账本
version: v0.1
status: passing
dependsOn: ["F11"]
scope: {"code":["OpenMAIC/lib/fusion/classroom-observation-ledger.ts","OpenMAIC/lib/fusion/contracts.ts","OpenMAIC/lib/fusion/adapter/**","OpenMAIC/app/api/fusion/classroom-events/route.ts","OpenMAIC/lib/fusion/scene-directive-planner.ts","OpenMAIC/lib/fusion/lesson-runtime-state.ts"],"tests":["OpenMAIC/tests/fusion/classroom-observation-ledger.test.ts","OpenMAIC/tests/fusion/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F12-classroom-observation-ledger/**","docs/log/artifacts/F12/**","docs/harness/incidents/**"]}
evidence: {"lastVerifiedAt":"2026-07-24T15:00:00+08:00","commands":[{"command":"cd OpenMAIC; vitest run tests/fusion","result":"passed","summary":"12 test files, 26 tests passed."},{"command":"range scoped eslint and git diff check","result":"passed","summary":"No lint or whitespace errors."}],"manualSmoke":"Reviewed correct/incorrect, remediation execution, and diagnosis-failure ledger projections. The ledger contains only event facts, local assessment, diagnosis summary, directive summary and association IDs; no credential, Memory, prompt, URL, attachment, or browser storage field is retained."}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["维护者可从 OpenMAIC 服务端获得一节固定 Demo 课堂的最小观察账本，其中可追溯每次 checkpoint 的题目、答案、本地评分、即时诊断和实际 Scene 指令路径。"],"integrationEvidence":["docs/log/artifacts/F12/verification-summary.md","docs/log/artifacts/F12/independent-review.md"],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"f71ac8b1b90ad439567751d4d000af1d3cafe750"}]}}
---

# F12 课堂观察账本

## 目标

在 OpenMAIC 服务端为单节课堂建立最小、可追溯的 `ClassroomObservationLedger`。它将 F09 的 Quiz 事实、F08 的即时 `LearningDiagnosis`、F10/F11 的实际 `SceneDirective` 与运行态执行结果关联到同一 `lessonSessionId`，供 F13 后续构造 `ProfileUpdateCandidate` 使用。本 Feature 不发送任何数据到 DeepTutor。

## 集成决策

- 所有权：账本是 OpenMAIC 的课堂事实记录，不是长期学生画像，也不能计算或写入 mastery、偏好、长期薄弱点或长期误解。
- 可信边界：浏览器提供的原题、答案和本地评分只能作为输入事实；`eventId`、`correlationId`、诊断关联、directive 执行结果与 lessonSessionId 必须在 OpenMAIC 服务端校验和关联。
- 最小化：每个观察仅保存 `ClassroomEvent` 的必要字段、本地评分、诊断摘要、SceneDirective 摘要、执行状态、时间戳和关联 ID；禁止原始 Memory、完整会话、附件、Token、Cookie、完整 Prompt、无关 UI 状态。
- 幂等：相同 `eventId` 或 `directiveId` 的重放不得产生重复观察；未执行的 directive 与已执行/降级指令必须可区分。
- 生命周期：本阶段账本只服务于 Development Only 单节课堂；持久化方案、跨设备恢复、数据保留期与删除 API 不在本 Feature。

## 目标模型

```text
ClassroomObservationLedger
  schemaVersion / lessonSessionId / courseId / createdAt
  observations[]
    observationId / sourceEventId / correlationId
    checkpointId / sceneId / lessonKnowledgePointIds[]
    originalQuestion / studentAnswer / localAssessment
    diagnosisSummary?       # correctness、misconception code、confidence；非原始 payload
    directiveSummary?       # directiveId、kind、reasonCode、executionStatus
    occurredAt / recordedAt
  revision
```

账本可保留即时诊断事实，但该事实不自动等同于长期画像结论。F13 只能从合格、最小化且可追溯的观察中生成候选证据。

## 范围

### 允许改动

- 在 OpenMAIC Fusion 服务端层实现观察账本、关联/幂等逻辑、最小化投影和无网络测试。
- 将现有 Quiz 事件、诊断响应、SceneDirective 及其实际执行结果写入同一课堂账本。
- 测试正确、错误、诊断失败、continue 降级、补救页执行、重复事件和重复 directive。
- 更新本 Feature 证据，并在完成时代码提交到 OpenMAIC `fusion-adapter` 分支。

### 不在范围内

- 构造/投递 `ProfileUpdateCandidate`、DeepTutor 更新 API、Outbox、SQLite、后台 Worker、课堂完成 UI 或长期画像写入。
- 修改 DeepTutor 代码、读取真实用户数据、实现真实身份、跨设备同步或将浏览器 IndexedDB 作为权威账本。

## 验收标准

- [x] 每个已提交 checkpoint 都可在服务端账本中关联原题、答案、本地评分、知识点、即时诊断与实际 Scene 指令执行结果。
- [x] 无诊断/降级、未执行 directive、补救执行和重试都被准确区分；不会伪造长期画像或成功写回。
- [x] 同一 eventId/directiveId 重放不产生重复观察；revision 与关联 ID 保持可测试的追溯关系。
- [x] 账本序列化不包含凭证、DeepTutor URL、Memory、附件、完整 Prompt、无关完整会话或浏览器私有存储。
- [x] OpenMAIC 范围测试、独立审查、Git 提交/推送证据和 Harness gate 全部通过。

## 完成证据

- 验证证据：`docs/log/artifacts/F12/verification-summary.md`
- 独立审查：`docs/log/artifacts/F12/independent-review.md`
