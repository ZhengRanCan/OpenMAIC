---
id: F23
title: 正式课前个性化生成 MVP
version: v0.2
status: passing
dependsOn: ["F20"]
scope: {"code":["OpenMAIC/.env.example","OpenMAIC/app/api/fusion/launch/route.ts","OpenMAIC/app/api/fusion/session/route.ts","OpenMAIC/app/api/generate/scene-outlines-stream/route.ts","OpenMAIC/app/api/generate/scene-content/route.ts","OpenMAIC/app/api/generate/scene-actions/route.ts","OpenMAIC/lib/fusion/generation-session.ts","OpenMAIC/lib/fusion/teaching-context.ts","OpenMAIC/lib/fusion/scene-catalog.ts","OpenMAIC/lib/fusion/session-store/**","OpenMAIC/lib/fusion/session/**","OpenMAIC/lib/generation/scene-builder.ts","OpenMAIC/lib/types/generation.ts","OpenMAIC/lib/types/stage.ts"],"tests":["OpenMAIC/tests/fusion/generation-session.test.ts","OpenMAIC/tests/fusion/teaching-context.test.ts","OpenMAIC/tests/fusion/profile-driven-generation.test.ts","OpenMAIC/tests/fusion/outline-route.test.ts","OpenMAIC/tests/fusion/scene-routes.test.ts","OpenMAIC/tests/fusion/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F23-prelesson-fusion-session-generation-entry/**","docs/log/artifacts/F23/**","docs/harness/incidents/**"]}
evidence: {"lastVerifiedAt":"2026-07-28","commands":[{"command":"corepack pnpm test -- tests/fusion/generation-session.test.ts tests/fusion/teaching-context.test.ts tests/fusion/profile-driven-generation.test.ts tests/fusion/outline-route.test.ts tests/fusion/scene-routes.test.ts tests/fusion/classroom-event-route.test.ts tests/fusion/scene-directive-planner.test.ts","result":"passed"},{"command":"corepack pnpm exec prettier --check <F23 范围文件>","result":"passed"},{"command":"corepack pnpm exec eslint <F23 范围文件>","result":"passed"},{"command":"corepack pnpm exec tsc --noEmit","result":"passed"},{"command":"corepack pnpm build","result":"passed"},{"command":"git diff --check 84b1907255208ad39fd04beac7c9087d202d146c aa457da64c1cf28344473b0c6465f4fcf84c3ed3","result":"passed"}],"manualSmoke":"已通过：隔离 test-only DeepTutor host + 一次性本地 Docker PostgreSQL 完成正式 Launch、HttpOnly Session、outline/content/actions、checkpoint/remediation 与反向路径烟测；最终服务器大纲隔离与 Catalog Scene 绑定由新增自动回归覆盖。"}
completionGate: {"version":"v0.2","l3":"required","userPath":["操作者使用 F16 正式 Launch Code API 为隔离合成身份创建 OpenMAIC Fusion Session；一门固定短课堂的大纲、Scene 内容和动作使用同一 Session 冻结的最小教学上下文，含有与 LessonKnowledgeMap 绑定且可由 F10 Planner 定位的 checkpoint/remediation Scene。"],"integrationEvidence":["docs/log/artifacts/F23/verification-summary.md","docs/log/artifacts/F23/independent-review.md"],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"aa457da64c1cf28344473b0c6465f4fcf84c3ed3"}]}}
---

# F23 正式课前个性化生成 MVP

## 目标

一次正式 Fusion Session 只生成一门可在既有 15 分钟窗口内完成的固定短课堂。第一次 outline 以匹配的 HttpOnly Cookie 与 `lessonSessionId` 恢复权威 Session，冻结最小教学上下文；随后所有 Scene 内容与动作从服务器保存的正式大纲读取，不信任浏览器回传的画像、课程要求、语言指令、页数或大纲。

## 实现边界

- 正式路径使用权威 `ProfileSnapshot + LessonKnowledgeMap + SceneCatalog` 的最小投影；不向 Prompt 传递 learnerId、原始 Profile/Map、Memory、Cookie、Token 或浏览器画像。
- 首次 outline 通过 CAS 冻结上下文，并保存服务器拥有的大纲；同一 Session 的二次 outline/换题被拒绝。
- 服务端追加 Catalog 拥有的 quiz checkpoint 和 remediation Scene，二者 Scene ID 与 F10 Planner/RuntimeState 使用的 Catalog 匹配。
- 正式 content/actions 使用冻结的 requirement、保存大纲和服务器页数；普通课堂与独立 F02 Demo 保持原行为。
- 不引入同一 Session 多次生成、长期续期、产品 UI、真实学生开放或教学效果声明。

## 验收标准

- [x] 正式 outline 只通过匹配 Cookie + `lessonSessionId` 读取权威快照；浏览器字段不能覆盖服务端记录。
- [x] 第一次 outline 确定性冻结最小上下文与服务器拥有的大纲；后续 content/actions 复用它们，二次生成或换题被拒绝。
- [x] 课堂含有绑定冻结知识点及 mapping revision 的 checkpoint；F10 Planner 可定位同一课堂内的 remediation Scene。
- [x] `insufficient_data`、低 confidence、warnings 与未映射项采用保守语义；Prompt、响应和日志不泄露身份、原始快照或凭证。
- [x] 正式 Session 缺失、过期、不匹配或上下文畸形时明确失败并提示重新 Launch；普通课堂与独立 F02 Demo 回归通过。
- [x] 自动测试、类型检查、范围 Prettier/lint、生产构建、隔离人工烟测、独立审查、Git 推送证据与 Harness Gate 通过。

## 完成证据

- 验证证据：`docs/log/artifacts/F23/verification-summary.md`
- 独立审查：`docs/log/artifacts/F23/independent-review.md`
