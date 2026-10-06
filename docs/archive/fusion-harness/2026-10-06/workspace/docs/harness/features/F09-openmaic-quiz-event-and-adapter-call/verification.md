# F09 验证计划

## 必需命令（实施时执行）

| 层级 | 命令 | 目的 |
| --- | --- | --- |
| OpenMAIC Fusion 测试 | 在 `OpenMAIC/` 运行新增 Quiz 事件与 route 测试 | 覆盖事件字段、服务端补全和 Adapter 成功/失败。 |
| 相关回归 | 在 `OpenMAIC/` 运行 `pnpm test -- tests/fusion` | 确保 F02 路径不回归。 |
| 质量 | 在 `OpenMAIC/` 运行范围内 lint/type 检查与 `git diff --check` | 检查实现质量。 |
| Harness | `node scripts/harness-gate.mjs` | 验证状态与证据。 |

## 人工验证路径

- [ ] 在 Development Only 课堂提交一道固定 checkpoint 题；页面显示诊断处理中，随后显示可继续的即时结果。
- [ ] 断开/禁用诊断服务后重试；页面说明即时诊断不可用但仍可继续，不泄露 URL、凭证或内部异常。
- [ ] 在浏览器 Network 面板确认仅调用 OpenMAIC 同源 API，未请求 DeepTutor。

## 通过前的证据要求

- 记录成功与降级路径、相关 UI 状态、测试输出和 OpenMAIC Git 证据。
- 不保存真实题目、答案、令牌、完整 Prompt 或真实学生数据。
