# F36 验证计划

## 必须检查

- FUSION 文件结构与目标 01–10 一致。
- `rg` 确认旧 FUSION 文件名和旧编号引用不再作为当前路由出现。
- 检查 FUSION、ARCHITECTURE 和 ARCHITECTURE split 的 Markdown 链接有效。
- 检查 ARCHITECTURE 与 FUSION 的 SSOT 边界：全局架构在 ARCHITECTURE，专项协议/迁移/基础规范在 FUSION。
- `node scripts/architecture-split.mjs split`
- `node scripts/architecture-split.mjs check`
- `node scripts/harness-gate.mjs`

## 禁止事项

- 不修改现有协议设计语义。
- 不把课中、课后迁移方案提升为已审核正式实现方案。
- 不修改两个 Fork 或应用运行时代码。
