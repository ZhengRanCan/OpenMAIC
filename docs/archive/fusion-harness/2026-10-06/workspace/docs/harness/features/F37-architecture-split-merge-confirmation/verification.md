# F37 验证计划

## 必须检查

- `node scripts/architecture-split.mjs check`
- `node scripts/architecture-split.mjs merge`
- 对比 merge 前后 `docs/harness/ARCHITECTURE.md` SHA-256。
- merge 后再次执行 `node scripts/architecture-split.mjs check`。
- `node scripts/harness-gate.mjs`

## 禁止事项

- 不修改 ARCHITECTURE 语义。
- 不修改 FUSION 文档内容。
- 不修改两个 Fork 或应用运行时代码。

