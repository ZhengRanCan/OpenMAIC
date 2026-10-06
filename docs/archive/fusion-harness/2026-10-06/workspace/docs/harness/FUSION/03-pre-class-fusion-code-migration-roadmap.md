# 课堂前 Fusion 代码迁移路线

## 1. 文档定位与当前状态

本文记录 F28 对课堂前 Fusion 信息交换层的代码迁移规划，说明如何从当前的独立 Profile/Knowledge Map 拉取路径，渐进迁移到[课堂前语义交换协议规范](./02-pre-class-semantic-exchange-protocol.md)定义的语义上下文化握手。

- 性质：实施导航与迁移台账，不是新的业务协议。
- 依据：[`ARCHITECTURE.md`](../ARCHITECTURE.md)、[课堂前语义交换协议规范](./02-pre-class-semantic-exchange-protocol.md)和[Canonical Hash / Digest 与完整性规范](./10-canonical-hash-digest-and-integrity-specification.md)。
- 当前实现状态：**阶段 A–E 已分别由 F40–F44 完成（passing），阶段 F（F45）实现完成但 passing 门禁因 v4_flash_worker 独立复核未完成而标记 blocked**：两个 Fork 已有隔离的版本化课前契约、严格 parser 和 `fusion-c14n-v1` fixture 验证；DeepTutor 的 Pre-Class Context Route 已从 synthetic fixture 切换为 launch-bound CourseScope 下的真实 Book/Spine/LearningProgress 只读决策管线；OpenMAIC 正式生成读取 `FrozenLessonGenerationContext`，并从 Launch exchange 派生不可变 `courseScopeRef`；旧 Profile/Map GET 与固定 slope Profile/Map/Catalog 已按 F45 退役，正式课前链路只保留 launch-bound 语义请求与一份冻结上下文。
- 历史与验收：F28 的合同、验证计划和证据仍保存在 `docs/harness/features/F28-fusion-information-exchange-upgrade-plan/` 与 `docs/log/artifacts/F28/`。
- 边界：本文只覆盖课堂生成前；其 `FrozenLessonGenerationContext` 是[课堂中迁移路线](./05-in-class-fusion-code-migration-roadmap.md)正式切换的硬门禁，课堂后再沿[课堂后迁移路线](./07-post-class-fusion-code-migration-roadmap.md)实施。

本文与目标协议分开保存：`02` 定义最终必须满足的语义；本文记录现有代码如何安全抵达该目标。后续代码结构变化时，应更新本文的现状映射和迁移台账，不应反向改变目标协议的语义。

## 2. 当前代码基线

### 2.1 当前交互路径

```text
Browser
  -> OpenMAIC POST /api/fusion/launch
  -> DeepTutor Launch Code exchange
  -> scoped delegation + verified learner
  -> OpenMAIC parallel GET Profile / Knowledge Map
  -> DeepTutor fixed synthetic Profile/Map
  -> OpenMAIC FusionSessionRecord
  -> first outline receives browser requirement
  -> OpenMAIC locally assembles FrozenTeachingContext
  -> outline/content/actions generation
```

### 2.2 现有实现位置

| 职责 | 当前实现 | 当前行为 |
| --- | --- | --- |
| OpenMAIC Launch 入口 | `OpenMAIC/app/api/fusion/launch/route.ts` | 交换 Launch Code、校验委托、拉取 Profile/Map、保存 Session 与 HttpOnly Cookie。 |
| OpenMAIC Profile/Map Provider | ~~`OpenMAIC/lib/fusion/adapter/real-profile-provider.ts`~~（F45 已删除） | 退役：已不再并行调用旧 GET Route，新 Session 不再捕获 Profile/Map/Catalog 快照。 |
| OpenMAIC 教学上下文拼接 | `OpenMAIC/lib/fusion/teaching-context.ts` | 在 DeepTutor 快照取得之后，才把浏览器 requirement 与固定 Map/Catalog、本地 guidance 拼接。 |
| OpenMAIC 冻结与 CAS | `OpenMAIC/lib/fusion/generation-session.ts` | 一次性冻结服务器拥有的大纲和现有教学上下文。 |
| OpenMAIC Session 持久化 | `OpenMAIC/lib/fusion/session-store/postgres.ts` | 保存 Fusion Session，并提供持久化与并发控制基础。 |
| DeepTutor Launch | `DeepTutor/deeptutor/api/routers/fusion_launch.py` | 消费一次性 Launch Code 并签发受限委托。 |
| DeepTutor 委托校验 | `DeepTutor/deeptutor/api/services/fusion_delegation.py` | 校验 audience、scope、lesson、expiry 等绑定。 |
| DeepTutor Profile/Map | ~~`DeepTutor/deeptutor/api/routers/fusion_profile.py`~~（F45 已删除） | 退役：旧 GET Profile/Map 与固定 `lesson-linear-function-slope` 已不再服务正式链路。 |

### 2.3 当前语义断点

1. DeepTutor 拉取 Profile/Map 时不知道当前课堂的 topic、objectives、材料引用或目标知识范围。
2. Profile 和 Map 是两个独立资源，没有共同的 semantic request revision 与 digest。
3. 课堂 requirement 在下游才由 OpenMAIC 拼入，无法约束 DeepTutor 返回的知识范围。
4. 当前通用 JSON 检查无法拒绝未知字段、越界画像、错误引用或跨 revision 拼接。
5. Teaching Guidance 由 OpenMAIC 本地硬编码，不是 DeepTutor 的教学决策语义。
6. 固定 slope fixture 与固定 Catalog 可能进入不相关课堂，造成主题错配。

## 3. 目标代码路径

```text
Browser requirement / controlled material references
  -> OpenMAIC server-owned LessonGenerationIntent
  -> Fusion Adapter authorization + normalization
  -> versioned LessonSemanticRequest
  -> DeepTutor pre-class semantic context Route
  -> constrained DeepTutor teaching-context decision
  -> PreClassTeachingContextProposal
  -> Fusion Adapter strict parsing + SemanticResolution
  -> CAS-frozen FrozenLessonGenerationContext
  -> OpenMAIC outline/content/checkpoint generation
```

目标路径具有以下关键差异：

- Launch 继续建立身份与最小授权，但不承载完整教学语义。
- OpenMAIC 在第一次课堂生成之前提交规范化课程语义。
- DeepTutor 在同一次请求下共同生成 Map、课内画像投影与 Teaching Guidance。
- Fusion Adapter 只接受同 request ID、revision 和 digest 的完整 Proposal。
- OpenMAIC 的所有生成阶段只读取一份服务器拥有的冻结上下文。
- Agent 的自由推理留在 DeepTutor 内部；跨边界只返回结构化决策结果、置信度、warning 和 reason code。

## 4. 组件处置矩阵

### 4.1 原样复用

| 能力 | 复用结论 |
| --- | --- |
| Launch Code exchange | 继续作为一次性启动与身份绑定入口。 |
| delegation 校验 | 继续校验 learner、lesson、audience、scope 和 expiry；浏览器仍不可接触 credential。 |
| OpenMAIC HttpOnly Session Cookie | 继续只保存不透明 Session 标识，不保存 DeepTutor token 或画像正文。 |
| credential reference / Secret 边界 | 继续只保存凭证引用，由服务端安全设施解析。 |
| PostgreSQL Fusion Session | 继续作为权威 Session 存储。 |
| CAS/revision | 继续保护首次生成和冻结上下文免受并发覆盖。 |
| timeout、circuit breaker、生产失败关闭 | 新 Provider 纳入既有可靠性边界。 |

### 4.2 扩展

| 能力 | 必要扩展 |
| --- | --- |
| Fusion Session schema | 增加 semantic request、Proposal/Resolution、Frozen Context、digest 和 source revisions；旧 schema 显式版本化。 |
| delegation scope | 增加最小课前语义操作权限，或明确复用现有 scope 的兼容期；不得扩大为通用 DeepTutor 访问。 |
| 审计元数据 | 增加 request ID、revision、digest、resolution、parser/policy version；不记录原始思维过程或敏感正文。 |
| 首次 outline 冻结入口 | 在生成大纲前完成语义握手与冻结，而不是生成后补充语义。 |
| Scene Catalog 编译约束 | Catalog 仍由 OpenMAIC 拥有，但必须与冻结 Map/Guidance 对齐。 |

### 4.3 替换或升级

| 当前职责 | 替换方向 |
| --- | --- |
| 两个独立 Profile/Map GET 作为正式课前路径 | 新增一个接收 `LessonSemanticRequest`、返回完整 Proposal 的课前语义 Route 和 Provider。 |
| 通用 JSON-object 校验 | 使用严格、版本化、字段白名单、大小受限的 request/response parser。 |
| OpenMAIC 本地硬编码 guidance | 改为消费 DeepTutor 的结构化 Teaching Guidance，再由 OpenMAIC 编译为确定性课堂计划。 |
| 固定 `_PROFILES` 的正式语义职责 | 第一阶段只作为明确标记的 synthetic fixture 适配新契约；后续由 DeepTutor 真实领域服务/Agent 管线替换。 |
| `FrozenTeachingContext` | 新增版本化 `FrozenLessonGenerationContext`，不原地改变旧 schema 的含义。 |

### 4.4 兼容期后退役

- 正式课堂对旧 `GET /profile` 与 `GET /knowledge-map` 的调用。
- 固定 `lesson-linear-function-slope` 作为生产语义来源。
- 固定 slope Catalog 作为任意正式课堂的默认 Catalog。
- 能把旧 Profile、新 Map 或不同 digest Guidance 拼接在一起的兼容逻辑。

退役只能发生在新路径完成契约测试、shadow 验证、读取切换和负向回归之后。历史 Session 应按旧 schema 只读恢复或显式失效，不得被静默升级后混用。

## 5. 最低风险迁移阶段

### 阶段 A：跨 Fork 契约与严格解析器

目标：先建立双方等价的版本化语义边界，不改变正式用户路径。

- 在两个 Fork 内分别定义等价 schema，不引入根目录共享运行时依赖。
- 实现文档 `10` 已定稿的 semantic ID/revision 关联与 canonical digest，并定义稳定错误码和 resolution 状态；不得另建课前专用规范化算法。
- 定义 request、Proposal、Map、Cognitive Projection、Guidance 和 Frozen Context。
- 建立共享 fixture 驱动的跨 Fork 兼容测试和恶意/越界负向测试。

完成判据：双方能对同一合法 fixture 得到一致语义，对未知版本、未知字段、digest 错配、越界引用和 UI 命令失败关闭。

### 阶段 B：DeepTutor 新 Route 与合成适配器

目标：证明新 Transport 和授权链，不声称已经接入真实 Agent。

- 新增受 delegation 保护的 Pre-Class Context Route。
- learner 只从委托推导，payload 不接受 learner 覆盖。
- 暂用现有 fixture 生成符合新 Proposal schema 的结果，并明确标记 synthetic/development 来源。
- 保留旧 Profile/Map Route。

完成判据：新 Route 对合法请求返回单一、同 digest Proposal；授权、lesson、scope、expiry、大小和 schema 的负向测试通过。

### 阶段 C：OpenMAIC Provider、Session 双写与 shadow 验证

目标：接通新链路，但不立即改变正式课堂生成结果。

- 新增 `PreClassContextProvider`，经 Fusion Adapter 调用新 Route。
- 从服务器拥有的 requirement、材料引用和授权范围构造 Intent/Request。
- Session 保存新 request、Proposal、Resolution 和 Frozen Context，同时保持旧字段可读。
- 以服务端开关执行 shadow 调用，对比主题、知识范围和错误分类；不得在生产失败时回退 Mock。

完成判据：旧正式路径行为不变；新结果可被追踪、严格解析并与旧结果隔离，且不向浏览器泄露 delegation 或 learner 数据。

### 阶段 D：正式生成读取切换

目标：让课堂生成只消费冻结语义上下文。

- 第一次 outline 前完成语义协商与 CAS 冻结。
- outline、content、checkpoint 和 Catalog 编译统一读取同一 snapshot。
- 浏览器后续字段不能覆盖 learner、Map、Profile、Guidance、revision 或 digest。
- `needs_clarification`、`partial`、`unresolved`、`rejected` 按显式产品策略处理。

完成判据：不同主题的课堂不能获得固定 slope Map；跨 digest、跨 revision、Map 外画像或 Guidance、未知 schema 全部失败关闭。

已确认：Learner 画像不足不是 Fusion 失败；语义可信时使用带 `insufficient_data` 的冻结 Context。普通课堂仅在可信 Fusion Context 无法建立、不可恢复故障或用户明确退出时作为显式 non-Fusion 恢复，并创建独立 Session。阶段 D 由当前课堂发起人经服务器 Session 绑定确认最多一次实质范围缩小或修订；教师可协助但不能独立覆盖。`needs_clarification` 必须显式补充，`partial`、`unresolved`、`rejected` 不自动修订或重试。

### 阶段 E：DeepTutor 真实教学决策管线

目标：在已经稳定的外部契约内，以真实知识、课程相关 learner 投影和受控教学决策替换 fixture。F44 v1 采用确定性、可审计的 bounded decision pipeline，不调用外部 AI；后续如替换为 Agent，仍必须通过同一协议、工具边界和确定性校验层。

- DeepTutor 内部负责 CourseScope 绑定、课程语义理解、知识权威对齐、课内画像投影和教学指导决策。
- 决策器或 Agent 只能通过受控工具读取领域投影，只输出协议允许的 Proposal。
- 原始 chain-of-thought、工具调用流、Memory 原文和内部异常不得跨 Fusion 边界。
- 确定性校验层验证引用、范围、revision、digest、策略码和数据最小化。

完成判据：fixture 来源不再进入正式路径；决策器/Agent 失败、低置信度或证据不足都以稳定状态表达，不以猜测或无关默认值补齐。

### 阶段 F：旧路径退役

目标：删除已经没有正式消费者的旧语义来源。

- 停止并监测旧 GET Route 的正式调用。
- 完成历史 Session 策略、兼容窗口和回滚演练。
- 删除固定 slope 的正式 Provider/Catalog 依赖。
- 在确认无消费者后，再删除或限制旧 DeepTutor Route。

完成判据：正式课前链路只有一个语义根和一份冻结上下文；旧路径无正式流量，回滚不需要混合新旧 schema。

## 6. Feature 切分规则

上述阶段必须由后续独立实现 Feature 承担，不能把 F28 的 `passing` 当作代码完成证据。建议至少按以下顺序建立：

1. 跨 Fork 语义契约、严格 parser 与兼容 fixture 测试。
2. DeepTutor Pre-Class Context Route。
3. OpenMAIC Provider、Session 扩展、双写与 shadow 验证。
4. OpenMAIC 正式生成读取切换。
5. DeepTutor Agent/Knowledge/Mastery 生产计算链路。
6. 旧 Profile/Map Route 与固定 slope 语义退役。

每个实现 Feature 都必须：

- 明确只允许修改的 Fork、文件和数据库迁移范围。
- 分别运行所属 Fork 的测试、类型检查/构建和独立审查。
- 为每个被修改 Fork 提供独立 branch、commit 和 push 证据。
- 更新本文第 8 节迁移台账，不得仅修改 Feature 状态。
- 不读取真实 learner、生产 Secret、Cookie、Token、数据库或课堂数据。

## 7. 兼容、切换与回滚规则

1. 新契约使用新 schema version 和新 Session 字段，不改变旧 `f23-v1` 对象的既有语义。
2. 新旧 Provider 必须类型和配置隔离，不能让旧响应被新 parser 接受。
3. 双轨只用于观测和迁移，不允许把旧 Profile 与新 Map/Guidance 混合成一个上下文。
4. 切换开关必须由服务端拥有；浏览器不能选择 Provider、schema 或 learner。
5. 新 Provider 在生产失败时必须显式失败或进入协议允许的澄清/降级状态，不得自动使用 Mock。
6. 回滚只能恢复到一套完整、已验证的旧版本；已经按新 digest 生成的 Session 不能降级后继续拼接旧数据。
7. 普通 OpenMAIC 路径不是 Fusion 生产失败的回退来源；F02 离线 A/B Demo 已随 F50 退役。
8. 旧 Route 的删除是最后一步，必须有调用观测、兼容窗口和回滚演练证据。

## 8. 迁移台账

截至 2026-07-31：

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| A：契约与严格解析器 | `passing` | F40 已在两个 Fork 实现等价的纯契约内核、`semanticRequestDigest` 投影、严格失败关闭 parser 和共用 fixture 测试；未接入正式路径。 |
| B：DeepTutor 新 Route | `passing` | F41 新增 `POST /api/v1/fusion/pre-class/context`；严格请求 parser 后以 `preclass-context:read` 验证 delegation 的 audience/lesson/expiry，仅在 development/test 返回明确标记的 deterministic synthetic Proposal。既有 Profile/Map Route 未改，OpenMAIC 尚未调用。 |
| C：OpenMAIC 双写/shadow | `passing` | F42 增加 `PreClassContextProvider`，在服务端开关开启时，于旧 `FrozenTeachingContext` 已冻结后，以 credential reference 的 `preclass-context:read` delegation 调用 F41 Route；`preclass-context-shadow-v1` 独立写入 request/Proposal/Resolution/ready Frozen Context 与 topic/scope/error-type 比较。失败仅记录 `provider_failed`，不回退 Mock；正式生成不读取该字段，launch 也不再向浏览器回显 learner identity。 |
| D：正式读取切换 | `passing` | F43 已让正式 outline/content/actions 读取服务端冻结的 `FrozenLessonGenerationContext`，不再读取旧 `generationContext`、Profile/Map 或固定 Catalog；`ready + insufficient_data` 可冻结，非 ready 与越界 Map 失败关闭并产生显式 non-Fusion 恢复说明。 |
| E：DeepTutor 真实决策管线 | `passing` | F44 已新增 DeepTutor CourseScope Registry、Launch Scope Binding 和真实课前决策管线；Route 只读 launch-bound learner Book/Spine/LearningProgress，缺少 progress 返回 `insufficient_data`，无语义匹配或内部失败返回稳定非 ready Proposal；OpenMAIC 保存并使用 Launch 派生 `courseScopeRef` 构造正式语义请求。F44 v1 不调用外部 AI，不暴露 Book 正文、Memory、聊天、token 或思维过程。 |
| F：旧路径退役 | `blocked` | F45 已删除旧 `GET /profile`、`GET /knowledge-map` 与固定 slope Profile/Map；OpenMAIC launch 不再拉取/写入 `profileSnapshot`/`lessonKnowledgeMap`/`sceneCatalog`，`profile:read` scope 移除，连接探测只要求新正式路径；课中/课后消费者在 legacy 字段缺失时回退冻结语义 Map。历史 Session 按旧 schema 只读或显式失效，两 Fork 分别完成测试/构建/推送；Harness passing 所需的 v4_flash_worker 独立复核因 DeepSeek 任务投递失败受阻，补做后转 `passing`。 |

F28 `passing` 只表示本迁移路线和范围已经形成设计记录。只有相应实现 Feature 具备测试、审查、Git 和运行证据后，才能更新上表状态并声称某个阶段已实现。

## 9. 迁移完成的总体判据

只有同时满足以下条件，才能宣布课堂前 Fusion 迁移完成：

- OpenMAIC 在课堂生成前发送包含真实课程语义的版本化请求。
- DeepTutor 返回同一语义根下的 Map、课内画像投影与 Teaching Guidance。
- Fusion Adapter 对授权、字段、引用、范围、revision 和 digest 严格校验。
- OpenMAIC 的所有生成步骤只消费服务器冻结的一份上下文。
- DeepTutor Agent 的非确定性被结构化契约、受控工具和确定性校验层约束。
- 主题错配、跨 revision 拼接、Mock 回退和浏览器身份覆盖均有负向回归。
- 正式路径不再依赖固定 slope Profile、Map 或 Catalog。
- 两个 Fork 分别完成测试、审查、提交、推送与可回滚发布证据。
