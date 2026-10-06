---
id: F27
title: 课堂后 Fusion 只读审查
version: v0.1
status: passing
dependsOn: ["F24"]
scope: {"code":[],"tests":[],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F27-postlesson-fusion-readonly-review/**","docs/log/artifacts/F27/**"]}
evidence: {"lastVerifiedAt":"2026-07-30","commands":[{"command":"git -C OpenMAIC/DeepTutor rev-parse HEAD, branch and status","result":"passed","summary":"Reviewed clean fusion-adapter worktrees at OpenMAIC d4d6604dbf597c38957ebe6440361762a0673f1a and DeepTutor afc8af303c71d32bc144f549a628d58f310fbadc."},{"command":"read-only rg/Get-Content review of Candidate, closeout, Outbox, Worker, receipt, identity, retention and tests","result":"passed","summary":"Current committed implementation and contract evidence were cross-checked without executing code."},{"command":"git -C OpenMAIC diff c1bc1c0..d4d6604 -- reviewed post-lesson paths","result":"passed","summary":"The intervening commit only changed home-page classroom sorting and locale files; no reviewed post-lesson path changed."}],"manualSmoke":"Evidence review completed: the happy-path Candidate-to-receipt chain is connected and long-term profile ownership is stated correctly, but 5 High and 3 Medium verified implementation findings remain. F27 passing denotes completion of the read-only review, not remediation of those findings."}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["维护者获得课堂后正式 Fusion 链路的只读审查报告，覆盖 Candidate、事务性 closeout、Outbox、Worker、回执及长期画像边界。"],"integrationEvidence":["docs/log/artifacts/F27/review-report.md","docs/log/artifacts/F27/review-summary.md"],"knownUnverified":[],"humanReviewRequired":[]}
---

# F27 课堂后 Fusion 只读审查

## 目标

对课堂后正式 Fusion 链路做证据化只读审查：`权威课堂事实 → ProfileUpdateCandidate → 事务性 lesson closeout/Outbox → Worker → DeepTutor ProfileUpdateReceipt → 投递状态`。主审 F12–F15 中仍被正式路径复用的观察、Candidate、Outbox 和 closeout，以及 F16、F18–F20 的正式授权、Update Provider、PostgreSQL、Worker 和安全集成。

F24 只是排期依赖，审查范围明确排除 F24 的实现、完成度、人工验收和运行产物。

## F24 v0.2 移交

F24 v0.2 只验收课前正式生成，不再以课后 Candidate、Outbox 或回执作为通过条件。本 Feature 接收这些课后运行时链路的只读审查责任；若发现运行时问题，应如实记录为后续修复工作，不倒灌为 F24 的未完成项。

## 审查边界

- 起点：权威课堂事实用于形成 ProfileUpdateCandidate。
- 终点：DeepTutor 返回回执并由 OpenMAIC 更新 Outbox/投递状态。
- `accepted` 或 `duplicate` 不等于长期 mastery 已更新；不得把合同明确保留的长期聚合边界当作缺陷。

## 重点问题

- ObservationLedger/持久化事实是否只来自权威 Session，Candidate 是否最小化且不直接指定 mastery、长期薄弱点或偏好。
- `mapped`、`lesson_local`、`unresolved`、mapping revision 和 authoritativeRef 的来源与长期写回资格。
- 完成标记、事实读取、Candidate 生成和 Outbox 入队的事务边界；保存失败和重复 closeout 的真实性。
- candidate/event 幂等、lease、退避、重试、dead-letter、重放和重复回执。
- 短期委托过期后的 Worker 鉴权、服务凭证/受控刷新及 Token 隔离。
- Session、Outbox、credentialRef、Secret 和 payload 的存储、保留、删除及跨 learner 隔离。
- DeepTutor Update Provider 的 lesson/learner/scope/candidate 幂等校验。
- 即时课堂结论、queued/retry/dead-letter、accepted/duplicate 和长期画像未确认的状态表达。

## 只读与并行保护

- 只允许读取被审查文件及无副作用搜索/Git 命令；优先按 Feature gitEvidence 审查已提交版本。唯一允许的写入是当前 F27 报告、清单及 Registry/进度/合同状态同步。
- 不修改、重置、暂存或提交被审查代码、历史合同或其他 Feature 文件；不运行测试/构建，不启动停止 Worker、服务、容器、浏览器或数据库，不调用模型。
- 工作树修改可能属于其他工作，不纳入缺陷判断；无法确认时列为待确认项。
- 不读取、输出或清理凭证、Secret、数据库内容和未脱敏课堂数据。

## 验收标准

- [x] 报告先给总体结论，并按 Critical/High/Medium/Low 列出可证实发现。
- [x] 每条发现包含文件与行号、相关 Feature/合同、触发场景、实际后果、测试缺口和建议方向。
- [x] 无充分证据的问题单列待确认项；不把 F24 状态或合同明确递延事项当作缺陷。
- [x] 报告总结课堂后链路是否闭合，以及课堂事实到长期画像的权威边界是否准确。
- [x] 除 F27 报告和 Harness 状态同步外，审查全过程未改变代码、Git、服务、数据库、浏览器或外部状态。

## 完成证据

- 审查报告：`docs/log/artifacts/F27/review-report.md`
- 审查清单：`docs/log/artifacts/F27/review-summary.md`
