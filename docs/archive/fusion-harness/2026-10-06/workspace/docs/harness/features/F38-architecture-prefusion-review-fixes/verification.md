# F38 验证计划

## 必须检查

- 人工核对审核意见 4 个主要问题和 2 个小问题均已反映。
- `node scripts/architecture-split.mjs split`
- `node scripts/architecture-split.mjs check`
- Markdown 链接与代码围栏检查。
- `node scripts/harness-gate.mjs`

## 禁止事项

- 不修改 FUSION 文档。
- 不修改两个 Fork 或应用运行时代码。
- 不把课中/课后迁移提升为已审核正式实现路线。

