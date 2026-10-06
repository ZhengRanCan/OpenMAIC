# F43 验证记录

2026-08-04：

- `pnpm --dir OpenMAIC exec tsc --noEmit`：通过。
- `pnpm --dir OpenMAIC exec vitest run tests/fusion/generation-session.test.ts tests/fusion/preclass-context-shadow.test.ts tests/fusion/scene-routes.test.ts`：13 项通过。
- F43 变更文件的 Prettier 检查、`git diff --check` 与 `pnpm --dir OpenMAIC build`：通过。
- 独立差异审查：正式路径只读取新冻结语义上下文；无 raw learner、credential 或浏览器 Profile/Map 覆盖；非 ready 被持久化，重复请求不触发静默 retry。
- 全量 `pnpm --dir OpenMAIC check` 未作为 gate：它报告仓库既有 1,436 个未格式化文件；F43 变更文件均已通过格式检查。
- Git：OpenMAIC `fusion-adapter`，`11c3335c524b9d87d4e6dbfaacb88719c15a8711`，已推送 `origin/fusion-adapter`。

`node scripts/harness-gate.mjs` 在根文档状态同步后执行。
