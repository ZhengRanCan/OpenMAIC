---
id: F53
title: 正式 Fusion 课程材料兼容性边界提示
version: v0.1
status: passing
dependsOn: ["F52"]
scope: {"code":["OpenMAIC/app/page.tsx","OpenMAIC/app/generation-preview/**","OpenMAIC/app/api/generate/**","OpenMAIC/lib/fusion/adapter/**","OpenMAIC/lib/i18n/locales/*.json"],"tests":["OpenMAIC/tests/fusion/**","OpenMAIC/tests/generation/**","OpenMAIC/tests/i18n/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F53-formal-material-compatibility/**","docs/log/artifacts/F53/**","docs/log/artifacts/preclass-code-audit/**"]}
evidence: {"lastVerifiedAt":"2026-08-18T11:18:00+08:00","commands":[{"cmd":"pnpm exec vitest run tests/generation/formal-material-compatibility.test.ts tests/fusion/source-material-boundary.test.ts tests/i18n/preclass-clarification-locales.test.ts","result":"passed","detail":"3 files / 10 tests passed"},{"cmd":"pnpm exec tsc --noEmit","result":"passed"},{"cmd":"node scripts/check-i18n-keys.mjs","result":"passed","detail":"8 locale files aligned"},{"cmd":"git diff --check","result":"passed"},{"cmd":"pnpm build","result":"passed"},{"cmd":"git commit b783b22e08184eae315f59d92083c6d1b424756e and push origin/fusion-adapter","result":"passed"},{"cmd":"node scripts/harness-gate.mjs","result":"passed","detail":"Harness gate: 53 features, 0 errors"},{"cmd":"independent read-only review","result":"passed","detail":"current-platform default subagent"}],"artifacts":["docs/log/artifacts/F53/subagent-review.md"]}
dataPolicy: {"sources":["服务端授权的 sourceMaterialRefs（当前为空）","用户选择的课堂模式"],"outbound":["当前方案不向正式 Fusion 发送浏览器材料正文"],"forbidden":["重新信任浏览器 pdfText、pdfImages、researchContext、imageMapping","绕过 F47 授权边界"],"retention":"不新增材料持久化；提示事件沿用现有审计策略"}
decisionPolicy: {"currentProductDecision":"正式 Fusion 暂不支持浏览器自带材料，采用 fail-closed 提示并引导普通课堂","future":"若要支持材料，另立 Feature 建立服务端存储、引用、digest 和授权链路","compatibility":"无材料正式 Fusion 行为保持不变"}
completionGate: {"version":"v0.1","l3":"required","userPath":["用户选择上传材料时提前看到正式 Fusion 不支持提示，并可转入普通课堂；无材料 Fusion 仍可生成"],"integrationEvidence":["OpenMAIC b783b22e08184eae315f59d92083c6d1b424756e adds a formal-material compatibility prompt before generation, ordinary-classroom override, locale keys across 8 locales, and F53 regression tests.","F47 server-side source material boundary remains covered by tests/fusion/source-material-boundary.test.ts and rejects browser-owned pdfText/pdfImages/research/imageMapping for formal Fusion.","Harness gate: 53 features, 0 errors.","Independent read-only review completed by current-platform default subagent with PASS; artifact docs/log/artifacts/F53/subagent-review.md."],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"b783b22e08184eae315f59d92083c6d1b424756e"}]}}
---

# F53 正式 Fusion 课程材料兼容性边界提示

## 目标

把 F47 的 fail-closed 行为转化为可理解的产品路径：正式 Fusion 遇到浏览器课程材料时提前提示限制并引导普通课堂，避免用户在生成阶段才得到不明失败。

## 集成与边界

- 集成宿主：OpenMAIC 课程材料选择、generation-preview 和正式生成路由错误展示。
- 当前产品决策：先实现“材料不进入正式 Fusion，明确提示并转普通课堂”；不直接实现材料授权链路。
- 允许范围：材料模式检测、提示文案、普通课堂引导、fail-closed 测试和文档。
- 不在范围：信任浏览器正文、DeepTutor 材料存储、sourceMaterialRefs 服务端授权协议。

## 验收标准

- [x] 上传 PDF/图片或存在 research/image mapping 时，在正式 Fusion 生成前显示明确限制和普通课堂选项。
- [x] 正式 Fusion API 仍拒绝未授权浏览器正文，且错误可理解、无敏感内容泄漏。
- [x] 无材料正式 Fusion 和普通课堂材料路径保持兼容。
- [x] 定向/全量测试、tsc、build、i18n、Harness 和独立只读复核通过。
