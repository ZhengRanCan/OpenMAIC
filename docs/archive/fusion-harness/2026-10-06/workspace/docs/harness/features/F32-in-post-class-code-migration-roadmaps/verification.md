# F32 验证计划

## 只读证据

- F26/F27 `review-report.md`、F29 finding matrix 与可行性审查。
- FUSION 03/04 目标协议、05 课前迁移模板、06/07 身份与画像流水线、08 digest 规范。
- OpenMAIC 当前 Fusion Session、event/diagnosis/runtime、completion/facts、Candidate/Outbox/Worker/Receipt 路径。
- DeepTutor 当前 diagnosis、Candidate receipt、身份上下文、Session/Memory/Mastery 路径。

## 检查

- 组件矩阵引用路径存在，处置分类唯一且理由可追踪。
- F26 7 项、F27 8 项 findings 精确覆盖。
- 每份路线包含数据库、双轨、shadow、回滚、退役和前置门禁。
- Markdown code fence 平衡，状态台账初始状态均为 `not_started`。
- `node scripts/harness-gate.mjs` 返回 0 errors。

## 禁止事项

- 不修改或运行两个 Fork。
- 不修改 FUSION `01–08` 或架构 SSOT。
- 不读取真实数据、凭证或本地数据库。
