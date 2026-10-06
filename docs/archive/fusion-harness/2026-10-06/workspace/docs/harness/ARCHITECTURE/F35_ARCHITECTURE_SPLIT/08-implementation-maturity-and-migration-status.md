# Architecture — 实现成熟度与迁移状态

> 区分全局架构、详细设计、已审核迁移参考、provisional 设计和实现证据。

> 💡 **上下文锚点**：
>
> - 三阶段主链路：[05-pre-in-post-class-main-flow.md](05-pre-in-post-class-main-flow.md)。
> - 完整性与可靠性：[07-integrity-reliability-security-and-lifecycle.md](07-integrity-reliability-security-and-lifecycle.md)。
> - 待决事项：[09-open-decisions.md](09-open-decisions.md)。

<!-- ARCHITECTURE-SPLIT: body-start -->

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
