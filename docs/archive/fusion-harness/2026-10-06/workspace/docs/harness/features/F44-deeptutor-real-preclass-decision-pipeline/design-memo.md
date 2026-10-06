# F44 设计备忘（当前结论）

## 已确认决策

- F44 使用 DeepTutor 真实能力生成 `LessonKnowledgeMap`、`LearnerCognitiveProjection` 和 `TeachingGuidance`。
- 它是只读课前决策管线：不写 Mastery/Memory，不涉及 Candidate Inbox、L2/L3 或课后流水线。
- learner evidence 不足时显式为 `insufficient_data`；课程语义、授权和 Map 可信时仍可 `ready`。
- 复用 `LearningProgress`、`LearningModule`、`KnowledgePoint`、objective/status policy 与 Book/Spine 的精确读取。delegation 到 `CurrentUser`/`UserScope` 只补工程桥接，不建立新身份系统。
- 知识定位固定为两阶段：scope-bounded Knowledge Discovery，再 exact Authority Resolver；Resolver 目标为 `(namespace, scopeId, id) -> book_id / module_id / knowledge_point_id / mapping_revision`。
- 禁止最近/默认 Book、整个 workspace、chat session fallback、模糊匹配直接定案，或 RAG 结果直接成为 authority ref。

### CourseScope Registry 与 Launch Binding

- CourseScope 是 F44 v1 正式前置能力，只保存当前 learner 有权访问的真实 `book_id` 根集合；不重建课程系统，也不要求已有 LearningProgress。
- CourseScope 的 Book 根集合以不可变 revision 保存。Launch 将 `courseScopeId + revision` 与 `lessonSessionId + learnerId` 绑定；revision 更新不影响已绑定课堂。
- learner 有 0 个 active scope 时不签发 Formal Fusion Launch；有 1 个时按唯一性选择；有多个时必须在 DeepTutor 认证启动入口显式选择。
- 被选择的 scope 写入 DeepTutor 的单次 Launch Code，并在 exchange 时形成持久 Lesson Scope Binding。OpenMAIC 仅保存 Launch 派生的 server-side scope reference，不能创建、扩大或改绑 scope。
- F44 通过 delegation 和 `lessonSessionId` 回查 binding，仅在其绑定 revision 的 Book 根内 Discovery；候选随后仍须 exact resolution。
- 没有 LearningProgress 时，F44 后续 projection 返回 `insufficient_data`，不阻止可信 Context 为 `ready`。
- revoke 禁止新的 Discovery / refresh。revoked 后已冻结课堂的运行策略不由 F44 规定，保留为显式的授权/运行策略边界。

## 当前未决问题

- CourseScope 方向已经定稿；当前缺的是 Registry、Launch Scope Binding、OpenMAIC server-side scope reference 及 F44 消费代码的实现。
- 当前 `requestedKnowledgeRefs` 和 `allowedKnowledgeRefs` 为空；在 binding 实现前，F43 不能安全执行自然语言 Discovery。

## 后续再讨论项

- Discovery 的候选呈现、澄清与选择体验。
- Mapping registry 的具体存储与维护方式。
- revoke 后已冻结课堂的运行、暂停或终止策略。
- F44 之外的课后画像、Candidate、L2/L3、retention 与数据治理策略。
