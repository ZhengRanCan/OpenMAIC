---
id: F02
title: 学生画像驱动的个性化 PPT MVP
version: v0.1
status: passing
dependsOn: ["F01"]
scope: {"code":["OpenMAIC/app/**","OpenMAIC/lib/fusion/**","OpenMAIC/lib/hooks/use-scene-generator.ts","OpenMAIC/lib/types/generation.ts","OpenMAIC/lib/i18n/locales/*.json","OpenMAIC/package.json","OpenMAIC/scripts/dev-windows.ps1"],"tests":["OpenMAIC/tests/fusion/**"],"docs":["docs/progress.md","docs/decisions.md","docs/harness/features/F02-profile-driven-ppt/**","docs/log/artifacts/F02/**","docs/harness/incidents/**"]}
evidence: {"lastVerifiedAt":"2026-07-22","commands":[{"command":"cd OpenMAIC; pnpm lint","result":"passed"},{"command":"cd OpenMAIC; pnpm test -- tests/fusion","result":"passed"},{"command":"cd OpenMAIC; git diff --check","result":"passed"}],"manualSmoke":"A/B 本地 UI 路径与非支持主题普通回退已在恢复前的会话完成；本会话复跑无密钥 route stub，完整记录见 docs/log/artifacts/F02/verification-summary.md。"}
completionGate: {"version":"v0.1","l3":"required","userPath":["用户在 OpenMAIC 选择由 F01 提供的演示学生 A/B，生成课程，并获得能反映该画像教学上下文的 PPT 大纲/内容。"],"integrationEvidence":["docs/log/artifacts/F02/verification-summary.md","docs/log/artifacts/F02/subagent-review.md"],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"legacyExempt":true,"reason":"F02 在 Git 证据门禁引入前已标记 passing；不得将该例外用于新 feature。"}}
---

# F02 学生画像驱动的个性化 PPT MVP

## 目标

将 F01 已通过的离线 `StudentProfile` 接入 OpenMAIC：用户选择演示学生 A/B 后，OpenMAIC 在服务端创建并冻结 `FusionLessonSession`，把派生教学上下文持续用于课程大纲与后续场景生成，以生成具有不同深度、节奏、示例和练习安排的 PPT。

## 集成决策

- 集成宿主：OpenMAIC。
- 前置条件：F01 必须处于 `passing`；F02 不复制、重写或绕过 F01 的 Mock Provider/契约。
- 身份与授权所有者：F02 没有真实登录或授权。演示学生键只是固定 Demo 选择项。
- 权威数据所有者：F01 拥有合成 `StudentProfile`；OpenMAIC 拥有生成课堂、PPT 与每次生成的本地会话状态。
- 版本化契约：F02 消费 F01 的 `StudentProfile -> TeachingStrategy -> FusionTeachingContext -> FusionLessonSession`。浏览器不能直接调用 DeepTutor，也不得读取 DeepTutor 内部文件或运行时存储。
- 离线传输：F01 当前没有运行时 HTTP 服务，因此 F02 在 `OpenMAIC/lib/fusion/` 保存一份经审阅的 F01 `v1` **最小化会话投影目录**。它仅含两个演示会话的固定 ID、Demo 展示信息和最终 `promptText`；不复制 `StudentProfile`、Provider、L3 文本、审阅证据或策略推导逻辑。浏览器只持有会话 ID；OpenMAIC 服务端在每个大纲、内容和动作请求中重新解析该固定投影。
- 同步规则：该目录是显式发布的跨仓库演示 artifact，而不是代码导入或自动同步。F01 的 fixture/策略改变时，必须重新审阅投影内容、更新来源标记并以 F02 验证覆盖差异。
- 外部 AI 数据：只将最小化的 `promptText` 及课程请求发送至 OpenMAIC 既有服务端生成链路；不发送审阅证据、原始 L3 文本、真实身份或凭证。

## 范围

### 允许改动

- 在 OpenMAIC 增加最小服务端集成：选择 F01 Mock 画像、创建/冻结课程快照，并将派生上下文传入大纲和后续场景生成请求。
- 对既有 UI 做最小改动：选择演示学生 A/B，显示 Demo 标识、加载、配置/融合失败、重试与正常生成回退状态。
- 在 `OpenMAIC/tests/fusion/` 添加聚焦测试，并在 F02 artifacts 记录验证和独立审查。

### 不在范围内

- 改动 F01 的模拟画像实现，或接入真实 DeepTutor 登录、API、运行时 Markdown、数据库和用户数据。
- 课堂结果写回、实时课堂事件、学习诊断、画像更新、出题/解题、持久化迁移、视觉重设计或双向同步。

## 验收标准

- [x] 用户可在 OpenMAIC 选择演示学生 A/B；界面明确说明其为演示画像，不把它当作真实身份。
- [x] 大纲和后续场景生成使用同一份冻结的 `FusionLessonSession`，不会在后续内容退回通用上下文。
- [x] 对相同“一次函数”主题，学生 A/B 的生成请求具有可验证的教学层级、节奏、示例或检查点差异。
- [x] 融合不可用或未选择融合时，用户得到不泄露敏感信息的恢复/重试路径，既有 OpenMAIC 生成仍可使用。

## 风险与兼容性

- F02 不得直接引用 DeepTutor 路径或从浏览器调用 DeepTutor；只消费 F01 的稳定投影。
- 上下文只传到初始大纲会导致后续幻灯片退化，因此会话传播是核心验收项。
- 本地模型服务商可能未配置；自动化测试必须有无密钥路径，人工验证需记录实际使用的安全替代方式。

## 完成证据

- 验证证据：`docs/log/artifacts/F02/verification-summary.md`
- 独立审查：`docs/log/artifacts/F02/subagent-review.md`
