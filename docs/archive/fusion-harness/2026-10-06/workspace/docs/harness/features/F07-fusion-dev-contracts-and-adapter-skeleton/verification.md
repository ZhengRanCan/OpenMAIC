# F07 验证计划

## 必需命令（实现时执行）

| 层级 | 命令 | 目的 |
| --- | --- | --- |
| DeepTutor 契约 | 在 `DeepTutor/` 运行新增 Fusion 契约测试 | 验证序列化、版本和 Development Only guard。 |
| OpenMAIC Adapter | 在 `OpenMAIC/` 运行新增 Fusion Adapter 测试 | 验证服务端 Facade、端口隔离与拒绝路径。 |
| 范围检查 | 分别运行 `git -C DeepTutor diff --check`、`git -C OpenMAIC diff --check` | 检查空白与非预期改动。 |
| Harness | `node scripts/harness-gate.mjs` | 验证 Feature 状态、分片和证据门禁。 |

## 人工验证路径

- [ ] 在 development/test 配置下，维护者可看到固定 mock learner 仅由服务端开发配置派生，而非浏览器请求字段。
- [ ] 在 production 或未启用开发 Mock 的配置下，同一路径明确拒绝，并且不回退到任何固定 learner。
- [ ] 审阅公开 Adapter 类型，确认没有 DeepTutor URL、Token、Cookie、原始 Memory 或 UI 指令泄漏。

## 通过前的证据要求

- 记录两端命令、测试数量、固定 mock 配置的脱敏说明和拒绝路径。
- 记录独立审查结论与每个改动 Fork 的 `fusion-adapter` 分支、40 位 commit SHA、已推送证明。
- 不记录实际凭证、真实学生数据、完整 Prompt 或 Memory 内容。
