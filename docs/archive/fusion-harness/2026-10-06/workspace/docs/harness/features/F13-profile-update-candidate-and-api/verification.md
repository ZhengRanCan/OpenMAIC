# F13 验证计划

## 必需命令（实施时执行）

| 层级 | 命令 | 目的 |
| --- | --- | --- |
| OpenMAIC Candidate 测试 | 在 `OpenMAIC/` 运行 Candidate 投影测试 | 验证最小化、mapping 状态和幂等键。 |
| DeepTutor API 测试 | 在 `DeepTutor/` 运行 Profile Update API 测试 | 验证 receipt、去重、拒绝与隔离开发记录。 |
| Fusion 回归 | 分别运行两端相关 Fusion 测试 | 防止 F07–F12 回归。 |
| Harness | `node scripts/harness-gate.mjs` | 验证状态、证据与分片。 |

## 人工验证路径

- [ ] 对同一脱敏 Candidate 连续投递两次，确认第一次被接收/排队、第二次为 duplicate，candidateId 不变。
- [ ] 使用 lesson_local 或 unresolved 知识点构造候选，确认不能成为长期 mastery 证据。
- [ ] 查看 DeepTutor 开发记录/响应，确认它只反映候选接收，未声称真实长期画像已变化。

## 通过前的证据要求

- 记录脱敏 Candidate/Receipt 摘要、测试结果、拒绝路径和两 Fork Git 证据。
- 不记录真实学生数据、Token、Cookie、完整题目答案、Memory 或完整 Prompt。
