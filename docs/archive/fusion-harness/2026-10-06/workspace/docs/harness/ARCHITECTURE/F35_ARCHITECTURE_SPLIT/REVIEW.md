# F06 ARCHITECTURE 审核报告

> 历史审核记录：本文针对重组前的 F06 架构版本，保留为审查证据，不是当前规范或待办清单。当前全局 SSOT 为 `docs/harness/ARCHITECTURE.md`，生成分片与其一致；本文提到的字段和缺口必须以当前 SSOT、Feature Registry 与 FUSION 成熟度标记重新核对。

## 结论

文档与此前 F06 讨论的核心决策高度一致，整体可以作为目标架构文档使用。主要主线没有偏移：

- OpenMAIC 是课堂主控。
- DeepTutor 是身份、诊断和长期学生画像的权威来源。
- Fusion Adapter 位于 OpenMAIC 服务端，交换结构化数据。
- DeepTutor 输出教学意图，不直接操作 Scene 或 UI。
- OpenMAIC 提交课堂证据，DeepTutor 决定长期画像更新。
- OpenMAIC 维护 Scene Catalog 和运行态。
- 长期写回采用异步候选与 Outbox。
- 浏览器不是可信 Fusion 状态源。
- 正式接口均明确区分 Existing 与 Planned。
- 后续 A2A 只替换 Transport，不改变教育领域语义。

## 建议修正的关键问题

### 1. ClassroomEvent 名称与字段不完全匹配

当前 `ClassroomEvent` 实际描述的是 checkpoint 提交事件，但缺少通用事件模型通常需要的：

- `eventType`
- `sceneId`
- `courseId` 或课程引用
- `questionId` / `questionType`
- `correlationId` / `causationId`

建议二选一：

- 将对象改名为 `CheckpointSubmittedEvent`；或
- 保留 `ClassroomEvent`，增加通用事件 envelope，再把 checkpoint 数据放入 payload。

### 2. LearningDiagnosis 缺少 correctness

此前讨论中，诊断应明确表达：

- correct
- incorrect
- partially_correct
- unknown

当前契约只有 misconception 与 confidence。建议增加 `correctness`，避免 OpenMAIC 只能依赖本地评分推断 DeepTutor 的诊断结论。

### 3. TeachingIntent 缺少教学策略字段

Scene Catalog 使用 `teachingStrategyTags[]` 匹配补救 Scene，但 `TeachingIntent` 目前只有：

- kind
- targetLessonKnowledgePointIds
- rationaleCode

缺少 `strategy` 或 `teachingStrategyTags`，因此无法完成此前确定的“知识点 + 教学策略”映射。建议增加：

```text
strategy: example | comparison | visual | step_by_step
```

或版本化标签数组。

### 4. 时序图中 Store 不应直接调用 DeepTutor

端到端时序中写成：

```text
Fusion Stores -> DeepTutor
```

Store 是持久化端口，不应承担网络投递职责。建议增加：

- `Outbox Worker`
- 或 `Fusion Adapter Background Worker`

正确关系应为：

```text
OutboxStore -> Worker -> DeepTutor
```

### 5. MVP 范围需要区分“Demo MVP”和“目标架构 MVP”

文档把以下内容列为 MVP 必需：

- 真实学生流程
- launch code 交换
- 最小权限委托

但这些接口同时被标记为 Planned。此前讨论允许 Demo 阶段使用 Development Only 的固定测试身份或 Mock Provider。

建议拆成：

- `Demo MVP`：允许固定 learner、Mock Profile / Mock Identity，跑通课堂闭环。
- `Integrated MVP`：真实 launch code、委托令牌和真实 DeepTutor Fusion API。

这样不会让身份系统阻塞当前 Demo。

## 次要建议

### Scene role 可考虑增加 summary

当前角色只有：

```text
teach | checkpoint | remediation
```

若课堂总结也是明确 Scene，可增加 `summary`；若总结不属于 Scene，则在文档中说明。

### engagement_signal 可能超出当前 MVP

`ProfileUpdateCandidate` 中包含 `engagement_signal`。当前 Demo 主要基于 Quiz/课堂回答，没有明确的互动参与度采集。可以保留为扩展枚举，但标记为非 MVP。

### 生产级可靠性内容可以保留，但实施时分期

熔断、lease、dead-letter、凭证仓库等与已讨论决策一致，但明显高于一周 Demo 的实现需求。建议保留在目标架构中，同时在实施计划中明确“不作为第一阶段验收阻塞项”。

## 审核结果

- 核心方向：一致
- 职责边界：一致
- 数据流：基本一致
- 画像更新权责：一致
- Scene 动态调整：一致
- 身份与持久化：一致，但偏目标架构
- 需要修改：4 个契约/时序问题
- 需要澄清：Demo MVP 与正式集成 MVP 的范围
