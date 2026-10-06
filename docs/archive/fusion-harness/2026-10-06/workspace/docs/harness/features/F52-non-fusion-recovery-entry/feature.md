---
id: F52
title: Fusion 失败到显式 non-Fusion 恢复入口
version: v0.1
status: passing
dependsOn: ["F51"]
scope: {"code":["OpenMAIC/app/generation-preview/**","OpenMAIC/lib/fusion/generation-session.ts","OpenMAIC/app/api/generate/**","OpenMAIC/lib/i18n/locales/*.json"],"tests":["OpenMAIC/tests/fusion/**","OpenMAIC/tests/generation/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F52-non-fusion-recovery-entry/**","docs/log/artifacts/preclass-code-audit/**"]}
evidence: {"lastVerifiedAt":"2026-08-18T00:10:00+08:00","commands":[{"command":"OpenMAIC: pnpm exec vitest run tests/generation/non-fusion-recovery.test.ts tests/i18n/preclass-clarification-locales.test.ts tests/fusion/generation-session.test.ts tests/fusion/clarify-route.test.ts","result":"29 passed"},{"command":"OpenMAIC: pnpm exec tsc --noEmit","result":"passed"},{"command":"OpenMAIC: pnpm exec prettier --check (F52 changed files)","result":"passed"},{"command":"OpenMAIC: node scripts/check-i18n-keys.mjs","result":"passed"},{"command":"OpenMAIC: git diff --check","result":"passed"},{"command":"OpenMAIC: pnpm build","result":"passed"},{"command":"node scripts/harness-gate.mjs","result":"53 features, 0 errors"}],"artifacts":["docs/log/artifacts/F52/subagent-review.md"]}
dataPolicy: {"sources":["服务端结构化 recovery/errorCode","用户显式选择"],"outbound":["仅向普通课堂生成请求发送普通课堂输入"],"forbidden":["复用失败 Fusion digest、Map、Guidance、Profile、frozen context、lessonSessionId","自动将 Fusion 失败转换为普通课堂"],"retention":"记录恢复原因和新 ordinary session 关联，不记录敏感正文"}
decisionPolicy: {"trigger":"仅用户点击明确的 non-Fusion 恢复按钮","session":"创建独立 ordinary session，不携带 Fusion 身份字段","failure":"恢复创建失败时保留错误原因并允许安全返回，不自动重试 Fusion"}
completionGate: {"version":"v0.1","l3":"required","userPath":["Fusion 失败后用户看到不使用个性化 Fusion 上下文的说明，点击后进入独立普通课堂生成"],"integrationEvidence":["OpenMAIC commits 42b920482a26552c36775ebea05d51f3e6fc4090 and 113531524ee98b42c08d022d7483f5e2b178007b pushed to origin/fusion-adapter; ordinary recovery now carries only user requirement text.","Current-platform independent readonly review: pass; verified service recovery, explicit click trigger, ordinary session isolation, UI copy, tests, Git and Harness gate."],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"113531524ee98b42c08d022d7483f5e2b178007b"}]}}
---

# F52 Fusion 失败到显式 non-Fusion 恢复入口

## 目标

将服务端已有的 `recovery.kind = non_fusion` 真正接入前端：用户可在 Fusion 失败后显式选择独立普通课堂恢复，且失败 Fusion 上下文不可复用。

## 集成与边界

- 集成宿主：OpenMAIC generation-preview 与普通课堂生成入口。
- 身份归属：普通课堂新建 session；不继承 `lessonSessionId` 或 Fusion cookie 语义。
- 允许范围：结构化错误/recovery 保留、恢复 UI、ordinary session 创建、相关 API/测试/文案。
- 不在范围：改变 F48 澄清 revision 限制、DeepTutor 协议或自动 fallback。

## 验收标准

- [x] non-Fusion recovery 信息在 UI 可见，并说明不使用个性化 Fusion 上下文。
- [x] 用户点击后创建独立 ordinary session；请求不含 Fusion 字段，旧 session 被安全清理。
- [x] partial、unresolved、rejected、provider failure 均覆盖；未点击时不得自动恢复。
- [x] 恢复原因可审计且不含敏感正文。
- [x] 定向/全量测试、tsc、build、i18n、Harness 和独立只读复核通过。
