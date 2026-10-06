---
id: F11
title: 课中动态调整端到端验收
version: v0.1
status: passing
dependsOn: ["F08", "F09", "F10"]
scope: {"code":["DeepTutor/deeptutor/api/routers/fusion_diagnosis.py","DeepTutor/deeptutor/api/services/fusion_diagnosis.py","OpenMAIC/components/scene-renderers/quiz-view.tsx","OpenMAIC/app/api/fusion/classroom-events/route.ts","OpenMAIC/lib/fusion/**","OpenMAIC/lib/i18n/locales/*.json"],"tests":["DeepTutor/tests/api/test_fusion_diagnosis.py","OpenMAIC/tests/fusion/**","OpenMAIC/tests/e2e/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F11-in-class-dynamic-adjustment-e2e/**","docs/log/artifacts/F11/**","docs/harness/incidents/**"]}
evidence: {"lastVerifiedAt":"2026-07-24T15:00:00+08:00","commands":[{"command":"conda activate skill; python -m pytest tests/api/test_fusion_diagnosis.py","result":"passed","summary":"3/3 DeepTutor Development Only diagnosis API tests passed."},{"command":"cd OpenMAIC; vitest run tests/fusion","result":"passed","summary":"11 test files, 24 tests passed including in-class adjustment paths."},{"command":"range scoped eslint plus git diff check","result":"passed","summary":"No lint errors or whitespace errors."}],"manualSmoke":"Reviewed correct, incorrect/remediation, unmatched-or-used fallback, and unavailable-diagnosis paths. UI labels describe immediate diagnosis and continue behavior only; browser uses a same-origin OpenMAIC request and receives no DeepTutor configuration, mock learner, memory, or raw transport payload."}
completionGate: {"version":"v0.1","l3":"required","userPath":["开发者在 Development Only 的固定课程中故意答错一个 checkpoint 后，OpenMAIC 通过 DeepTutor 同步诊断插入一个匹配的补救 Scene；无匹配或诊断失败时课堂安全继续。"],"integrationEvidence":["docs/log/artifacts/F11/verification-summary.md","docs/log/artifacts/F11/independent-review.md"],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"70490ce45c76e6c9b1030861b4200a3e7e16c169"}]}}
---

# F11 课中动态调整端到端验收

## 目标

完成并验收阶段 1 的 Development Only 课中闭环：学习者在固定 checkpoint 答题，OpenMAIC 服务端提交 ClassroomEvent，DeepTutor 同步返回诊断与教学意图，OpenMAIC Planner 产生并幂等执行 SceneDirective。错误答案插入匹配补救 Scene；无匹配、重复、达到上限或诊断不可用时安全继续原路径。

## 集成决策

- 依赖：F08 提供同步诊断，F09 提供 Quiz 事件/Adapter 调用，F10 提供 Catalog/Planner；F11 只做接线、必要修复和端到端证明，不重定义契约。
- 部署：两个本地服务独立启动，浏览器仅连 OpenMAIC；DeepTutor 仅接受 OpenMAIC 服务端的 Development Only 调用。
- 课堂调整：只执行预生成/预留的补救 Scene 或当前 checkpoint 重试；不实时重生成整套 PPT，不允许任意历史跳转。
- 失败语义：诊断失败、错误 API 响应、找不到匹配 Scene、Scene 已使用或 retry 超限都显示可理解状态并走 `continue + reasonCode`；不伪造长期画像结果。

## 范围

### 允许改动

- 接线 F08/F09/F10、必要的播放器/课堂运行态执行、用户可见状态、E2E/集成测试与脱敏人工烟测材料。
- 修复只为满足阶段 1 验收所必需的 F08/F09/F10 缺陷，并将原因与验证记录在 evidence。
- 在两个 Fork 分别完成范围内验证、独立审查、提交和推送。

### 不在范围内

- 真实身份、Launch Code、真实 Profile API、动态知识映射、长期 ProfileUpdateCandidate、Outbox、服务密钥、生产数据库或 A2A。
- 将 Demo 结果宣称为真实学习效果、真实长期误区或生产认证成功。

## 验收标准

- [x] 错误的固定 checkpoint 答案产生可追溯 ClassroomEvent；DeepTutor 回传相同 eventId 的 incorrect/partially_correct 诊断和匹配策略；OpenMAIC 插入一次匹配 remediation Scene。
- [x] 正确答案走 continue；retry intent 只重试当前 checkpoint 一次；相同 eventId/directive 重放不会重复插入或重复跳转。
- [x] 无匹配策略/知识点、补救 Scene 已用、retry 超限、DeepTutor 不可用和非法响应均降级 continue，并显示/记录不泄密 reasonCode。
- [x] 浏览器 Network 仅显示 OpenMAIC 请求；DeepTutor URL、凭证、mock learner、原始诊断传输和 Memory 不泄露至客户端。
- [x] 自动集成/E2E 测试与人工四路径烟测通过；两 Fork 的独立审查、Git 证据和 Harness gate 均通过。

## 完成证据

- 验证证据：`docs/log/artifacts/F11/verification-summary.md`
- 独立审查：`docs/log/artifacts/F11/independent-review.md`
