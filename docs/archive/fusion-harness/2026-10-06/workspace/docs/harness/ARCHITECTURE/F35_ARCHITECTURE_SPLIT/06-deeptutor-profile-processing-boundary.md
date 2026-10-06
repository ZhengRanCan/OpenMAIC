# Architecture — DeepTutor 画像处理边界

> 定义 Candidate、Fusion Fact、Mastery、Agent Proposal 与 Memory 的处理边界。

> 💡 **上下文锚点**：
>
> - 身份与用户作用域：[03-identity-lesson-binding-and-authoritative-state.md](03-identity-lesson-binding-and-authoritative-state.md)。
> - 三阶段主链路：[05-pre-in-post-class-main-flow.md](05-pre-in-post-class-main-flow.md)。
> - 完整性与生命周期：[07-integrity-reliability-security-and-lifecycle.md](07-integrity-reliability-security-and-lifecycle.md)。

<!-- ARCHITECTURE-SPLIT: body-start -->

## 6. DeepTutor 画像处理边界

DeepTutor 是对话型 Agent 系统，但 Fusion 后台处理不依赖某个 Agent 实例或聊天 Session 持续存活。每次 Processing Run 都从持久 Binding、Candidate、Facts、Memory 和 Mastery 状态重建受限用户上下文。

目标处理边界为：

```text
Candidate Inbox
  -> FusionLearningFact
     ├-> deterministic Mastery Evidence Projector
     │   -> Mastery Outcome
     └-> constrained ProfileFactProposal Agent
         -> Proposal Validator
         -> Fusion Memory Surface
         -> L2/L3 Consolidation
```

架构不变量：

1. Candidate 是外部观察候选，不是 DeepTutor 内部事实或画像写入命令。
2. Candidate Inbox 负责可靠接收、身份关联、幂等和处理调度；Memory Markdown、L1 Trace、Chat Session Store 或文件 Queue 不能充当权威 Inbox。
3. FusionLearningFact 保留 Candidate/Observation、lesson、知识映射和 provenance，不能把外部 payload 直接插入现有 Quiz/Evidence 表冒充内部事实。
4. Mastery 由确定性领域服务按多条可信证据更新；Agent 不直接修改 mastery 数值。
5. Agent 只产生带 supporting facts 和版本的结构化 Proposal；Validator 决定是否进入 Fusion Memory Surface。
6. Agent 不直接覆盖 L2/L3 Markdown，不从单条 Candidate 推断稳定偏好、人格或永久薄弱点。
7. L2/L3 Consolidation 是异步、可恢复且按 learner/slot 控制并发的下游过程，不在 Candidate 接收请求中同步执行。
8. Candidate `accepted`、facts projected、mastery applied、L2 updated 和 L3 updated 是不同状态和 revision，不能用一个 success 代替。

mapping、diagnosis、observation 和 aggregation confidence 表达不同来源和含义，不能相乘或压缩为通用总分。它们到 Candidate wire schema 和 canonical hash profile 的最终映射仍为待决项。

本节只吸收 DeepTutor 内部处理的系统级边界。L1/L2/L3 结构、逻辑表、Worker、Projector、Agent schema、调度阈值和物理存储选型继续由 [`FUSION/08`](/docs/harness/FUSION/08-deeptutor-learner-state-and-identity-resolution.md)与 [`FUSION/09`](/docs/harness/FUSION/09-candidate-inbox-driven-profile-pipeline.md)定义。
