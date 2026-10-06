---
id: F10
title: Scene Catalog 与指令规划器
version: v0.1
status: passing
dependsOn: ["F07"]
scope: {"code":["OpenMAIC/lib/fusion/scene-catalog.ts","OpenMAIC/lib/fusion/scene-directive-planner.ts","OpenMAIC/lib/fusion/contracts.ts","OpenMAIC/lib/fusion/lesson-runtime-state.ts","OpenMAIC/lib/types/generation.ts"],"tests":["OpenMAIC/tests/fusion/scene-catalog.test.ts","OpenMAIC/tests/fusion/scene-directive-planner.test.ts","OpenMAIC/tests/fusion/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F10-scene-catalog-and-directive-planner/**","docs/log/artifacts/F10/**","docs/harness/incidents/**"]}
evidence: {"lastVerifiedAt":"2026-07-24T15:00:00+08:00","commands":[{"command":"cd OpenMAIC; vitest run tests/fusion","result":"passed","summary":"10 test files, 21 tests passed."},{"command":"range scoped eslint","result":"passed","summary":"No errors or warnings."},{"command":"git -C OpenMAIC diff --check","result":"passed","summary":"No whitespace errors."}],"manualSmoke":"The fixed catalog exposes one checkpoint and one reviewable remediation scene. Planner returns a traceable directive or a continue reason for mismatch, retry limit, duplicate event, used remediation, and revision conflict."}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["维护者可用固定 Scene Catalog、运行态和 TeachingIntent 得到可追溯且幂等的 continue、insert_remediation 或 retry_checkpoint 指令；不匹配时安全继续。"],"integrationEvidence":["docs/log/artifacts/F10/verification-summary.md","docs/log/artifacts/F10/independent-review.md"],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"91f658795383635403981b1be702364476f6ea08"}]}}
---

# F10 Scene Catalog 与指令规划器

## 目标

在 OpenMAIC 建立课堂本地的 `SceneCatalog`、`LessonRuntimeState` 与纯函数 `SceneDirectivePlanner`。它消费 F07 的 `TeachingIntent`，在固定知识点 Demo 中生成 `continue`、`insert_remediation` 或 `retry_checkpoint` 指令；Planner 不调用 DeepTutor，也不直接操纵播放器或 React UI。

## 集成决策

- 所有权：SceneCatalog、RuntimeState 与 SceneDirective 属于 OpenMAIC 课堂领域，绝不发送给 DeepTutor。
- 元数据：每个 checkpoint 显式具有 `checkpointId`、`lessonKnowledgePointIds`；补救 Scene 具有 `remediationForCheckpointId` 和 `teachingStrategyTags`。
- 匹配：`insert_remediation` 仅可选择目标知识点和 `recommendedStrategy` 都匹配、可用且未使用的补救 Scene。
- 循环保护：每 checkpoint 最多重试一次，每补救 Scene 最多使用一次；无匹配、已使用、未知 intent、revision 冲突或上限达到时返回 `continue + reasonCode`。
- 幂等：每个 SceneDirective 关联 `sourceEventId`；执行前检查 RuntimeState revision 和已执行 directive/event 记录。

## 范围

### 允许改动

- 创建最小 Scene Catalog / RuntimeState / Planner 类型、纯函数逻辑、课程生成元数据承载位置和无网络测试。
- 为阶段 1 固定知识点提供经审阅的 checkpoint 与预留 remediation Scene 元数据；不现场生成整套 PPT。
- 验证全部 intent、策略/知识点匹配、循环上限、重放、未知输入和安全降级。

### 不在范围内

- 接收 Quiz 事件或调用 DeepTutor（F09）、改动 Quiz UI、真正执行播放器跳转（F11）、生成新的实时 PPT、长期画像写回或真实知识映射 API。

## 验收标准

- [x] Scene Catalog 在课程级别冻结，并将 checkpoint、知识点、补救目标和策略标签显式关联。
- [x] Planner 对合法 intent 仅产生 F06 规定的三种指令，且所有指令带 sourceEventId、版本和运行态并发预期。
- [x] insert_remediation 只匹配正确知识点与 recommendedStrategy；不匹配/不可用时返回可追溯的 continue 降级。
- [x] retry 与 remediation 使用上限、事件重放及 revision 冲突均被测试，不能形成课堂循环或覆盖并发状态。
- [x] OpenMAIC 范围测试、独立审查、Git 提交/推送证据和 Harness gate 通过。

## 完成证据

- 验证证据：`docs/log/artifacts/F10/verification-summary.md`
- 独立审查：`docs/log/artifacts/F10/independent-review.md`
