# F11 验证计划

## 必需命令（实施时执行）

| 层级 | 命令 | 目的 |
| --- | --- | --- |
| DeepTutor API | 在 `DeepTutor/` 运行 F08 诊断测试 | 确保诊断输入/输出不回归。 |
| OpenMAIC 集成 | 在 `OpenMAIC/` 运行 Fusion 测试与新增 E2E/集成测试 | 验证事件、Planner、Scene 执行与降级。 |
| 两端质量 | 分别运行范围内 lint/测试、`git diff --check` | 检查两 Fork。 |
| Harness | `node scripts/harness-gate.mjs` | 验证 Feature、分片和证据门禁。 |

## 人工验证路径

- [ ] 正确回答固定 checkpoint：课堂继续，未插入补救页。
- [ ] 故意错误回答：显示即时处理状态并只插入一张匹配补救页；随后可回到当前 checkpoint。
- [ ] 使用不匹配策略、再次触发同一 remediation 或超过 retry 上限：课堂继续且显示不泄密降级原因。
- [ ] 停止 DeepTutor 后提交：课堂仍可继续，状态明确为即时诊断不可用；浏览器网络中没有 DeepTutor 请求或凭证。

## 通过前的证据要求

- 记录四路径截图/步骤、自动测试输出、reasonCode 摘要、无敏感信息的日志关联和两 Fork Git 证据。
- 不记录真实题目/答案、真实 learner、令牌、Cookie、完整 Prompt、Memory 或完整诊断原文。
