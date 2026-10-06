# F30 验证计划

## 验证范围

- 检查两份新增 FUSION 文档是否覆盖当前讨论的身份、状态和后台流水线结论。
- 对照当前 DeepTutor Session Store、Memory Store、Consolidator、Multi-user Path、Mastery 和 Fusion fixture 代码验证现状描述。
- 检查新文档没有把目标设计表述成已经实现。
- 检查没有修改既有 FUSION `01–05`、两个 Fork 或架构 SSOT。

## 禁止事项

- 不运行服务、Agent、模型、Worker、数据库、容器或浏览器。
- 不读取真实用户 Memory、Session、Token、Cookie、Secret、数据库或课堂数据。
- 不修改 OpenMAIC、DeepTutor、`ARCHITECTURE.md` 或 FUSION `01–05`。

## 通过前检查

- [ ] 两份新增文档 Markdown code fence 平衡。
- [ ] 当前事实、目标方案与待实现内容明确区分。
- [ ] Learner Binding、Candidate Inbox、Fact Store 和画像流水线形成可追踪闭环。
- [ ] `node scripts/harness-gate.mjs` 返回 0 errors。
