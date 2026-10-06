---
id: F50
title: F02 演示画像 Demo 退役
version: v0.1
status: passing
dependsOn: []
scope: {"code":["OpenMAIC/app/page.tsx","OpenMAIC/app/generation-preview/**","OpenMAIC/app/classroom/**","OpenMAIC/app/api/fusion/demo-session/**","OpenMAIC/lib/fusion/session-catalog.ts","OpenMAIC/lib/fusion/topic.ts","OpenMAIC/lib/fusion/lan-demo-classroom.ts","OpenMAIC/lib/hooks/use-scene-generator.ts","OpenMAIC/app/api/generate/scene-outlines-stream/route.ts","OpenMAIC/app/api/generate/scene-content/route.ts","OpenMAIC/app/api/generate/scene-actions/route.ts","OpenMAIC/lib/i18n/locales/*.json"],"tests":["OpenMAIC/tests/fusion/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F50-f02-demo-retirement/**","docs/harness/ARCHITECTURE.md","docs/harness/ARCHITECTURE/F35_ARCHITECTURE_SPLIT/**","docs/harness/FUSION/03-pre-class-fusion-code-migration-roadmap.md","docs/harness/PRODUCT_SPEC.md","docs/decisions.md"]}
evidence: {"lastVerifiedAt":"2026-08-10T21:20:00+08:00","commands":[{"command":"OpenMAIC: pnpm exec vitest run","result":"passed"},{"command":"OpenMAIC: pnpm exec vitest run tests/fusion","result":"passed"},{"command":"OpenMAIC: pnpm exec tsc --noEmit","result":"passed"},{"command":"OpenMAIC: pnpm build","result":"passed"},{"command":"OpenMAIC: pnpm check:i18n-keys","result":"passed"},{"command":"git -C OpenMAIC diff --check","result":"passed"},{"command":"node scripts/harness-gate.mjs","result":"passed"}],"artifacts":["classroom/review/F50/20260810/F50-verification-evidence.md"]}
dataPolicy: {"sources":["F02 静态演示投影（退役删除）","正式 Fusion 服务端 Frozen Context（保留）"],"outbound":["正式课堂只携带 lessonSessionId 服务端会话引用"],"forbidden":["演示 promptText 进入正式生成","浏览器覆盖正式会话身份","把删除后的遗留 fusionSessionId 当作权威"],"retention":"历史浏览器 sessionStorage 中的遗留字段仅忽略；正式 Session 数据策略不变","exit":"F02 Demo 入口、路由、投影与专有测试全部退役"}
decisionPolicy: {"retire":"只删除 F02 Demo 运行时，不删除 F01 适配层、F02 历史合同与验证证据","compatibility":"正式 lessonSessionId 与普通课堂路径完整保留；历史遗留字段只读忽略","fallback":"普通课堂与正式 Fusion 独立，不作为彼此回退","verification":"删除后完成全量 Vitest、tsc、build 与 Harness gate 验证"}
completionGate: {"version":"v0.1","l3":"required","userPath":["OpenMAIC 不再暴露 F02 A/B 演示画像入口；生成链路不再传递演示会话 id；正式 Fusion、普通课堂与 LAN demo 行为不受影响。"],"integrationEvidence":["OpenMAIC fusion-adapter commit fafe95d9cc3ba44096096393d8469c6033da6ff3 pushed to origin/fusion-adapter","classroom/review/F50/20260810/F50-verification-evidence.md","2026-08-17 provider-neutral platform read-only review: pass; verified current contract/evidence, F02 retirement scope, encoding remediation, Git synchronization, tests, and Harness gate."],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"fafe95d9cc3ba44096096393d8469c6033da6ff3"}]}}
---

# F50 F02 演示画像 Demo 退役

## 目标

删除 F02 的离线 A/B 学生画像 Demo 运行时：OpenMAIC 的演示学生选择 UI、`/api/fusion/demo-session`、`lib/fusion/session-catalog.ts` 与 `lib/fusion/topic.ts` 静态投影、生成链路中的 `fusionSessionId` 演示透传，以及 F02 专有测试与演示文案。正式 Fusion（`lessonSessionId`）、普通课堂与 LAN demo 保持不变；F01 的 DeepTutor 适配层独立保留；F02 历史合同与验证证据作为历史记录保留。

## 集成决策

- 集成宿主：OpenMAIC。
- 身份与授权归属：被删除的 Demo 选择键不是真实身份；正式身份仍走 `lessonSessionId` 对应的服务端会话。
- 权威数据归属：正式 Fusion 仍只依赖服务端 Frozen Context；F02 静态投影不再存在。
- 版本化契约：`fusionSessionId` 演示透传字段退役；`lessonSessionId` 正式字段保持不变。
- 外部 AI/数据发送：删除后正式生成不再可能混入演示 `promptText`。

## 范围

### 允许改动

- 删除 F02 Demo UI：`app/page.tsx` 中 A/B 学生选择、演示会话创建请求与相关状态、`isFusionDemoSupported` 及 `home.fusion.*` 文案。
- 退役 `/api/fusion/demo-session` 为返回 410 的失效桩（历史客户端 fail closed）；删除 `lib/fusion/session-catalog.ts`、`lib/fusion/topic.ts`。
- 移除生成链路 `fusionSessionId` 演示透传：`scene-outlines-stream`、`scene-content`、`scene-actions`、`use-scene-generator.ts`、`generation-preview`、`classroom/[id]`。
- 删除 F02 专有测试（`demo-session-route.test.ts`、`session-catalog.test.ts`）并改写仍依赖演示投影的测试（`scene-routes`、`outline-route`、`client-session-propagation`）。
- 将 `generation.fusionSessionUnavailable` 文案改为正式 Fusion 通用表述，不再指向演示画像。
- 更新 `ARCHITECTURE.md` 与受控生成分片、`FUSION/03` 路线图、`decisions.md`、feature-index 与进度面板。

### 不在范围内

- 不删除 F01 的 DeepTutor 适配层、F02 历史合同与验证证据。
- 不删除或修改正式 Fusion、普通课堂、LAN demo 能力与 `lessonSessionId` 会话。
- 不修改 DeepTutor Fork 代码。
- 不实现 F46–F49 的 Catalog 派生、源材料授权、澄清修订或 shadow 接线。

## 验收标准

- [x] OpenMAIC 不再暴露 F02 A/B Demo 入口；`/api/fusion/demo-session` 返回 410，`session-catalog.ts`、`topic.ts` 已删除。
- [x] 生成链路不再传递或消费 `fusionSessionId` 演示字段；正式 `lessonSessionId` 行为不变。
- [x] F02 专有测试已删除或改写；OpenMAIC 全量 Vitest、tsc、build 通过。
- [x] i18n 演示文案已清理；正式 Fusion 错误文案不再指向演示画像。
- [x] ARCHITECTURE、FUSION/03、decisions、索引、进度已同步；Harness gate 通过；OpenMAIC 提交推送完成。

## 风险与兼容性

- 历史浏览器 `sessionStorage` 中的遗留 `fusionSessionId` 只作遗留数据忽略，不报错、不升级。
- 正式 Fusion 与普通课堂路径必须通过完整回归测试。
- F01 适配层与 F02 历史文档保留为历史记录，不伪装为已删除。

## 完成证据

- 验证记录：见本目录 `verification.md`。
- 独立复核：provider-neutral 当前平台普通只读子代理复核结论记录于 `verification.md` 与 F50 artifact。
- Git 证据：`completionGate.gitEvidence` 记录 OpenMAIC `fusion-adapter` 分支提交 `fafe95d9cc3ba44096096393d8469c6033da6ff3`；已推送至 `origin/fusion-adapter` 且工作树干净。
