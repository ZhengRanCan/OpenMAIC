# Fusion 文档路由与阅读索引

## 1. 文档定位

本文只负责 `docs/harness/FUSION/` 的阅读路由、职责边界和成熟度提示，不定义全局架构、不复制协议细节，也不替代实现计划。

全局系统职责、领域所有权、Fusion Adapter 分层、身份边界、主链路、可靠性、安全和成熟度结论以 [`ARCHITECTURE.md`](../ARCHITECTURE.md) 为最高 SSOT。FUSION 文档只承接其专项细节：阶段协议、阶段迁移路线、Learner/画像基础模型和 Canonical Hash/Digest 完整性规范。

## 2. 文档结构

| 编号 | 文档 | 职责 | 成熟度 |
| --- | --- | --- | --- |
| 01 | 本文 | 路由与阅读索引；不承担架构定义 | Active index |
| 02 | [课前语义协议](./02-pre-class-semantic-exchange-protocol.md) | 课前跨域语义对象、时序、状态与不变量 | Design baseline |
| 03 | [课前代码迁移方案](./03-pre-class-fusion-code-migration-roadmap.md) | 从当前实现迁移到课前协议的组件处置、兼容、shadow、切换、回滚和退役 | Reviewed migration reference |
| 04 | [课中语义协议](./04-in-class-semantic-exchange-protocol.md) | 课中 checkpoint、诊断、教学意图、执行回执和课堂事实协议 | Design baseline |
| 05 | [课中代码迁移方案](./05-in-class-fusion-code-migration-roadmap.md) | 从当前实现迁移到课中协议的参考路线 | Provisional / reference |
| 06 | [课后语义协议](./06-post-class-semantic-exchange-protocol.md) | 课后 closeout、Candidate、Receipt、Outbox 状态和生命周期协议 | Design baseline |
| 07 | [课后代码迁移方案](./07-post-class-fusion-code-migration-roadmap.md) | 从当前实现迁移到课后协议的参考路线 | Provisional / reference |
| 08 | [Learner 身份与状态模型](./08-deeptutor-learner-state-and-identity-resolution.md) | DeepTutor Learner、Session、Memory、Mastery、Lesson Binding 与后台用户作用域 | Cross-stage design baseline |
| 09 | [DeepTutor 自动画像与学习状态流水线](./09-candidate-inbox-driven-profile-pipeline.md) | Candidate Inbox、Fact Store、Mastery Projector、Agent Proposal 与 Memory 更新边界 | Cross-stage design baseline |
| 10 | [Canonical Hash / Digest 与完整性规范](./10-canonical-hash-digest-and-integrity-specification.md) | `semanticRequestDigest`、`factSetDigest`、`canonicalPayloadHash` 的跨语言规范化与摘要算法 | Cross-stage integrity SSOT |

## 3. 阅读路径

只理解主链路时：

1. [`ARCHITECTURE.md`](../ARCHITECTURE.md)
2. [02 课前语义协议](./02-pre-class-semantic-exchange-protocol.md)
3. [04 课中语义协议](./04-in-class-semantic-exchange-protocol.md)
4. [06 课后语义协议](./06-post-class-semantic-exchange-protocol.md)

准备实现迁移时：

1. 先读对应阶段协议：02、04 或 06。
2. 再读对应迁移方案：03、05 或 07。
3. 涉及 learner、画像、hash 或完整性时，补读 08、09、10。

只处理 DeepTutor 画像链路时：

1. [08 Learner 身份与状态模型](./08-deeptutor-learner-state-and-identity-resolution.md)
2. [09 DeepTutor 自动画像与学习状态流水线](./09-candidate-inbox-driven-profile-pipeline.md)
3. [06 课后语义协议](./06-post-class-semantic-exchange-protocol.md)
4. [10 Canonical Hash / Digest 与完整性规范](./10-canonical-hash-digest-and-integrity-specification.md)

## 4. SSOT 规则

- 全局架构结论：以 [`ARCHITECTURE.md`](../ARCHITECTURE.md) 为 SSOT。
- 阶段协议：02、04、06 分别是课前、课中、课后协议 SSOT。
- 阶段迁移：03、05、07 只说明当前实现如何迁移到目标协议，不得反向降低协议不变量。
- Learner 与 DeepTutor 内部画像基础：08、09 为专项 SSOT。
- Digest/hash 算法：10 为专项 SSOT。
- 课中、课后迁移方案 05、07 继续保持 provisional / reference；不得直接视为已审核实现路线。

## 5. 维护规则

- 不在本文新增架构定义；需要变更职责、边界或全局不变量时，先改 [`ARCHITECTURE.md`](../ARCHITECTURE.md)，再同步必要引用。
- 不在协议文档中写迁移步骤；迁移细节只放入 03、05、07。
- 不在迁移文档中改写协议含义；发现协议缺口时标记待决或回到对应协议文档处理。
- 文件重编号后，历史 Feature 和审查报告中的路径引用应更新到当前文件名，避免形成第二套路由。
