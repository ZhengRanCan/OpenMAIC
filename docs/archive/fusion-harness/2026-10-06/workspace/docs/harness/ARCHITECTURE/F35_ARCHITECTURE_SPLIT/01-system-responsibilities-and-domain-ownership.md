# Architecture — 系统职责与领域所有权

> 定义 DeepTutor、OpenMAIC、Fusion Adapter 与 Browser 的权威职责。

> 💡 **上下文锚点**：
>
> - Adapter 分层与信任边界：[02-fusion-adapter-layering-and-trust-boundaries.md](02-fusion-adapter-layering-and-trust-boundaries.md)。
> - 身份与权威状态：[03-identity-lesson-binding-and-authoritative-state.md](03-identity-lesson-binding-and-authoritative-state.md)。
> - 核心对象与阶段交接：[04-core-domain-objects-and-stage-handoffs.md](04-core-domain-objects-and-stage-handoffs.md)。

<!-- ARCHITECTURE-SPLIT: body-start -->

## 1. 系统职责与领域所有权

本工作区由两个独立应用组成。DeepTutor 负责学习者、知识与长期学习状态，OpenMAIC 负责课堂生成、互动和执行；Fusion Adapter 以服务端防腐层连接两端。两个 Fork 保持独立部署、依赖和 Git 历史，根目录 Harness 只保存跨仓库合同、架构和验证证据。

| 区域 | 权威职责 | 明确不负责 |
| --- | --- | --- |
| DeepTutor | 用户身份；权威知识引用；Memory、Mastery、DeepTutor internal Quiz / Learning Evidence 与有效学习记录；学习诊断；长期画像候选的校验、聚合和持久化 | OpenMAIC Scene、课堂路由、播放器状态、组件或 UI 命令 |
| OpenMAIC | 课堂生成；Scene Catalog；checkpoint 与课堂运行态；实际执行结果；课堂事实、closeout 和即时总结 | 长期 mastery、稳定偏好、长期薄弱点或误解的权威写入 |
| Fusion Adapter | 跨域端口、契约映射、授权校验、版本与引用校验、数据最小化、错误归一化和传输隔离 | 拥有长期画像、创造学习结论，或直接控制浏览器和播放器 |
| Browser | 展示课堂、提交受控交互、持有 OpenMAIC 自身的短期会话凭据 | 直连 DeepTutor、持有跨应用凭证，或覆盖服务端 learner、Map、revision 和运行态 |

全局不变量：

1. 长期画像和结构化 Mastery 的唯一权威写入方是 DeepTutor。
2. 课堂生成、Scene 规划、运行态和实际执行事实的唯一权威方是 OpenMAIC。
3. 浏览器不是 Fusion 权威状态源；所有跨系统调用均为服务端到服务端。
4. 两端只交换完成当前授权目的所需的版本化领域投影，不直接读取对方内部文件、数据库或浏览器存储。
5. DeepTutor 只表达学习与教学决策语义；OpenMAIC 决定具体 Scene 和 UI 行为。
6. `PreClassTeachingContextProposal` 的具体生产算法属于 DeepTutor 内部实现；当前有界确定性管线与未来开放式 Agent 都必须通过同一版本化、严格校验的 Proposal 契约，跨边界不得暴露内部推理、工具轨迹、原始模型输出或 UI 命令。
7. 单次诊断、Candidate 接收或 Agent 输出都不等于长期学习状态已经更新。

F01 等固定 fixture 或 Mock 路径继续属于 Development Only，不能被当作生产身份、画像或故障回退来源；F02 的离线 A/B 演示 Demo 已随 F50 退役。
