# Architecture — 完整性、可靠性、安全与生命周期

> 定义 canonical digest、可靠投递、安全最小化、删除和审计边界。

> 💡 **上下文锚点**：
>
> - Adapter 信任边界：[02-fusion-adapter-layering-and-trust-boundaries.md](02-fusion-adapter-layering-and-trust-boundaries.md)。
> - 核心对象与关联：[04-core-domain-objects-and-stage-handoffs.md](04-core-domain-objects-and-stage-handoffs.md)。
> - 实现成熟度：[08-implementation-maturity-and-migration-status.md](08-implementation-maturity-and-migration-status.md)。

<!-- ARCHITECTURE-SPLIT: body-start -->

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
