---
id: F20
title: Integrated MVP 安全与端到端验收
version: v0.1
status: passing
dependsOn: ["F19"]
scope: {"code":["DeepTutor/deeptutor/api/routers/fusion_*.py","DeepTutor/deeptutor/api/services/fusion_*.py","OpenMAIC/app/api/fusion/**","OpenMAIC/lib/fusion/**","OpenMAIC/components/scene-renderers/quiz-view.tsx","OpenMAIC/components/scene-renderers/classroom-complete.tsx","OpenMAIC/lib/classroom/complete-summary.ts","OpenMAIC/lib/i18n/locales/*.json","OpenMAIC/.env.example","OpenMAIC/docker-compose.yml"],"tests":["DeepTutor/tests/api/test_fusion_*.py","OpenMAIC/tests/fusion/**","OpenMAIC/tests/e2e/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F20-integrated-mvp-security-and-e2e/**","docs/log/artifacts/F20/**","docs/harness/incidents/**"]}
evidence: {"lastVerifiedAt":"2026-07-26","commands":[{"command":"cd OpenMAIC && corepack pnpm test","result":"passed"},{"command":"cd OpenMAIC && .\\node_modules\\.bin\\tsc.cmd --noEmit","result":"passed"},{"command":"cd OpenMAIC && .\\node_modules\\.bin\\eslint.cmd app/api/fusion/classroom-events/route.ts lib/fusion/persistent-lesson.ts lib/fusion/session-store/postgres.ts tests/fusion/classroom-event-route.test.ts","result":"passed"},{"command":"cd DeepTutor && python -m py_compile deeptutor/api/routers/fusion_profile_updates.py deeptutor/api/services/fusion_delegation.py deeptutor/api/routers/fusion_test_app.py tests/api/test_fusion_profile_updates.py tests/api/test_fusion_test_app.py","result":"passed"},{"command":"Local Docker: launch → frozen snapshots → authoritative diagnosis → transactional closeout → restricted Worker accepted → duplicate → credential-isolation check","result":"passed"},{"command":"node scripts/harness-gate.mjs","result":"passed"}],"manualSmoke":"仅 ENVIRONMENT=test 与 allowlist 合成 learner，在一次性 Docker PostgreSQL、仓库外 Secret 文件和本地隔离 DeepTutor host 上完成；所有一次性配置、Cookie 文件、服务进程与 Docker 卷已清理。课堂事实与权威 Session 的 CAS 现使用同一事务，失败时不会推进 Scene。详见 docs/log/artifacts/F20/verification-summary.md。"}
completionGate: {"version":"v0.1","l3":"required","userPath":["仅 allowlist 的合成测试 learner 从 DeepTutor 发起课堂后，可安全完成冻结画像加载、课堂诊断/Scene 调整、课后候选投递与会话恢复；浏览器不直接接触 DeepTutor，失败状态准确可恢复。"],"integrationEvidence":["本地 Docker E2E 已验证 Launch/Profile/Map 冻结、权威 Session 诊断、原子 CAS/课堂事实写入、事务性 closeout、受限 Worker accepted/duplicate 和凭证隔离；证据已脱敏。"],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"cdd997ab8e981f0dac7aab7333633edb9be4f902"},{"path":"DeepTutor","branch":"fusion-adapter","commit":"9737cafff892092208681c4fd74132fceaf75840"}]}}
---

# F20 Integrated MVP 安全与端到端验收

## 目标

用已授权的测试身份完成 Integrated MVP 全链路验收：真实 Launch Code、服务器委托、会话恢复、最小 Profile/Map 快照、同步诊断与 Scene 调整、异步候选投递、长期聚合状态与分能力降级。验证安全边界和可恢复体验，而非宣称教学有效性或长期 mastery 必然改变。

## 集成决策

- 仅使用 `ENVIRONMENT=test` 和 `FUSION_TEST_USER_ALLOWLIST` 中明确授权、可清理的合成 learner；证据脱敏，不提交 Token、Cookie、数据库、完整 Prompt、Memory、完整会话或真实课堂导出。
- PostgreSQL 仅使用本地 Docker 实例；数据库 URL、Secret Provider 文件和任意密码只从未提交 `.env.local` 或等价环境配置读取。测试结束后可关闭服务并删除测试卷。
- `.env.example` 只记录占位符；缺少数据库配置必须返回清晰错误且不得回显配置值。
- 验收覆盖正常路径与 profile/diagnosis/update/Outbox/Session 分别失败路径；生产不允许 Mock 回退。
- 课堂总结必须区分即时结论、候选已接收/待重试/失败和由 DeepTutor 确认的长期聚合状态。
- 发现安全、隐私、身份越权、凭证泄露、静默丢失或不可恢复问题时，先记录 incident 并阻断 passing。

## 验收标准

- [x] 授权测试用户通过 DeepTutor 启动课堂，OpenMAIC 服务端取得可信 learnerId 与最小快照；浏览器不持有 DeepTutor 凭证。
- [x] 课堂 checkpoint 可获得真实诊断并安全调整 Scene；刷新恢复同一权威会话且不接受浏览器 learner 覆盖。
- [x] lesson_completed 后候选可靠投递；总结准确区分即时、接收、待重试/失败与长期聚合状态。
- [x] 所有分能力故障路径可理解、可重试或安全结束；无生产 Mock 回退、无越权、无凭证/原始数据泄露。
- [x] 自动 E2E、安全审查、人工演练、独立审查、两 Fork Git 证据与 Harness gate 通过。

## 完成证据

- 验证证据：`docs/log/artifacts/F20/verification-summary.md`
- 独立审查：`docs/log/artifacts/F20/independent-review.md`
