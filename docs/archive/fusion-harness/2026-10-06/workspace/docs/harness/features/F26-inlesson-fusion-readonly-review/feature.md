---
id: F26
title: 课堂中 Fusion 只读审查
version: v0.1
status: passing
dependsOn: ["F24"]
scope: {"code":[],"tests":[],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F26-inlesson-fusion-readonly-review/**","docs/log/artifacts/F26/**"]}
evidence: {"lastVerifiedAt":"2026-07-30","commands":[{"command":"git status/log/show/diff and rg over fixed F20/F23 commits","result":"passed","summary":"Read-only cross-check of contracts, implementation, tests and Git evidence completed; no test/build/runtime command executed."}],"manualSmoke":"Not run: F26 explicitly prohibits tests, services, browsers, databases, models and real classroom commands."}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["维护者获得课堂中正式 Fusion 链路的只读审查报告，覆盖 checkpoint、诊断、SceneDirective、权威运行态和课堂观察事实。"],"integrationEvidence":["docs/log/artifacts/F26/review-report.md","docs/log/artifacts/F26/review-summary.md"],"knownUnverified":[],"humanReviewRequired":[]}
---

# F26 课堂中 Fusion 只读审查

## 目标

对课堂中正式 Fusion 链路做证据化只读审查：`checkpoint 提交 → ClassroomEvent → DeepTutor Diagnosis/TeachingIntent → SceneDirectivePlanner → RuntimeState/CAS → Scene 调整 → ClassroomObservationLedger`。主审 F07–F12 中仍被正式路径复用的实现，以及 F16–F20 的身份、Provider、Session 和持久化接入；按需检查 F23 Catalog 的输入交接。

F24 只是排期依赖，审查范围明确排除 F24 的实现、完成度、人工验收和运行产物。

## F24 v0.2 移交

F24 v0.2 只验收课前正式生成，不再以 checkpoint 提交、诊断或 Scene 调整作为通过条件。本 Feature 接收这些课中运行时链路的只读审查责任；若发现运行时问题，应如实记录为后续修复工作，不倒灌为 F24 的未完成项。

## 审查边界

- 起点：用户提交正式课堂 checkpoint。
- 终点：事件、诊断、指令和降级事实进入权威课堂观察/持久化记录。
- 不深入审查 Candidate、Outbox 和课后回执；只检查交给课后链路的课堂事实是否完整、幂等、可信。

## 重点问题

- learnerId、lessonSessionId、mapping、knowledge points、checkpointId、Catalog 和 RuntimeState 是否来自权威 Session。
- 浏览器伪造 learner、Session、mapping、revision、checkpoint、评分、Catalog 或运行态的可能性。
- Cookie/Session 交叉组合、旧 revision、其他课堂 checkpoint 和事件重放。
- diagnosis 的 scope、audience、lesson/learner binding、事件幂等、超时和失败降级。
- 本地评分与 DeepTutor diagnosis 的语义区分及最小数据传输。
- Planner 的知识点/策略匹配、retry/remediation 上限、directive 幂等和循环保护。
- CAS 并发冲突、事实保存与状态推进的原子性，以及 Provider/数据库失败后的准确状态。
- ObservationLedger 是否准确记录课堂事实并保留映射上下文。

## 只读与并行保护

- 只允许读取被审查文件及无副作用搜索/Git 命令；优先按 Feature gitEvidence 审查已提交版本。唯一允许的写入是当前 F26 报告、清单及 Registry/进度/合同状态同步。
- 不修改、重置、暂存或提交被审查代码、历史合同或其他 Feature 文件；不运行测试/构建，不启动停止服务、容器、浏览器或数据库，不调用模型。
- 工作树修改可能属于其他工作，不纳入缺陷判断；无法确认时列为待确认项。
- 不读取、输出或清理凭证、Secret、数据库内容和未脱敏课堂数据。

## 验收标准

- [x] 报告先给总体结论，并按 Critical/High/Medium/Low 列出可证实发现。
- [x] 每条发现包含文件与行号、相关 Feature/合同、触发场景、实际后果、测试缺口和建议方向。
- [x] 无充分证据的问题单列待确认项；不把 F24 状态或合同明确递延事项当作缺陷。
- [x] 报告总结课堂中链路是否闭合、课前 Catalog 输入是否可信、课后事实交接是否可靠。
- [x] 除 F26 报告和 Harness 状态同步外，审查全过程未改变代码、Git、服务、数据库、浏览器或外部状态。

## 完成证据

- 审查报告：`docs/log/artifacts/F26/review-report.md`
- 审查清单：`docs/log/artifacts/F26/review-summary.md`
