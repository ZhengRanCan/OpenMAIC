# F29 验证计划

## 验证范围

- 对照 F26/F27 报告逐条检查协议覆盖。
- 对照 OpenMAIC 当前 event、runtime、ledger、closeout、Candidate、Outbox 和 Receipt 客户端代码。
- 对照 DeepTutor 当前 diagnosis、delegation 和 profile update 接收代码。
- 检查三份阶段协议是否共同继承 Fusion 通用 ACL、安全和最小化边界。

## 禁止事项

- 不修改或执行两个 Fork。
- 不启动服务、浏览器、Worker、容器、数据库或模型。
- 不读取 Secret、Token、Cookie、`.env`、真实 learner 或真实课堂。
- 不修改 `ARCHITECTURE.md` 或运行 split/merge 写操作。

## 通过前检查

- [x] finding-to-protocol 矩阵覆盖 F26 7 条、F27 8 条 finding。
- [x] 课中协议明确 attempt authority、诊断独立性、幂等、降级和执行回执。
- [x] 课后协议明确 atomic closeout、mapped eligibility、service identity、persistent idempotency、strict receipt 和 lifecycle。
- [x] 课前、课中、课后协议的 semantic digest、Map revision 和 learner/session 绑定术语一致。
- [x] 文档未泄露内部数据、未规定 UI 命令、未把 Receipt 当作长期画像成功。
- [x] `node scripts/harness-gate.mjs` 返回 0 errors。
