---
id: F01
title: 模拟 DeepTutor 学生画像
version: v0.1
status: passing
dependsOn: []
scope: {"code":["DeepTutor/integrations/openmaic/fusion/contracts.ts","DeepTutor/integrations/openmaic/fusion/provider.ts","DeepTutor/integrations/openmaic/fusion/mock-provider.ts","DeepTutor/integrations/openmaic/fusion/deeptutor-provider.ts","DeepTutor/integrations/openmaic/fusion/l3-profile-guidance.ts","DeepTutor/integrations/openmaic/fusion/demo-profile-fixtures.ts","DeepTutor/integrations/openmaic/fusion/strategy-builder.ts","DeepTutor/integrations/openmaic/fusion/prompt-context.ts","DeepTutor/integrations/openmaic/fusion/session.ts","scripts/harness-gate.mjs"],"tests":["DeepTutor/integrations/openmaic/fusion/tests/**","DeepTutor/integrations/openmaic/fusion/tests/typescript-loader.mjs"],"docs":["docs/progress.md","docs/decisions.md","docs/harness/features/feature-index.json","docs/harness/features/F01-simulated-deeptutor-profile/**","docs/harness/features/F02-profile-driven-ppt/**","docs/log/artifacts/F01/**","docs/harness/incidents/**"]}
evidence: {"lastVerifiedAt":"2026-07-22T00:00:00.000Z","commands":[{"command":"cd DeepTutor; node --experimental-transform-types --experimental-loader ./integrations/openmaic/fusion/tests/typescript-loader.mjs --test ./integrations/openmaic/fusion/tests/adapter.test.ts","result":"passed","runAt":"2026-07-22","summary":"Node.js v22.19.0，6/6 通过；不访问网络、模型服务或真实用户数据。"},{"command":"git -C DeepTutor diff --check","result":"passed","runAt":"2026-07-22","summary":"未发现空白错误。"},{"command":"node scripts/harness-gate.mjs","result":"passed","runAt":"2026-07-22","summary":"Harness gate: 2 features, 0 errors。"}],"manualSmoke":"已按验证计划人工审阅 A/B 的确定性画像及其不同策略投影、未知学生/主题的明确拒绝，以及 prompt 不含 learner ID、显示名、L3 文本或合成证据；结果与自动化测试一致。"}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["开发者调用 MockFusionProfileProvider，以演示学生 A/B 和一次函数主题获得不同、确定且不包含真实用户数据的 StudentProfile。"],"integrationEvidence":[],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"legacyExempt":true,"reason":"F01 在 Git 证据门禁引入前已标记 passing；不得将该例外用于新 feature。"}}
---

# F01 模拟 DeepTutor 学生画像

## 目标

在不读取真实 DeepTutor 用户数据、不启动 DeepTutor 服务、不使用模型或网络的前提下，提供两份可审阅、可重复的学生画像。它们以 DeepTutor L3 `profile` 的画像形成准则为参考，并确定性投影为供后续功能消费的最小 `StudentProfile`。

## 集成决策

- 集成宿主：DeepTutor 的 `integrations/openmaic/fusion/` 适配层；本 feature 不接入 OpenMAIC 页面、路由或生成链路。
- 身份与授权所有者：无。`demo-student-a`、`demo-student-b` 只是固定演示键，不是登录账号、用户 ID 或授权依据。
- 权威数据所有者：演示 fixture 是 F01 唯一的数据源，位于 `DeepTutor/integrations/openmaic/fusion/` 并受版本控制。它们不代表真实 DeepTutor 运行时数据。
- 版本化契约：F01 定义/维护 `v1` 教学语义对象契约，并激活 `StudentProfile -> TeachingStrategy -> FusionTeachingContext/promptText` 的纯函数链路；`ClassroomEvent`、`LearningDiagnosis`、`ProfileUpdate` 只保留契约，不实现业务流。
- 数据与 AI 边界：DeepTutor 的 `memory/L3/profile.md`、L2 文档、学习记录、数据库、真实身份和原始对话均不得读取、复制或传入生成提示词。F01 不调用 LLM、网络或外部 AI 服务。

## 范围

### 允许改动

- 在 `DeepTutor/integrations/openmaic/fusion/` 维护五类教学语义对象、Provider 接口、Mock Provider、教学策略、最小化 prompt 上下文和课程会话快照。
- 从 DeepTutor 当前 L3 `profile` 生成提示词中抽取受限的画像准则/提示词快照，并标明来源文件和审阅基线；它只用于人工编写 fixture，不能在运行时读取真实 Markdown 或调用模型。
- 编写演示学生 A/B 的脱敏、L3 风格 fixture：每条稳定观察至少覆盖两个不同的模拟 surface，并将“身份、学习风格、知识水平”分区与知识点、掌握度、偏好和可检查误解区分开。
- 将 fixture 确定性投影为最小 `StudentProfile`；拒绝未知演示学生和不支持的演示主题；不将 fixture 审阅证据传出 Provider。
- 对传入生成提示词的策略文本实施最小化与安全归一化（控制字符清理、长度限制），并增加聚焦 Node 测试与测试加载器。
- 更新本 feature 的合同、证据、incident 和长期决策记录。

### 不在范围内

- OpenMAIC 的页面、服务端 route、PPT 大纲/场景生成、浏览器存储或 UI 测试。
- 真实 DeepTutor 登录、授权、用户画像 API、运行时 `memory/L3/*.md`、学习进度 JSON、数据库、令牌或跨应用数据迁移。
- 将课堂结果回写 DeepTutor、实时课堂事件、学习诊断、画像更新、出题/解题、永久存储或双向同步。

## 验收标准

- [x] Adapter 导出 `StudentProfile`、`ClassroomEvent`、`LearningDiagnosis`、`TeachingStrategy` 与 `ProfileUpdate` 的版本化契约；F01 只执行“画像 → 策略 → 上下文”的纯函数链路。
- [x] `demo-student-a` 与 `demo-student-b` 对一次函数返回不同、确定的 `StudentProfile`；未知学生和不支持主题以明确错误拒绝，不回退到任意默认画像。
- [x] 演示 fixture 使用 DeepTutor L3 `profile` 的“身份、学习风格、知识水平”准则；每条 L3 风格观察至少含两个不同模拟 surface 的脱敏证据，且不把知识水平误写为身份。
- [x] Provider 输出与 `FusionTeachingContext` 不含 fixture 审阅证据、原始 L3 文本、显示名或 learner ID 的生成提示词；策略文本会清理控制字符并限制长度。
- [x] Adapter 的离线测试无需网络、凭证、模型服务或真实用户数据即可通过。

## 风险与兼容性

- 模拟画像可能被误解为真实身份或真实学习记录；所有键和值必须标明 demo/合成语义，且只允许白名单输入。
- DeepTutor 的 L3 prompt 会演进；抽取快照必须记录来源路径和审阅基线，但不能自动复制、同步或执行上游 prompt。
- Adapter 的 TypeScript 测试使用 Node.js 22+ 原生 TypeScript 实验能力；在纳入正式 CI 前需固定命令或迁移到项目既有测试运行器。
- 该 feature 不证明 OpenMAIC 已完成个性化 PPT 集成；该结果由依赖 F01 的 F02 单独验收。

## 完成证据

- 验证证据：`docs/log/artifacts/F01/verification-summary.md`
- 独立审查：`docs/log/artifacts/F01/subagent-review.md`
