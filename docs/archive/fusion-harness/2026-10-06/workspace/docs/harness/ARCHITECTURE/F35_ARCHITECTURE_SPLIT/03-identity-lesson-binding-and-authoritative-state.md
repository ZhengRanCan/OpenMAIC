# Architecture — 身份、Lesson Binding 与权威状态

> 定义 Launch 身份链、持久 Lesson Binding、用户作用域和权威状态。

> 💡 **上下文锚点**：
>
> - 系统职责：[01-system-responsibilities-and-domain-ownership.md](01-system-responsibilities-and-domain-ownership.md)。
> - 阶段对象与交接：[04-core-domain-objects-and-stage-handoffs.md](04-core-domain-objects-and-stage-handoffs.md)。
> - DeepTutor 画像处理边界：[06-deeptutor-profile-processing-boundary.md](06-deeptutor-profile-processing-boundary.md)。

<!-- ARCHITECTURE-SPLIT: body-start -->

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
