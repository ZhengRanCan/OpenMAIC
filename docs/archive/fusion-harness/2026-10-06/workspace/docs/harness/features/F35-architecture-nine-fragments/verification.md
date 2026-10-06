# F35 验证计划

## 必需检查

- `node scripts/architecture-split.mjs split`
- `node scripts/architecture-split.mjs check`
- 检查九个 fragment 文件与九个 H2 一一对应。
- 检查 ARCHITECTURE/split Markdown 链接和 code fence。
- `node scripts/harness-gate.mjs`

## 禁止事项

- 不修改架构正文语义、FUSION 文档或两个 Fork。
- 不保留旧六片作为第二套生成视图。
