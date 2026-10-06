# Architecture — 核心领域对象与阶段交接

> 定义全局核心领域对象、所有权、共同关联和阶段交接。

> 💡 **上下文锚点**：
>
> - 身份与权威状态：[03-identity-lesson-binding-and-authoritative-state.md](03-identity-lesson-binding-and-authoritative-state.md)。
> - 三阶段主链路：[05-pre-in-post-class-main-flow.md](05-pre-in-post-class-main-flow.md)。
> - 完整性规范：[07-integrity-reliability-security-and-lifecycle.md](07-integrity-reliability-security-and-lifecycle.md)。

<!-- ARCHITECTURE-SPLIT: body-start -->

## 4. 核心领域对象与阶段交接

全局架构只定义对象职责、所有权和阶段交接。具体字段、枚举、reason code、schema、状态机和 HTTP/A2A 形状保留在 FUSION 专项协议及实现 Feature 中。

| 阶段 | 核心对象 | 权威方与交接语义 |
| --- | --- | --- |
| 课前输入 | `LessonGenerationIntent`、`LessonSemanticRequest` | OpenMAIC 表达要生成什么课；Adapter 规范化并校验授权范围 |
| 课前输出 | `PreClassTeachingContextProposal`、`FrozenLessonGenerationContext` | DeepTutor 提出 Map、课内画像投影和 Guidance；OpenMAIC 只消费同一语义根下的冻结结果 |
| 课中证据 | `CheckpointAttempt`、`ClassroomEvent` / `LearningEvidenceRequest` | OpenMAIC 服务器签发 attempt、持久化已发生的 checkpoint 事实；浏览器只提交受控输入 |
| 课中决策 | `LearningDiagnosis`、`TeachingIntent` | DeepTutor 独立解释证据并返回协议无关教学意图，不指定 Scene/UI |
| 课中执行 | `SceneDirective`、`SceneExecutionReceipt`、`ClassroomObservationFact` | OpenMAIC 规划并执行 Scene；只有有效执行回执才能推进权威 RuntimeState |
| 课后冻结 | `FrozenLessonFactSet` | OpenMAIC 在 closeout 事务内冻结本课全部可信事实 |
| 课后投递 | `ProfileUpdateCandidate`、`ProfileUpdateReceipt` | OpenMAIC 提交最小观察候选；DeepTutor 持久接收、校验、去重并返回严格关联 Receipt |
| DeepTutor 下游 | `FusionLearningFact`、`CandidateProcessingOutcome` | DeepTutor 将外部 Candidate 转换为内部事实，并分别报告 Mastery、Agent Proposal 和 Memory 处理结果 |

共同关联不变量：

1. 所有跨边界对象携带已知 `schemaVersion`；schema 版本与业务 revision 分开。
2. 课中和课后对象必须直接或可追溯地关联到课前冻结的 `semanticRequestDigest`、Map ID/revision 和受授权 lesson session。
3. 权威知识引用使用完整 `namespace + scopeId + id`；裸知识点 ID 不能跨 scope 冒充权威引用。
4. `lesson_local`、`unresolved` 或缺少完整映射的观察可以服务当前课堂，但不能进入长期 Candidate。
5. DeepTutor diagnosis 与 OpenMAIC local assessment 必须保留不同来源；本地评分不能被静默升级为 DeepTutor 结论。
6. `TeachingIntent` 不包含 sceneId、route、组件或播放器命令；`SceneDirective` 只属于 OpenMAIC。
7. Candidate 是观察证据，不包含 `newMastery`、`setWeakPoint`、稳定偏好等长期写入命令。
8. Receipt 的 accepted/queued/duplicate 只证明接收或去重，不证明 Fact、Mastery 或 L2/L3 已更新。

三个完整性值具有不同用途：

- `semanticRequestDigest` 绑定课前共同语义根。
- `factSetDigest` 冻结 closeout 的权威事实内容。
- `canonicalPayloadHash` 绑定实际 Candidate 语义，用于幂等冲突和 Receipt 关联。

详细阶段协议分别见 [`FUSION/02`](/docs/harness/FUSION/02-pre-class-semantic-exchange-protocol.md)、[`FUSION/04`](/docs/harness/FUSION/04-in-class-semantic-exchange-protocol.md)和 [`FUSION/06`](/docs/harness/FUSION/06-post-class-semantic-exchange-protocol.md)；三种 digest/hash 的规范化字节与算法以 [`FUSION/10`](/docs/harness/FUSION/10-canonical-hash-digest-and-integrity-specification.md)为专项 SSOT。
