# F17 验证计划

## 必需命令（实施时执行）

- 在 `OpenMAIC/` 运行 session recovery 与现有 Fusion 测试。
- 在 `OpenMAIC/` 运行范围内 lint/类型检查及 `git diff --check`。
- 从根目录运行 `node scripts/harness-gate.mjs`。

## 人工验证路径

- [ ] 在真实授权测试课堂刷新页面，确认 Scene、冻结快照和降级状态恢复。
- [ ] 清除/篡改 Cookie、使用另一测试用户或过期会话，确认安全拒绝和恢复入口。
- [ ] 检查浏览器存储与网络，确认不存在 DeepTutor token 或 learnerId 覆盖字段。
