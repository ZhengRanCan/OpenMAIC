# Architecture — 课前 → 课中 → 课后主链路

> 定义从课前冻结上下文到课中可信事实和课后 Candidate 的主链路。

> 💡 **上下文锚点**：
>
> - 核心对象与阶段交接：[04-core-domain-objects-and-stage-handoffs.md](04-core-domain-objects-and-stage-handoffs.md)。
> - DeepTutor 画像处理：[06-deeptutor-profile-processing-boundary.md](06-deeptutor-profile-processing-boundary.md)。
> - 完整性与生命周期：[07-integrity-reliability-security-and-lifecycle.md](07-integrity-reliability-security-and-lifecycle.md)。

<!-- ARCHITECTURE-SPLIT: body-start -->

## 5. 课前 → 课中 → 课后主链路

三阶段共享同一个 lesson session、课前语义根和版本化知识映射，不允许分别拉取或拼接互不关联的 Profile、Map、Guidance、事件和 Candidate。

```text
Launch / LessonBinding
  -> 课前语义握手
     -> FrozenLessonGenerationContext
        -> 课中 CheckpointAttempt / Event
           -> LearningDiagnosis / TeachingIntent
              -> SceneDirective(planned)
                 -> SceneExecutionReceipt / ObservationFact
                    -> 课后 atomic closeout / FrozenLessonFactSet
                       -> mapped-only Candidate / Outbox
                          -> DeepTutor Candidate Inbox / Receipt
                             -> Fusion Fact / Mastery / Memory Outcome
```

### 5.1 课前：语义握手与冻结上下文

课前不是 OpenMAIC 分别拉取 Profile 和 Knowledge Map 后在本地拼接，而是一次课程语义上下文化握手：

1. OpenMAIC 以服务器拥有的课程主题、目标、受众、材料引用和生成约束形成语义请求。
2. DeepTutor 在同一请求下解释课程范围、对齐权威知识、投影课内相关 learner 状态并提出 Teaching Guidance。
3. Adapter 校验授权、schema、引用、范围、revision 和 digest，不静默修正冲突。
4. 只有 ready 且语义一致的结果才能冻结为 `FrozenLessonGenerationContext`。
5. outline、内容、checkpoint 和 Scene Catalog 共同读取该不可变上下文，浏览器不能覆盖 learner、Map、Profile、Guidance 或 revision。

澄清、partial、范围缩小和普通课堂恢复必须使用显式产品状态。`ready` 的冻结资格取决于课程语义、Knowledge Map、授权、schema、revision 与 digest 的可信关联，而不取决于 Learner 画像是否丰富；`insufficient_data` 是可冻结的显式 Projection 状态。`partial`/`unresolved` 只用于课程语义、知识映射或关键协议关联无法可靠解析。普通课堂仅在可信 Fusion Context 无法建立、不可恢复故障或用户明确退出时，作为新建独立 non-Fusion Session 的显式恢复路径；不得静默降级或复用失败 Fusion 的 digest、Map、Guidance、旧 Profile/Map 或冻结数据。范围缩小或修订只能由当前课堂发起人经服务器 Session 绑定确认，教师可协助但不得独立覆盖；每个初始请求最多一次实质修订，且必须产生新的 request revision、digest 和 Fusion Session。`needs_clarification` 只能由发起人显式补充，`partial`/`unresolved`/`rejected` 不得自动修订或重试。详细协议见 [`FUSION/02`](/docs/harness/FUSION/02-pre-class-semantic-exchange-protocol.md)。

### 5.2 课中：可信证据、独立诊断与实际执行

OpenMAIC 必须先为正式 checkpoint 创建服务器拥有的 `CheckpointAttempt`。浏览器只提交 opaque attempt 标识和 learner 输入，不能提交 learner、Map、checkpoint、question revision、correctness 或 RuntimeState 覆盖。

已提交事件在调用 DeepTutor 前可靠持久化。诊断成功时，DeepTutor 返回独立 `LearningDiagnosis + TeachingIntent`；证据不足或诊断不可用时，已发生事件仍形成可追踪的 durable degradation，不伪造 misconception 或长期画像结论。

OpenMAIC Planner 将经过校验的 TeachingIntent 转换为 `SceneDirective(planned)`。计划写入不等于播放器已经执行；只有与已签发 Directive、nonce 和 expected revision 匹配的 `SceneExecutionReceipt` 才能把 Directive 标为 executed 并推进权威 RuntimeState。正常 `continue` 是成功决策，不应被记为 degraded。

详细协议见 [`FUSION/04`](/docs/harness/FUSION/04-in-class-semantic-exchange-protocol.md)。

### 5.3 课后：冻结事实、可靠投递与结果分离

课堂完成只等待 OpenMAIC 本地权威事务，不等待 DeepTutor、Agent、Mastery 或 L3：

1. 锁定 Session 并关闭新的 event intake。
2. 冻结全部可信 Observation Facts，形成 `FrozenLessonFactSet` 和 digest。
3. 只从属于 frozen set、完整 mapped 且 provenance 有效的观察生成零个或一个 Candidate。
4. completed 状态、fact set、Candidate 和 Outbox 在同一权威事务边界提交。
5. 后台 Worker 使用独立最小服务身份投递不含 learner 的 Candidate。
6. DeepTutor 通过持久 Lesson Binding 恢复 learner，事务写入 Candidate Inbox 后返回严格 Receipt。
7. Receipt 更新投递状态；长期 Fact、Mastery、Agent Proposal 和 Memory Outcome 独立处理和查询。

相同幂等键与相同 payload hash 返回原接收语义；相同键但不同 hash 必须拒绝冲突。详细协议见 [`FUSION/06`](/docs/harness/FUSION/06-post-class-semantic-exchange-protocol.md)。

阶段门禁：课中正式语义依赖有效 `FrozenLessonGenerationContext`；课后正式语义依赖可信、含 mapping 和 execution outcome 的课中事实。旧 Session 只能按自身协议恢复或结束，不能在运行时伪造 digest、混合新旧语义根或双投递不同 Candidate family。
