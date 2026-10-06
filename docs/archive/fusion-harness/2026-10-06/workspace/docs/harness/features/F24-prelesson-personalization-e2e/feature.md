---
id: F24
title: 正式课前个性化生成验收
version: v0.2
status: passing
dependsOn: ["F03", "F23"]
scope: {"code":["DeepTutor/deeptutor/api/routers/fusion_profile.py","DeepTutor/deeptutor/api/services/fusion_delegation.py","OpenMAIC/.env.example","OpenMAIC/app/page.tsx","OpenMAIC/app/generation-preview/page.tsx","OpenMAIC/app/generation-preview/types.ts","OpenMAIC/app/classroom/[id]/page.tsx","OpenMAIC/app/api/fusion/connection/route.ts","OpenMAIC/app/api/fusion/dev-launch/route.ts","OpenMAIC/lib/hooks/use-scene-generator.ts","OpenMAIC/lib/i18n/locales/*.json"],"tests":["DeepTutor/tests/api/test_fusion_*.py","OpenMAIC/tests/fusion/**","OpenMAIC/tests/e2e/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F24-prelesson-personalization-e2e/**","docs/harness/features/F26-inlesson-fusion-readonly-review/**","docs/harness/features/F27-postlesson-fusion-readonly-review/**","docs/log/artifacts/F24/**","docs/harness/incidents/**","classroom/review/F24/**"]}
evidence: {"lastVerifiedAt":"2026-07-30","commands":[{"command":"python -m py_compile deeptutor/api/routers/fusion_profile.py deeptutor/api/services/fusion_delegation.py tests/api/test_fusion_profile.py","result":"passed"},{"command":"test-only FastAPI A/B Profile/Map harness","result":"passed"},{"command":"corepack pnpm exec vitest run tests/fusion/generation-session.test.ts tests/fusion/client-session-propagation.test.ts --no-file-parallelism","result":"passed (2 files, 5 tests)"},{"command":"corepack pnpm exec tsc --noEmit","result":"passed"},{"command":"formal-generation ESLint target set","result":"passed"},{"command":"node scripts/harness-gate.mjs","result":"passed (27 features, 0 errors)"}],"manualSmoke":"用户确认已在同一固定短课堂要求下生成 baseline、正式 A 与正式 B；A/B 均在生成前通过首页正式 DeepTutor 连接建立 Session，界面分别显示对应合成学习者。模型凭证、Session ID、Cookie、Profile 与 Map 未记录。"}
completionGate: {"version":"v0.2","l3":"required","userPath":["同一固定短课堂要求下，普通 baseline 与两个隔离合成身份 A/B 各生成一次课堂；A/B 生成前通过正式 DeepTutor Launch/Fusion 路径建立 Session，生成绑定由服务端 Session 和 HttpOnly Cookie 强制执行；随后审查导出与 A/B 方向性差异。"],"integrationEvidence":["docs/log/artifacts/F24/prelesson-verification-v0.2.md","docs/log/artifacts/F24/independent-review.md","classroom/review/F24/fixed-requirement-v1/manual-review.md"],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"DeepTutor","branch":"fusion-adapter","commit":"afc8af303c71d32bc144f549a628d58f310fbadc"},{"path":"OpenMAIC","branch":"fusion-adapter","commit":"d4d6604dbf597c38957ebe6440361762a0673f1a"}]}}
---

# F24 正式课前个性化端到端验收

## 目标

验证 F23 的最小闭环，而不继续扩建生成基础设施：使用两个隔离、可清理、明确授权的合成集成身份 A/B，各自经过正式 Launch、真实 Profile/Map API、HttpOnly Cookie 和权威 Session；另生成一个普通无 Fusion baseline。三组使用同一个固定短课堂要求与受控生成配置，导出后复用 F03 审查，并任选 A 或 B 继续进入既有课中与课后闭环。

F24 是验收 Feature。除增加第二个合成身份和必要测试 fixture 外，不修改 OpenMAIC 产品实现；若发现 F23 缺陷，应回到 F23 修复或建立独立修复 Feature，不能借 F24 扩大实现范围。

## 范围扩展：本地正式 Fusion 连接入口

用户确认当前 PowerShell-only 的 Launch 会话不能被普通 OpenMAIC 生成界面使用，批准在 F24 中补齐最小本地入口。页面新增“正式 Fusion（本地测试）”卡片：显示服务器预配置连接状态、测试连接，并在显式 development-only 开关启用时为当前 DeepTutor 合成测试身份创建一次正式 Session。页面只保存不透明的 `lessonSessionId`；委托凭证仍只在 OpenMAIC 服务端与外部 secret 文件中，浏览器不读取 DeepTutor Profile/Map、Token 或服务地址。

- DeepTutor 地址继续仅由 OpenMAIC 服务端 `DEEPTUTOR_FUSION_BASE_URL` 配置；UI 不接受或显示任意 URL，避免浏览器驱动服务端外连。
- development-only 启动由 `FUSION_DEVELOPMENT_UI_ENABLED=true` 显式打开；生产环境一律拒绝，仍须通过 DeepTutor 的真实用户授权路径获得 Launch Code。
- 此入口与 F02 “演示学生 A/B”并列但语义明确隔离；不能把 Demo Session 作为 F24 证据。
- 正式会话创建成功后，`lessonSessionId` 随同既有生成请求传递；生成路由仍只认可 HttpOnly Cookie 恢复的服务端 Session。

## 集成决策

- A/B 身份：都是 allowlist 下的合成集成身份，具有确定性且不同的最小 Profile/Map；不使用 Mock Provider、F02 Demo 或真实学生资料。
- baseline：普通 OpenMAIC 课堂，不携带正式 Fusion lessonSessionId、Cookie、画像或 Demo session id。
- 对照控制：baseline/A/B 使用同一课堂要求、主题、语言、模型与可控配置，并记录课堂要求 SHA-256 和配置摘要。
- 验收强度：v0.1 经用户确认费用后，各生成一次 baseline/A/B，作为正式链路和可追溯差异的产品烟测；不以三份产物证明教学有效、统计显著性或画像是唯一因果来源。
- 自动测试：使用无密钥、无外部模型 stub 验证确定性上下文与路由绑定；真实生成只在人工路径执行。
- 审查文件：测试声明保存在本 Feature 合同目录；F03 脱敏报告写入 `classroom/review/F24/<测试批次>/`。原始课堂导出不作为外部 AI 输入或 Git 证据。

## v0.1 已归档验收标准

- v0.1 的五项端到端验收标准已由下方 v0.2 课前验收标准取代；其中课中/课后运行时路径移交 F26/F27，未在 F24 评估或标记通过。

## 完成证据

- 验证证据：`docs/log/artifacts/F24/verification-summary.md`
- 独立审查：`docs/log/artifacts/F24/independent-review.md`

## v0.2 范围调整（2026-07-30）

用户确认将 F24 收敛为“正式课前个性化生成验收”。本节优先于本文此前所有将课中或课后闭环列为 F24 通过条件的表述。

- F24 保留：普通 baseline 与两名合成学习者 A/B 的单次受控生成、正式 Launch/Profile/Map/HttpOnly Session 到 outline/content/actions 的服务端绑定、课堂导出审查、A/B 方向性人工审查，以及脱敏追溯证据。
- F24 不再要求：在本 Feature 中实际提交 checkpoint、执行诊断/Scene 调整、生成课后 Candidate 或投递 Outbox。这些运行时验证分别移交 F26（课中）与 F27（课后）；当前已知课中问题不会被伪装为已通过。
- 既有导出的 `manifest.json` 不要求包含 `fusionCheckpoint`。可接受的课前追溯证据是：正式 Session 生成路径的代码/自动化测试、用户确认的 A/B 正式连接和生成操作，以及不含 learner、Session ID、Cookie、Token、Profile 或 Map 原文的审查结论。

## 验收标准

- [x] baseline、A、B 各有一份导出；测试声明记录同一受控需求指纹，F03 审查通过共同要求。
- [x] A/B 在生成前均经正式 DeepTutor Launch 路径建立 Session；生成请求的 `lessonSessionId` 只在配对的 HttpOnly Cookie 恢复成功后生效，并冻结最小教学上下文。
- [x] 自动化测试证明正式 Session 的教学上下文被用于 outline/content/actions，且正式路径拒绝伪造、失配或不可恢复的 Session。
- [x] 人工审查确认 A 为基础/支架方向、B 为应用/挑战方向；报告明确单次生成和模型随机性的限制。
- [x] 独立审查确认上述边界、证据和测试，无未解决的课前阻塞项。
