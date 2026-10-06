---
id: F15
title: 课后闭环验收
version: v0.1
status: passing
dependsOn: ["F13", "F14"]
scope: {"code":["OpenMAIC/lib/fusion/**","OpenMAIC/lib/classroom/complete-summary.ts","OpenMAIC/components/scene-renderers/classroom-complete.tsx","OpenMAIC/lib/i18n/locales/*.json","DeepTutor/deeptutor/api/routers/fusion_profile_updates.py","DeepTutor/deeptutor/api/services/fusion_profile_updates.py"],"tests":["OpenMAIC/tests/fusion/**","OpenMAIC/tests/e2e/**","DeepTutor/tests/api/test_fusion_profile_updates.py"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F15-post-lesson-writeback-e2e/**","docs/log/artifacts/F15/**","docs/harness/incidents/**"]}
evidence: {"lastVerifiedAt":"2026-07-24T15:30:00+08:00","commands":[{"command":"OpenMAIC Fusion tests","result":"passed","summary":"30/30 passed including post-lesson closeout."},{"command":"DeepTutor profile update API tests","result":"passed","summary":"2/2 passed."},{"command":"diff checks","result":"passed","summary":"Both Forks clean."}],"manualSmoke":"Closeout returns immediately with classroom_completed and a delivery status. Queued, duplicate, save_failed, retry_scheduled, dead_letter and received are distinct; every summary says longTermProfileStatus not_confirmed."}
completionGate: {"version":"v0.1","l3":"required","userPath":["在固定 Development Only 课堂完成后，OpenMAIC 汇总课堂观察、异步入队并投递候选；课堂总结清楚区分本节即时结论、候选已接收/待重试和真实长期画像尚未确认。"],"integrationEvidence":["docs/log/artifacts/F15/verification-summary.md","docs/log/artifacts/F15/independent-review.md"],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"e71e4b64f00e3ffad7d57c19e94a0b12f921ea1e"}]}}
---

# F15 课后闭环验收

## 目标

将 F12–F14 接成完整的 Development Only 课后路径：`lesson_completed` 后 OpenMAIC 汇总观察账本、构造 Candidate 并持久化入队；Outbox Worker 异步获得 F13 Receipt；课堂总结准确展示本节即时结论和候选投递状态。该验收不把任何即时判断或 accepted Receipt 伪装为真实长期画像已更新。

## 集成决策

- 触发：只在明确的 `lesson_completed` 后创建候选；课堂完成和即时总结不等待 Worker 或 DeepTutor receipt。
- 事实与候选：只使用 F12 最小化账本；Candidate 以 F13 规则生成，Outbox 以 F14 规则投递。任何一环保存失败都必须明确记录，不能声称已后台同步。
- 总结语义：至少区分“本节课堂即时结论”“候选已入队/待重试/死信/保存失败”“DeepTutor 已接收候选”；本 Feature 不显示“真实长期画像已更新”。
- 降级：DeepTutor 不可用、Worker 暂停、receipt rejected、Outbox 保存失败和重复 Candidate 都不影响课堂结束，但必须产生可追溯状态与不泄密 reasonCode。
- 隐私：端到端记录只使用固定合成 learner/课堂；日志、截图和证据不得含真实学习数据、Token、Cookie、Memory、完整 Prompt 或完整会话。

## 范围

### 允许改动

- 将 lesson completion、Ledger、Candidate、Outbox Worker、Receipt 与课堂总结接线；实现必要 i18n/可访问状态和两端集成/E2E 测试。
- 验证 accepted、queued/retry、duplicate、rejected/dead-letter 和 Outbox 保存失败的端到端路径。
- 修复 F12–F14 中仅为课后闭环验收必需的问题，并记录原因、范围与回归结果。
- 在两个 Fork 分别完成独立审查、范围内测试、提交、推送与 Git 证据。

### 不在范围内

- 真实身份、Launch Code、生产凭证/刷新、真实 Fusion Profile API、生产数据库、长期 mastery 聚合、跨设备恢复、A2A 或真实学生课堂。
- 将一次课堂或单题结果宣称为教学有效、真实长期误区或已持久化画像。

## 验收标准

- [x] `lesson_completed` 后从 F12 账本生成一个最小 Candidate，并在不阻塞课堂完成的情况下原子入队。
- [x] Worker 成功投递时，DeepTutor 返回同一 candidateId 的 Receipt；重复投递不会产生第二条开发观察记录。
- [x] DeepTutor 不可用、可重试失败、永久拒绝、dead-letter 和 Outbox 保存失败均不阻塞完成，但课堂总结显示正确且不泄密的投递状态/reasonCode。
- [x] 课堂总结明确区分即时课堂结论、候选接收/投递状态与真实长期画像；不能将 accepted/queued 表示为长期 mastery 已改变。
- [x] 两端自动集成/E2E 测试、人工验收、独立审查、Git 证据与 Harness gate 全部通过。

## 完成证据

- 验证证据：`docs/log/artifacts/F15/verification-summary.md`
- 独立审查：`docs/log/artifacts/F15/independent-review.md`
