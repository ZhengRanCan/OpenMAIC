---
id: F18
title: 真实 Profile、Event 与 Update Provider
version: v0.1
status: passing
dependsOn: ["F15", "F16", "F17"]
scope: {"code":["DeepTutor/deeptutor/api/routers/fusion_profile.py","DeepTutor/deeptutor/api/routers/fusion_diagnosis.py","DeepTutor/deeptutor/api/routers/fusion_profile_updates.py","DeepTutor/deeptutor/api/services/fusion_*.py","DeepTutor/integrations/openmaic/fusion/**","OpenMAIC/lib/fusion/adapter/**","OpenMAIC/lib/fusion/contracts.ts","OpenMAIC/lib/fusion/identity/**"],"tests":["DeepTutor/tests/api/test_fusion_*.py","OpenMAIC/tests/fusion/real-providers.test.ts","OpenMAIC/tests/fusion/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F18-real-fusion-providers/**","docs/log/artifacts/F18/**","docs/harness/incidents/**"]}
evidence: {"lastVerifiedAt":"2026-07-25T10:00:00+08:00","commands":[{"command":"DeepTutor Fusion API tests","result":"passed","summary":"6/6 profile, diagnosis and update tests passed."},{"command":"OpenMAIC Fusion tests","result":"passed","summary":"35/35 including real provider transport."},{"command":"git diff checks","result":"passed","summary":"Both Forks passed."}],"manualSmoke":"Allowlist-scoped synthetic integration learner is the sole data source. Profile/Map responses are minimal, diagnosis/update calls require delegated scope plus lesson binding, and each provider fails independently without Mock fallback."}
completionGate: {"version":"v0.1","l3":"required","userPath":["使用 F16 allowlist 下隔离的合成集成测试身份时，OpenMAIC 服务端可读取最小 StudentProfile、请求同步诊断并异步提交候选；浏览器不接触 DeepTutor 原始协议或数据。"],"integrationEvidence":["docs/log/artifacts/F18/verification-summary.md","docs/log/artifacts/F18/independent-review.md"],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"DeepTutor","branch":"fusion-adapter","commit":"12d28bcaff0ea9a16f187e2dbcf8fca0afb391ed"},{"path":"OpenMAIC","branch":"fusion-adapter","commit":"30f196116fb0d3836fbed89e6564da906f94262f"}]}}
---

# F18 真实 Profile、Event 与 Update Provider

## 目标

以 F16/F17 的受限身份替换 Development Only Mock Provider：实现真实、版本化的 DeepTutor Fusion Profile、同步 Event/Diagnosis 与 Profile Update 接口，并由 OpenMAIC Adapter 消费协议无关领域对象。这里的“真实”指真实认证、授权、API 和传输路径；F18 只使用 F16 allowlist 下隔离、可清理的合成集成测试身份，绝不读取真实学生资料。

## 集成决策

- Adapter 只消费 StudentProfile、LessonKnowledgeMap、LearningDiagnosis、TeachingIntent 和 ProfileUpdateReceipt；不得解析原始 Memory、WebSocket 输出、内部数据库或会话全文。
- Profile 必须带 schemaVersion、profileRevision、learnerId、insufficient_data、confidence/warnings；不返回原始证据文本、附件或完整会话。
- LessonKnowledgeMap 使用 namespace/scopeId/id 与 mappingId/mappingRevision；lesson_local/unresolved 不可写入长期 mastery。
- 真实 Event/Update API 必须校验 F16 scope、event/candidate 幂等与 lesson 绑定；DeepTutor 决定长期聚合，OpenMAIC 不直接写 mastery。
- 生产环境禁止 Mock 自动回退；真实 Provider 不可用时按能力降级，而不是伪装个性化结果。
- 合成集成测试身份由 DeepTutor 侧显式预置并受 allowlist 约束；其最小 Profile、Map 和开发观察记录只用于 F18 测试，必须有可清理路径和明确保留策略。它不是 F07 的 Mock Provider，也不是任何真实用户。

## 验收标准

- [x] F16 allowlist 下的合成集成测试身份可经真实 Provider 读取最小 Profile/Map 并冻结为课堂快照；无数据明确为 insufficient_data。
- [x] Event 和 Update 请求以可信 learnerId、scope、lesson binding 和幂等键受保护，返回契约化结果而非原始协议。
- [x] Profile/Map/诊断/回执中不泄露原始 Memory、会话、附件、Token 或 UI 命令；测试数据有明确清理/保留证据。
- [x] 真实接口失败时按 profile/diagnosis/update 能力分别降级，生产绝不回退 Mock。
- [x] 两端测试、独立审查、Git 证据和 Harness gate 通过。

## 完成证据

- 验证证据：`docs/log/artifacts/F18/verification-summary.md`
- 独立审查：`docs/log/artifacts/F18/independent-review.md`
