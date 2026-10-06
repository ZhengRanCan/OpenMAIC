# F40 验证计划

## 必须验证

- OpenMAIC 与 DeepTutor 分别对 shared fixtures 计算 canonical JSON、UTF-8 byte length 和 SHA-256；逐项比对结果。
- 两端 parser 的未知字段、重复 key、未知 schema、缺失/额外字段、digest/revision 错配、越界引用、UI/Scene 字段、无效 Unicode/时间/数字和 payload 上限负向测试。
- 分别运行受影响 Fork 的单元/契约测试、类型检查或构建，以及独立代码审查。
- `node scripts/harness-gate.mjs`。

## 人工路径

- 审阅两个实现的白名单和错误码，确认它们没有接受 browser-supplied learner、凭证或 DeepTutor 内部对象，也没有产生 Route、Provider 或正式课堂读取副作用。

## 禁止事项

- 不运行真实模型或使用真实 learner、课堂、凭证、Cookie、Secret、数据库或生产服务。
- 不启动 F41–F45 的 Route、Session 双写、正式切换、真实 Agent 或旧路径退役工作。

