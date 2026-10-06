---
id: F25
title: 课堂前 Fusion 只读审查
version: v0.1
status: passing
dependsOn: ["F24"]
scope: {"code":[],"tests":[],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F25-prelesson-fusion-readonly-review/**","docs/log/artifacts/F25/**"]}
evidence: {"lastVerifiedAt":"2026-07-30","commands":[{"command":"git status/log/show/grep and rg over fixed F16-F23 commits","result":"passed","summary":"Read-only cross-check of contracts, implementation, tests and prior evidence completed; no test/build/runtime command executed."}],"manualSmoke":"Not run: F25 explicitly prohibits services, browsers, databases, models and real generation."}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["维护者获得课堂前正式 Fusion 链路的只读审查报告，覆盖 Launch、授权、快照、Session、个性化生成和向课中 Catalog 的交接。"],"integrationEvidence":["docs/log/artifacts/F25/review-report.md","docs/log/artifacts/F25/review-summary.md"],"knownUnverified":[],"humanReviewRequired":[]}
---

# F25 课堂前 Fusion 只读审查

## 目标

对已经完成的课堂前正式 Fusion 链路做证据化只读审查：`Launch Code → 委托交换 → Profile/Map 快照 → FusionSessionRecord → 教学上下文 → outline/content/actions → checkpoint/remediation Catalog`。主审 F16–F23，按需审查 F06 架构、F01/F02 Demo 隔离及被正式路径调用的早期 Fusion 代码。

F24 只是排期依赖，审查范围明确排除 F24 的实现、完成度、人工验收和运行产物。

## 审查边界

- 起点：DeepTutor 为已授权合成身份签发一次性 Launch Code。
- 终点：OpenMAIC 已生成并冻结可交给课中链路的 Scene/checkpoint/remediation Catalog。
- 不深入审查 checkpoint 提交后的诊断、Scene 调整和课后 Outbox；只检查交接数据是否完整、可信。
- 检查正式 Fusion、普通 OpenMAIC 课堂、F02 Demo 与 Development Mock 是否严格隔离。

## 重点问题

- Launch Code 的 allowlist、TTL、一次性消费、重放、撤销、audience 和 scope。
- learnerId、lessonSessionId、委托凭证、ProfileSnapshot 和 LessonKnowledgeMap 的绑定。
- HttpOnly Cookie 与请求 Session 的匹配、跨 learner/跨 Session 访问和过期恢复。
- 浏览器是否能覆盖 learner、画像、Map、revision、教学上下文、课堂要求、大纲或 Catalog。
- outline/content/actions 是否使用同一冻结上下文；二次生成、换题和 DeepTutor 暂时不可用时的行为。
- checkpoint/remediation 与冻结知识映射、F10 Catalog/Planner 的交接。
- 数据最小化、日志/响应泄露、数据库失败和正式路径错误回退 Demo/Mock/普通课堂。
- F23 合同内 15 分钟固定短课堂边界；合同明确递延的长会话续期不作为缺陷。

## 只读与并行保护

- 只允许读取被审查文件以及 `rg`、`git status`、`git log`、`git show`、`git diff` 等无副作用命令；唯一允许的写入是当前 F25 的审查报告、清单及 Registry/进度/合同状态同步。
- 不修改、格式化、重置、暂存或提交被审查代码、历史合同或其他 Feature 文件；不切换分支、push、启动/停止服务、容器、浏览器或数据库；不调用模型或执行真实生成。
- 工作树修改和临时产物可能属于其他工作，优先按各 Feature 的 `completionGate.gitEvidence` 审查已提交版本；无法确认时列为待确认项。
- 不读取、输出或清理 Token、Cookie、`.env`、Secret、数据库内容或未脱敏课堂数据。

## 验收标准

- [x] 报告先给总体结论，并按 Critical/High/Medium/Low 列出可证实发现。
- [x] 每条发现包含文件与行号、相关 Feature/合同、触发场景、实际后果、测试缺口和建议方向。
- [x] 无充分证据的问题单列待确认项；不把 F24 状态或合同明确递延事项当作缺陷。
- [x] 报告总结课堂前链路是否闭合，以及交给课中链路的 Catalog 是否完整、可信。
- [x] 除 F25 报告和 Harness 状态同步外，审查全过程未改变代码、Git、服务、数据库、浏览器或外部状态。

## 完成证据

- 审查报告：`docs/log/artifacts/F25/review-report.md`
- 审查清单：`docs/log/artifacts/F25/review-summary.md`
