# F16 验证计划

## 必需命令（实施时执行）

| 层级 | 命令 | 目的 |
| --- | --- | --- |
| DeepTutor API | 在 `DeepTutor/` 运行 Launch Code 测试 | 验证签发、交换、过期、重放和 scope。 |
| OpenMAIC route | 在 `OpenMAIC/` 运行 launch route 测试 | 验证服务端凭证隔离和 learnerId 派生。 |
| 两端质量 | 分别运行范围内测试、lint/类型检查与 `git diff --check` | 检查两个 Fork。 |
| Harness | `node scripts/harness-gate.mjs` | 验证状态与证据。 |

## 人工验证路径

- [ ] 用获授权测试用户发起课堂，确认浏览器只传 Launch Code，OpenMAIC 成功启动课堂。
- [ ] 重放、过期和篡改启动码，确认失败且无 fallback。
- [ ] 审阅浏览器网络和日志，确认没有 DeepTutor Token/Cookie 或 learnerId 伪造入口。
