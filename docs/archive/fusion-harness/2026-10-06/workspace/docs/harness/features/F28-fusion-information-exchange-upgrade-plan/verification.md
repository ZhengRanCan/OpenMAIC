# F28 验证计划

## 验证目标

确认 F28 准确描述 Fusion 信息交换层的改造范围，并能作为后续实现 Feature 的拆分依据；不验证尚未实现的新协议运行效果。

## 允许的验证方式

- 只读检查 OpenMAIC 当前课前 Route、Provider、Session、生成消费者和相关测试。
- 只读检查 DeepTutor Launch、delegation、Profile/Map Route 和相关测试。
- 对照 `docs/harness/FUSION/` 中的通用规范、课前协议、课堂前代码迁移路线、当前 `ARCHITECTURE.md` 和 F25–F27 审查报告。
- 使用 `rg`、文件读取、结构化差异清单和 `node scripts/harness-gate.mjs`。

## 禁止事项

- 不修改、格式化、测试、构建或运行 OpenMAIC/DeepTutor。
- 不启动服务、浏览器、容器、数据库或模型。
- 不读取 Token、Cookie、`.env`、Secret、真实 learner、真实课堂或本地数据库。
- 不创建 Fork commit、push 或伪造实现证据。
- 不修改 `ARCHITECTURE.md` 或运行 architecture split/merge 写操作。

## 追踪检查

- [x] 当前链路从 Launch Code 到 FrozenTeachingContext 的每个跳转都有代码位置。
- [x] 新协议中的 request、proposal、resolution、frozen context 都有对应改造组件。
- [x] Launch、delegation、credential store、Session、PostgreSQL、CAS 和可靠性设施被正确归类为复用或扩展。
- [x] 固定 Profile/Map、通用 JSON 校验、本地 guidance 拼接和固定 slope Catalog 被正确归类为替换或退役。
- [x] 双轨期没有生产 Mock 回退、跨 schema 拼接或浏览器身份覆盖。
- [x] 后续实现切片分别覆盖契约、DeepTutor Route、OpenMAIC Provider/Session、读取切换、Agent 计算和旧路径退役。

## 通过前检查

- [x] `feature-index.json`、F28 合同和 `docs/progress.md` 的状态一致。
- [x] Fusion 通用规范、课前协议与代码迁移路线链接有效，术语、迁移阶段和六条语义不变量一致。
- [x] 迁移路线明确标记所有代码阶段尚未开始，不把 F28 `passing` 表述为应用代码已经实现。
- [x] 所有验收项完成，且没有把设计目标陈述为当前已实现事实。
- [x] `node scripts/harness-gate.mjs` 返回 0 errors。
