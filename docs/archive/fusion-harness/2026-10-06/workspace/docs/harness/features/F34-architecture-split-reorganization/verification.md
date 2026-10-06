# F34 验证计划

## 必需检查

- `node scripts/architecture-split.mjs merge`
- `node scripts/architecture-split.mjs check`
- `node scripts/harness-gate.mjs`
- 检查 ARCHITECTURE 与 split 的相对链接、Markdown code fence 和九个 H2 主题。
- 检查全局架构未出现 FUSION 09/10 的具体阶段、DDL、shadow、回滚或组件迁移步骤。

## 人工路径

- 从职责/Adapter 沿身份、领域对象和三阶段主链路阅读到 DeepTutor 画像处理。
- 验证 FUSION `02–04、06–08` 的已确认架构结论被引用而非复制详细协议。
- 验证 FUSION `05` 仅为 reviewed reference，`09/10` 明确为 provisional/reference。

## 禁止事项

- 不直接编辑 `docs/harness/ARCHITECTURE.md`。
- 不修改两个 Fork、FUSION 目录或历史审核报告。
