# F57 — Outline field preservation

## 状态

- `passing`
- version: `v0.1`

## 目的

修复 scene outline 从 `scene-outlines-stream` 到 `done`、Fusion session 持久化/恢复以及浏览器 session 状态之间的合法字段丢失。重点字段包括 `widgetType`、`widgetOutline`、`teachingObjective`、`estimatedDuration`，并保持其他合法 outline 配置与 Fusion server-owned metadata。

## 用户路径

1. 正式 Fusion session 请求 scene outline stream。
2. SSE `outline` 与 `done` 事件携带完整 scene outline。
3. 服务端将正式 outline 持久化到 session。
4. 后续 `resolveFormalFusion` 恢复同一 outline。
5. 浏览器保存并继续使用完整 outline，不能因中间序列化或 server projection 丢失 interactive 配置。

## 核心验收标准

- stream/done 中已有的共享字段和 per-type 配置保持不变。
- Fusion session stored outline 恢复 `widgetType`、`widgetOutline`、`teachingObjective`、`estimatedDuration`、quiz/PBL/legacy interactive 配置及媒体字段。
- formal scene catalog 的普通 scene 不再只保留 title/type/description/keyPoints；checkpoint/remediation metadata 仍由服务端生成且保持不变。
- 浏览器使用 SSE `done.outlines` 作为 session/store 输入，不用不完整的二次 projection 覆盖完整 outline。
- 无效或不安全的字段不会被当作 Fusion binding 接受；`fusionCheckpoint` 仍只来自服务端正式数据。
- ordinary non-Fusion generation 不回归。

## 允许修改

- `OpenMAIC/lib/fusion/generation-session.ts`
- `OpenMAIC/app/api/generate/scene-outlines-stream/route.ts`（仅字段保留相关逻辑）
- `OpenMAIC/app/generation-preview/page.tsx`（仅 session/store 字段传递）
- 相关类型、测试、feature evidence 与 harness 状态文档

## 明确不在范围

- Fusion/browser 类型 reconciliation（F56 已完成）。
- checkpoint/remediation 业务设计（F54）。
- 浏览器覆盖 server-owned Fusion metadata。
- 模型提示词质量或 DeepTutor 数据边界变更。

## 验证要求

- 自动测试覆盖完整 interactive outline 经 formal persistence/recovery 后字段不丢失。
- 自动测试覆盖 checkpoint/remediation metadata 保持服务端权威。
- 运行相关 Vitest 与 `pnpm exec tsc --noEmit`。
- 完成一次独立只读复核，并记录 Git commit/push evidence。
