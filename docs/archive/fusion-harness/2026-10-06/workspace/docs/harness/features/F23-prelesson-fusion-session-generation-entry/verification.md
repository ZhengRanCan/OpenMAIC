# F23 验证记录

## 自动验证

- [x] `generation-session`：Cookie/`lessonSessionId` 匹配、CAS 冻结、二次 outline 拒绝、最小化与服务器大纲持久化。
- [x] `teaching-context` / `profile-driven-generation`：保守语义、最小 Prompt 和身份脱敏。
- [x] outline/content/actions：正式路径忽略浏览器 profile、requirement、语言指令、Demo Session、outline 与页数；普通与 F02 Demo 回归。
- [x] Catalog checkpoint/remediation Scene 与 F10 Planner 的 target Scene ID 一致。
- [x] Prettier、ESLint、TypeScript、生产构建及完整 Git 差异检查通过。

## 人工烟测

- [x] 在隔离 test-only DeepTutor host 与一次性本地 Docker PostgreSQL 上运行 F16 Launch → OpenMAIC HttpOnly Session → formal outline/content/actions。
- [x] 确认脱敏的固定短课堂要求、mapping id/revision、知识点、checkpoint 与 remediation 绑定；伪造 Session、缺 Cookie、二次 outline 分别被拒绝。
- [x] 测试服务、容器、Docker 卷、一次性凭证与临时文件均已清理。

## 证据要求

- [x] 仅记录脱敏摘要、固定要求 SHA-256、测试结果、人工路径和 Git SHA；不记录 learnerId、Profile/Map、Cookie、Token、Memory、Prompt、数据库或 Launch Code。
- [x] 独立规格审查与工程标准审查均已完成，最终无未解决 finding。
