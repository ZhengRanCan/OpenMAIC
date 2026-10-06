# Architecture — Fusion Adapter 分层与信任边界

> 定义 Adapter 逻辑分层、依赖方向、ACL 和跨域信任边界。

> 💡 **上下文锚点**：
>
> - 系统职责与领域所有权：[01-system-responsibilities-and-domain-ownership.md](01-system-responsibilities-and-domain-ownership.md)。
> - 身份与权威状态：[03-identity-lesson-binding-and-authoritative-state.md](03-identity-lesson-binding-and-authoritative-state.md)。
> - 完整性、可靠性与安全：[07-integrity-reliability-security-and-lifecycle.md](07-integrity-reliability-security-and-lifecycle.md)。

<!-- ARCHITECTURE-SPLIT: body-start -->

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
