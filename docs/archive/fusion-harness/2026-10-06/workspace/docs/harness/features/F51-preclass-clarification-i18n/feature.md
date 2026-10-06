---
id: F51
title: 课前澄清中文 i18n 文案修复
version: v0.1
status: passing
dependsOn: ["F50"]
scope: {"code":["OpenMAIC/lib/i18n/locales/*.json","OpenMAIC/app/generation-preview/**"],"tests":["OpenMAIC/tests/fusion/**","OpenMAIC/tests/i18n/**","OpenMAIC/tests/generation-preview/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F51-preclass-clarification-i18n/**","docs/log/artifacts/preclass-code-audit/**"]}
evidence: {"lastVerifiedAt":"2026-08-17T15:12:00+08:00","commands":[{"command":"OpenMAIC: pnpm exec vitest run tests/generation-preview/clarification.test.ts tests/i18n/preclass-clarification-locales.test.ts tests/i18n/outline-review-locales.test.ts tests/fusion/clarify-route.test.ts","result":"9 passed"},{"command":"OpenMAIC: pnpm exec tsc --noEmit","result":"passed"},{"command":"OpenMAIC: pnpm exec prettier --check (F51 changed files)","result":"passed"},{"command":"OpenMAIC: node scripts/check-i18n-keys.mjs","result":"passed"},{"command":"OpenMAIC: git diff --check","result":"passed"},{"command":"node scripts/harness-gate.mjs","result":"53 features, 0 errors"}],"artifacts":["docs/log/artifacts/F51/verification-summary.md"]}
dataPolicy: {"sources":["现有本地化资源"],"outbound":[],"forbidden":["澄清文本包含 token、凭据或学生个人数据"],"retention":"不新增持久化数据"}
decisionPolicy: {"copy":"中文澄清文案必须表达需补充信息、输入提示、提交中和失败状态","fallback":"缺失文案沿用现有 locale fallback，不得显示问号占位","compatibility":"仅修复文案和可访问状态，不改变 revision/session 协议"}
completionGate: {"version":"v0.1","l3":"required","userPath":["中文用户可读懂澄清原因、输入补充信息并看到提交中/失败状态"],"integrationEvidence":["OpenMAIC commit 3291f6bb2260d3c1ecc5f5f91210b345389a0d70 pushed to origin/fusion-adapter; 9 targeted tests, tsc, Prettier, i18n key check and diff check passed."],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"3291f6bb2260d3c1ecc5f5f91210b345389a0d70"}]}}
---

# F51 课前澄清中文 i18n 文案修复

## 目标

修复 F48 澄清界面在简体中文和繁体中文 locale 中显示问号的问题，并建立值级防回归检查。为保持 locale key parity，同时为所有支持的 locale 提供安全的失败回退文案。

## 集成与边界

- 集成宿主：OpenMAIC generation-preview 澄清 UI。
- 权威状态：仍由 F48 服务端 revision/session 合同负责；本 Feature 不修改状态机。
- 允许范围：所有 locale 的澄清文案 key（中文提供本地化文本，其余 locale 提供安全回退）、澄清 UI 的展示/可访问状态及相关测试。
- 不在范围：API、DeepTutor、自动重试、文案之外的生成逻辑。

## 验收标准

- [x] zh-CN/zh-TW 的澄清标题、说明、占位符、提交中和失败文案为有效中文，不含问号乱码。
- [x] 既有英文及其他 locale key parity 保持通过。
- [x] 测试覆盖显示/可访问关联、Ctrl/Cmd+Enter 键盘提交、提交中和失败状态接线。
- [x] Prettier、定向测试、tsc、i18n 检查和 git diff --check 通过；Harness gate 待提交推送后复跑。
- [x] 完成独立只读复核后方可标记 passing（fresh provider-neutral review: pass）。
