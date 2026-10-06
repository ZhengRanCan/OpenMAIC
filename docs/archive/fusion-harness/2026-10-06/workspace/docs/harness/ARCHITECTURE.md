# Architecture

本文是 F06 的目标架构设计，不是实现说明。本文档是唯一 canonical source of truth（SSOT）；`docs/harness/ARCHITECTURE/F06_ARCHITECTURE_SPLIT/` 下的 01–06 分片由 `node scripts/architecture-split.mjs split` 生成，修改后可用 `check` 检测漂移。

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

## 2. Fusion Adapter 分层与信任边界

Fusion Adapter 是 OpenMAIC 与 DeepTutor 之间唯一允许的跨域中介和防腐层。MVP 阶段它可以作为 OpenMAIC Server 内部模块部署，不要求提前拆成独立微服务。

```text
OpenMAIC Application
  -> Fusion Facade / Application Orchestrator
     -> Fusion Domain Ports
        -> Contract Mapper + ACL Policy
           -> Transport
              -> DeepTutor Server

Supporting Infrastructure
  -> FusionSessionStore
  -> Credential / Service Identity Store
  -> Idempotency / Revision Store
  -> Outbox Store
  -> Audit and Observability Sink
```

分层职责：

- Facade / Orchestrator 组织课前、课中和课后 use case，不暴露 Transport 细节。
- Domain Ports 使用协议无关的 Fusion 教育语义，不等同于 DeepTutor HTTP DTO。
- Mapper + ACL 负责字段白名单、schema、revision、digest、引用、lesson、scope 和 audience 校验。
- Transport 只封装 REST、WebSocket、A2A、认证和网络错误；不得被 OpenMAIC route、React 组件或播放器反向依赖。
- OpenMAIC Planner 消费经过校验的 `TeachingIntent` 并生成 `SceneDirective`；该职责不属于 DeepTutor 或 Transport。

跨域信任边界必须满足：

- 未知 schema、未知安全枚举、越界引用、授权失败和语义关联不一致时失败关闭。
- DeepTutor 原始模型输出、思维过程、工具调用流和内部异常不得透传到课堂逻辑。
- Adapter 不得解析 DeepTutor Memory Markdown、内部 JSON、SQLite、用户目录或知识库索引。
- DeepTutor 不得读取 OpenMAIC IndexedDB、Dexie、localStorage、Scene 存储或 RuntimeStore。
- 生产环境不得因真实 Provider 失败而静默回退 Mock identity、profile、mapping 或 diagnosis。
- Transport 从 REST 升级到 A2A 或消息队列时，只替换传输与任务 envelope，不改变已确认的教育语义。

通用配置必须覆盖运行模式、服务发现、TLS、有限超时、payload 上限、契约版本、最小 scope、Secret 引用、允许出站目标、重试/熔断、字段与保留策略以及日志净化；具体键名和部署数值由实现 Feature 定稿。FUSION 专项文档路由见 [`FUSION/01`](/docs/harness/FUSION/01-fusion-document-routing-and-reading-index.md)。

## 3. 身份、Lesson Binding 与权威状态

DeepTutor 是 learner subject 的权威来源。课堂启动采用一次性 Launch Code 和服务端到服务端的受限委托；浏览器不得持有 DeepTutor Cookie、长期令牌或可覆盖身份的参数。

当前目标身份链为：

```text
DeepTutor authenticated subject
  -> Launch Code exchange
  -> DeepTutor persistent LessonBinding
       lessonSessionId -> learnerSubjectId
  -> OpenMAIC lesson session / short-lived delegation
  -> post-class Worker service identity
  -> DeepTutor Candidate Inbox user scope
```

`LessonBinding` 是 DeepTutor 内部的持久身份事实。它由已认证的 Launch 流程创建，不能由浏览器、OpenMAIC 请求正文或 Candidate 重绑；短期课堂 delegation 过期或 DeepTutor 重启不应使课后 Worker 丢失 learner 解析。课后 Candidate 只携带 `lessonSessionId` 及其业务关联，不携带可自由指定的 `learnerId`/`learnerKey`。后台处理必须在每个 run 中显式安装正确的 `CurrentUser/UserScope`，不得回退到 admin/default workspace，也不得跨 learner 共享可变全局上下文。

OpenMAIC 可以在自己的服务端 Session/Outbox 中保存由 Launch 派生的课次范围关联，用于权限、审计和删除；该关联不是 DeepTutor Candidate 的身份声明。服务身份只授予目标 audience 和最小 Candidate 提交 scope，不授予任意读取用户 Memory 的权限。

Fusion 中的权威状态必须区分：

| 状态 | 作用域 | 权威所有者 | 架构含义 |
| --- | --- | --- | --- |
| Conversation Session | 单次 DeepTutor 对话 | DeepTutor Session Store | 短期上下文，不等于长期画像 |
| Three-layer Memory | 用户跨 Session 的 Memory surface | DeepTutor Memory | L1/L2/L3 综合结果，不是 Candidate Inbox |
| Mastery Progress | 用户学习路径与知识点 | DeepTutor Mastery/Learning 服务 | 结构化掌握度，不是 Memory 文本 |
| Fusion Lesson State | 一次 OpenMAIC 课堂及其跨域证据 | 两端各自的 Fusion stores | Binding、facts、Candidate、Receipt 和处理状态 |

DeepTutor 画像投影可以综合 Memory、Mastery、Quiz/Learning Evidence 和近期有效观察，但跨边界只返回当前课堂所需的最小、版本化投影。OpenMAIC 的浏览器缓存、IndexedDB 或导出物不能覆盖服务端 Session 的 learner、Map、revision、授权或运行态。

OpenMAIC 服务端持有课堂 Session、不可变课前快照、Scene Catalog、RuntimeState、降级状态和 revision 的权威状态；`FusionSessionStore` 负责 Fusion 所需的会话关联和跨阶段状态。`FusionOutboxStore` 负责异步投递记录、幂等键、lease、重试和 Receipt 关联；`CredentialStore` 只保存不可认证的 reference，凭证正文只能存在受控 Secret/服务身份设施中。这些 Store 是职责端口，不要求独立数据库，也不把完整课堂 Session aggregate 的物理或逻辑形态锁死在本全局架构中。

删除、撤销和保留策略必须覆盖 OpenMAIC Session、facts、completion、Outbox、凭证引用以及 DeepTutor Binding、Inbox、Fusion facts 和派生画像，不能只清理浏览器缓存或单张表。详细身份和画像状态设计见 [`FUSION/08`](/docs/harness/FUSION/08-deeptutor-learner-state-and-identity-resolution.md)；Candidate 接收后的 DeepTutor 处理见 [`FUSION/09`](/docs/harness/FUSION/09-candidate-inbox-driven-profile-pipeline.md)。

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

## 7. 完整性、可靠性、安全与生命周期

### 7.1 Canonical digest 与版本

`semanticRequestDigest`、`factSetDigest` 和 `canonicalPayloadHash` 共同采用 `fusion-c14n-v1` 的字段白名单投影、语义规范化、RFC 8785 JCS、UTF-8 与 SHA-256 流水线。Hash 只提供完整性和关联，不是授权或加密。

- 严格 schema 解析先于 canonicalization；未知字段、重复 key、歧义数组、无效 Unicode、时间或数字必须失败关闭。
- canonicalization、purpose 和 value schema version 共同决定兼容性；接收方不得猜测未知版本。
- TypeScript 与 Python 必须消费相同 golden fixtures，并对 canonical bytes 和 digest 产生一致结果。
- 三种 digest 的具体白名单、NFC/时间/数字/数组规则和 fixtures 以 [`FUSION/10`](/docs/harness/FUSION/10-canonical-hash-digest-and-integrity-specification.md)为专项 SSOT。

### 7.2 可靠投递与降级

- 已发生的课堂事件先持久化，再调用可能失败的诊断能力；诊断失败形成 durable degradation，不删除 learner 提交。
- 课后 Candidate 使用持久 Outbox、稳定 idempotency key、processing lease、有限重试、dead-letter 和严格 Receipt。
- 网络、DNS、超时、429、可恢复 5xx 和服务凭证暂不可用属于可重试失败；schema、永久授权拒绝、hash 冲突和明确业务拒绝不无限重试。
- 未知投递结果必须保持可恢复，不能误报 delivered；discarded 是不可重放终态，已被 DeepTutor 接收的 Candidate 不能靠 OpenMAIC 本地回滚抹去。
- 重试策略必须采用有限尝试、带抖动指数退避、明确上限和可审计终态；具体次数、基础退避、等待上限和运行时参数由实现 Feature 或可靠性专项定稿，并提供兼容证据。
- 各能力独立维护健康状态和熔断器，不使用一个全局 `DeepTutor unavailable` 掩盖故障类型。

### 7.3 安全与数据最小化

- 生产认证失败不得回退 auth-disabled、Mock issuer 或高权限全局凭证。
- 凭证、Cookie、Secret、原始 Memory、完整聊天、模型思维过程、附件正文和无关 learner 历史不得进入 payload、日志或课堂导出。
- 题面、答案或材料正文只有在阶段协议明确用途、授权、大小、保留和退出机制时才能跨域。
- 出站请求限制协议、主机、重定向、超时和响应大小；非本机受控开发环境使用 TLS。
- Mock Profile、Identity、Mapping 和 Diagnosis 只允许 development/test 显式启用，并携带不可被正式消费者忽略的标识。

### 7.4 生命周期与可观测性

learner/lesson 删除、撤销和保留必须沿引用链覆盖两端：

```text
LessonBinding
  -> Session / Classroom Facts / Frozen Fact Set / Completion
  -> Outbox payload / Receipt / credential reference
  -> Candidate Inbox / Processing Runs / Fusion Facts
  -> Mastery evidence references / Fusion L1-L2-L3 derived content
```

删除进行中应阻止相关新 event、lease 和下游投影；已进入聚合文档的内容需要按权威剩余事实重建，而不是只删除 Inbox 行。外部 Secret 删除通过可重试任务完成，审计记录只保留政策允许的脱敏元数据。

每次 Fusion 交互至少可关联 lesson、request/event/candidate、schema、revision/digest、授权结果、状态、reason code、耗时、重试和降级结果；日志不得保存 token、敏感学习正文或 Agent 思维过程。审计数据用于排障，不得反向成为新的学生画像证据源。

## 8. 实现成熟度与迁移状态

架构决策、详细协议、迁移参考和已运行代码必须明确区分：

| 标记 | 含义 |
| --- | --- |
| **Existing** | 当前代码中存在并由 Feature 证据确认的能力；具体状态以 Registry 和 `docs/progress.md` 为准 |
| **Target Architecture** | 全局 SSOT 已确认、实现必须满足的系统级职责、边界和不变量 |
| **Detailed Design** | FUSION 专项设计已确认，但不表示端口、数据库或生产能力已经实现 |
| **Reviewed Migration Reference** | 已人工审核、可用于建立后续实现 Feature 的迁移参考，不自动成为运行规范 |
| **Provisional / Reference Design** | 尚未人工审核，只能用于发现依赖和风险，不能提升为正式技术决策 |
| **Development Only** | 只允许隔离开发、测试或 Demo，不能成为生产回退 |
| **TBD** | 尚需产品、架构、安全、部署或实现 Feature 定稿 |

当前文档成熟度：

| 文档/能力 | 成熟度 | 全局架构使用方式 |
| --- | --- | --- |
| `ARCHITECTURE.md` | Target Architecture / 全局 SSOT | 定义系统级职责、边界、主链路和不变量 |
| [`FUSION/01`](/docs/harness/FUSION/01-fusion-document-routing-and-reading-index.md) | Routing / Index | 只作为 FUSION 阅读路由和职责索引，不属于 Detailed Design |
| FUSION `02/04/06、08/09/10` | Detailed Design / 当前设计基准 | 全局架构吸收已确认结论；阶段协议、内部模型和完整性规范仍留在 FUSION |
| [`FUSION/03`](/docs/harness/FUSION/03-pre-class-fusion-code-migration-roadmap.md) | Reviewed Migration Reference | 可用于课前实现 Feature 的组件处置、兼容和回滚规划，不把路线状态当作已实现 |
| [`FUSION/05`](/docs/harness/FUSION/05-in-class-fusion-code-migration-roadmap.md)、[`FUSION/07`](/docs/harness/FUSION/07-post-class-fusion-code-migration-roadmap.md) | Provisional / Reference Design | 只登记其依赖、风险和待审核状态；其中 DDL、组件、阶段、shadow、切换、回滚和退役方案不具有全局架构效力 |
| F01 与固定 Mock | Development Only | 只验证契约和课堂体验，不代表真实身份、画像或写回；F02 离线 Demo 已退役 |
| 后续实现 Feature | Existing 的唯一晋级路径 | 必须提供测试、运行、审查、Git 和迁移/回滚证据后才能更新实现状态 |

迁移必须遵守以下全局原则：

1. 两个 Fork 继续独立安装、部署和提交，不引入根目录共享运行时或数据库。
2. 新旧契约和 Session 按明确版本隔离；不能混合不同语义根、Map revision、Candidate family 或 Receipt schema。
3. 数据库和 Provider 变更采用可回滚的 additive 方式；历史事实不伪造 digest、Binding 或 execution outcome。
4. shadow 只能观测和比较，不得产生双重长期画像副作用。
5. 旧路径只有在无正式消费者、兼容窗口结束、回滚演练和回归证据完成后退役。
6. 任何迁移路线都必须由独立 Feature 重新确认文件、数据、身份、安全和验证范围。

当前 FUSION 迁移台账仍为 `not_started`；设计文档 passing 不表示两个 Fork 已经迁移。课前迁移可正常参考 `FUSION/03`。课中和课后只能依据已确认协议建立新的审核/实现合同，不能直接执行 `FUSION/05`、`FUSION/07` 的 provisional 技术路线。

未来 A2A、消息队列或独立 Adapter 服务只在出现明确的多调用方、长任务、独立扩缩容或跨服务审计需求后评估；演进目标是替换 Transport/task envelope，而不是改变本架构中的教育语义和所有权。

## 9. 待决事项

以下事项尚无足够结论，不得由实现者根据示例自行补齐：

| 待决项 | 已确认边界 |
| --- | --- |
| 课前澄清/范围修订 | 已确认：`insufficient_data` 不阻止 `ready` 冻结；`partial`/`unresolved` 表示语义、映射或关键协议不可靠；普通课堂是独立且显式的 non-Fusion 恢复。只有课堂发起人可经服务器 Session 绑定确认一次实质修订；教师仅可协助，不能独立覆盖；`partial`/`unresolved`/`rejected` 不自动重试 |
| `sourceMaterialRefs` 正文访问 | 当前只交换授权引用、digest 和用途；正文授权、传输、大小、保留和退出机制待决 |
| 四类 confidence 的 wire/hash 映射 | mapping、diagnosis、observation、aggregation 语义保持分离；Candidate 字段和 digest profile 待决 |
| DeepTutor CandidateInboxStore 物理后端 | 必须选择单一权威、支持事务/唯一约束/lease/恢复的后端；SQLite、PocketBase 或其他选型待决 |
| Planned API 形状 | HTTP/A2A 路径、最终 schema、错误码、payload 上限和版本协商由实现 Feature 定稿 |
| 生产身份与 Secret | Launch TTL、token 形态、轮换、撤销、Workload Identity、Secret Manager/KMS 和多实例恢复待部署 Feature 定稿 |
| 知识映射与画像策略 | namespace/scopeId 命名、映射算法、低置信阈值、多对多、Profile 数据源优先级和 warning 规则待决 |
| 数据保留与隐私删除 | 原始答案、事实、Receipt、审计、Binding、派生 Mastery/Memory 的保留期和删除 SLA 待决 |
| 课中/课后迁移路线 | `FUSION/05`、`FUSION/07` 尚未人工审核；不得把其实现路径或技术决策视为已批准 |
| 跨设备课堂恢复和补偿 API | 已提交事件、未知投递结果、已接受 Candidate 的补偿/删除及跨设备恢复策略待决 |

禁止的跨边界模式始终成立：浏览器直连 DeepTutor；信任浏览器 learner/Map/运行态；共享内部数据库或文件；DeepTutor 返回 UI 命令；单题错误直接改长期 mastery；生产自动回退 Mock；Outbox 保存失败却声称已排队；使用新 mapping revision 重解释历史事实。
