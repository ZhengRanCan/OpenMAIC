# F08 验证计划

## 必需命令（实施时执行）

| 层级 | 命令 | 目的 |
| --- | --- | --- |
| API 单元/集成 | 在 `DeepTutor/` 运行 `tests/api/test_fusion_diagnosis.py` | 验证请求校验、确定性诊断和 Development Only guard。 |
| 既有 Fusion 回归 | 在 `DeepTutor/` 运行 `integrations/openmaic/fusion/tests/**` 的现有命令 | 确保 F01 Demo 契约不回归。 |
| 静态 | `git -C DeepTutor diff --check` | 检查改动质量。 |
| Harness | `node scripts/harness-gate.mjs` | 验证状态与证据。 |

## 人工验证路径

- [ ] 使用合成的正确与错误答案分别调用开发 API，确认 `eventId` 不变，`correctness`、misconception 与 intent 符合固定规则。
- [ ] 关闭 Development Only 配置再次调用，确认 API 明确拒绝且无持久化副作用。
- [ ] 检查响应，不包含任何 Scene ID、UI 命令、原始 Memory、凭证或真实用户信息。

## 通过前的证据要求

- 记录脱敏请求/响应示例、错误码、测试输出和 DeepTutor Git 证据。
- 记录诊断仅为本题即时结论、不会写入长期画像的确认。
