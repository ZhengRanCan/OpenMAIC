# 课堂中 Fusion 代码迁移路线

## 1. 文档定位与当前状态

本文说明如何从当前课中 Fusion 实现，渐进迁移到[课堂中语义交换协议规范](./04-in-class-semantic-exchange-protocol.md)定义的可信 checkpoint、独立诊断、planned/executed 分离与 durable degradation 目标。

- 性质：provisional/reference 实施导航、兼容策略与迁移台账，不是新的业务协议。
- 依据：F26 只读审查、[课堂中协议](./04-in-class-semantic-exchange-protocol.md)、F31 [`fusion-c14n-v1`](./10-canonical-hash-digest-and-integrity-specification.md)。
- 当前实现状态：**所有迁移阶段均为 `not_started`**；当前正式链路仍是 F26 审查的实现。
- 审核状态：本文尚未完成人工审核，不能直接作为已批准实现路线。
- 前置门禁：正式课中读取切换依赖[课堂前迁移路线](./03-pre-class-fusion-code-migration-roadmap.md)产出的 `FrozenLessonGenerationContext`；旧 `FrozenTeachingContext` 不具备目标协议所需的共同语义根。
- 下游关系：本路线产出的可信 Observation Facts 是[课堂后迁移路线](./07-post-class-fusion-code-migration-roadmap.md)正式 v2 closeout 的输入门禁。
- 边界：本文不修改 OpenMAIC/DeepTutor 代码、数据库、配置或协议 SSOT，也不表示 F26 findings 已修复。

目标协议定义“最终语义是什么”；本文定义“当前代码如何安全抵达目标”。后续代码结构发生变化时，应更新本路线的组件路径和台账，不得通过路线图降低目标协议的不变量。

## 2. 审查基线

### 2.1 Git 基线

截至 2026-07-31：

- OpenMAIC：`fusion-adapter`，`d4d6604dbf597c38957ebe6440361762a0673f1a`。
- DeepTutor：`fusion-adapter`，`afc8af303c71d32bc144f549a628d58f310fbadc`。
- 两个 Fork 工作树在只读核对时均无未提交修改。

该基线与 F26/F27 审查版本一致，因此本路线直接继承 F26 的 3 High、4 Medium，不把历史 `passing` 误读为代码已修复。

### 2.2 当前交互路径

```text
通用 QuizView
  -> 提交第一题 + answer + browser local correctness
  -> POST /api/fusion/classroom-events
  -> HttpOnly Cookie 恢复 FusionSessionRecord
  -> 从当前 RuntimeState/Catalog 推测 checkpoint
  -> 生成随机 eventId/correlationId
  -> DeepTutor /real-diagnosis
  -> 固定 F08 规则复用 local correctness
  -> OpenMAIC Planner 生成 SceneDirective
  -> 服务端立即 applyDirective + CAS RuntimeState
  -> 持久 event/diagnosis/directive
  -> 账本把非 continue 记为 executed
  -> 浏览器只显示 diagnosisStatus，不执行 directive
```

### 2.3 现有实现位置

| 职责 | 当前实现 | 当前行为 |
| --- | --- | --- |
| Quiz 提交入口 | `OpenMAIC/components/scene-renderers/quiz-view.tsx` | 任意 Quiz 完成后提交第一题、答案和本地 correctness；没有服务器签发 attempt。 |
| Scene/Quiz 宿主 | `OpenMAIC/components/stage/scene-renderer.tsx` | 没有把权威 checkpoint attempt 或 execution receipt 能力限制到正式 checkpoint。 |
| 课中 Route | `OpenMAIC/app/api/fusion/classroom-events/route.ts` | 恢复 Session、构造随机 event、同步诊断、规划 Directive、提前推进 RuntimeState 并写事实。 |
| 领域契约/parser | `OpenMAIC/lib/fusion/contracts.ts` | v1 Event/Diagnosis/Intent/Directive 骨架存在，但没有 CheckpointAttempt、diagnosis source/status 和 execution receipt。 |
| RuntimeState | `OpenMAIC/lib/fusion/lesson-runtime-state.ts` | `applyDirective` 同时代表计划与执行；retry count 硬编码 development checkpoint。 |
| Planner | `OpenMAIC/lib/fusion/scene-directive-planner.ts` | Catalog/策略匹配和 revision guard 可复用，但输出尚未进入真实执行回执链。 |
| 内存 Observation Ledger | `OpenMAIC/lib/fusion/classroom-observation-ledger.ts` | 保存部分观察；缺 mapping revision，把正常 continue/实际执行状态表达错误。 |
| 持久课堂事实 | `OpenMAIC/lib/fusion/persistent-lesson.ts` | PostgreSQL JSONB 保存 event/diagnosis/directive；没有 attempt、诊断降级和 execution receipt 的独立状态。 |
| Session/CAS | `OpenMAIC/lib/fusion/session-store/postgres.ts` | PostgreSQL 权威 Session、Cookie 恢复、行锁和 CAS 可复用；当前 schema 为 v1 JSONB。 |
| DeepTutor Transport | `OpenMAIC/lib/fusion/adapter/real-event-update-provider.ts` | 使用课堂 delegation 请求 `/real-diagnosis`，只做现有 parser 校验。 |
| DeepTutor Route | `DeepTutor/deeptutor/api/routers/fusion_diagnosis.py` | 校验 delegation 后调用固定诊断服务。 |
| DeepTutor 诊断 | `DeepTutor/deeptutor/api/services/fusion_diagnosis.py` | Development Only 固定知识点/规则，直接使用 local correctness。 |

### 2.4 当前正向资产

- 浏览器不直连 DeepTutor，不持有 DeepTutor token。
- OpenMAIC 从 HttpOnly Cookie 恢复权威 lesson、Map、Catalog 和 RuntimeState。
- delegation 已绑定 audience、scope、lesson 和过期时间。
- `TeachingIntent` 不携带 Scene/UI 命令；Scene 选择权仍在 OpenMAIC。
- Planner 已具有 Catalog 匹配、使用上限、revision 和重复 source event 的基础守卫。
- Session PostgreSQL、行锁、CAS 与课堂事实事务可以作为新状态机的基础。

### 2.5 当前语义断点

1. 浏览器提交不是服务器拥有的 checkpoint attempt，普通 Quiz 可冒充正式 checkpoint。
2. local correctness 被 DeepTutor 直接升级为独立诊断。
3. eventId 每次请求新建，响应丢失重试会产生新事实。
4. 诊断失败发生在事实持久化之前，学生提交可能完全丢失。
5. Directive 的计划、播放器应用和权威执行状态没有分开。
6. RuntimeState 在浏览器尚未应用 Scene 前已经推进。
7. Observation/Facts 缺少完整 semantic digest、mapping 和 execution outcome。
8. 正式 Transport 仍只连接 synthetic deterministic diagnosis。

## 3. 目标代码路径

```text
FrozenLessonGenerationContext + Scene Catalog
  -> OpenMAIC server creates CheckpointAttempt
  -> browser receives opaque attemptId + question view
  -> browser submits attemptId + answer only
  -> strict attempt lookup + idempotent ClassroomEvent persistence
  -> DeepTutor LearningEvidenceRequest
  -> independent LearningDiagnosis + TeachingIntent
  -> OpenMAIC deterministic SceneDirective = planned
  -> browser/runtime applies allowed directive
  -> SceneExecutionReceipt
  -> OpenMAIC validates receipt + CAS RuntimeState
  -> durable ClassroomObservationFact
```

诊断不可用时：

```text
stable CheckpointAttempt/Event already persisted
  -> DiagnosisRun = unavailable
  -> durable degradation reason
  -> planned continue
  -> browser continues
```

## 4. `FrozenLessonGenerationContext` 前置门禁

### 4.1 为什么不能从旧上下文直接切换

新课中对象依赖：

- `semanticRequestDigest`。
- `mappingId/mappingRevision`。
- 与 Map 对齐的 Scene Catalog/checkpoint/question revision。
- 服务器冻结的知识点和 Teaching Guidance。

当前 `FusionSessionRecord.generationContext` 仍是旧 `FrozenTeachingContext` 语义，且课前迁移 A–F 尚未开始。若课中先切换，只能伪造 digest、回填固定 Map 或混用新旧上下文，形成第二个不可信语义源。

### 4.2 可提前开发与不可提前宣称

可以提前开发：

- v2 contracts、strict parser 和 canonical fixtures。
- CheckpointAttempt/Event/Directive/ExecutionReceipt 的数据库表与 repository。
- 浏览器受控执行器和 receipt API。
- DeepTutor 新 diagnosis provider 的 isolated/synthetic 测试。
- shadow comparator、指标和恢复工具。

不得提前切换正式课堂：

- 正式 `QuizView` 不能在没有 Frozen Context 时生成伪 attempt。
- 旧 Session 不能被运行时补写 digest 后升级成 v2。
- 新 Diagnosis 不得把固定 slope Map 当作任意课堂的正式语义根。

### 4.3 正式切换的硬门槛

一个 Session 只有同时满足以下条件，才能固定为 `inClassProtocolVersion=v2`：

1. `FrozenLessonGenerationContext.schemaVersion` 受支持。
2. `semanticRequestDigest` 通过 `fusion-c14n-v1` 校验。
3. Map ID/revision 与 Frozen Context 一致。
4. Catalog/checkpoint/question revision 都由该 Frozen Context 编译并持久化。
5. Session 创建时固定 protocol mode，浏览器不能覆盖。
6. 所有必要的 v2 表、约束、Provider 和执行 receipt 路径健康。

任一条件不满足，新课堂不得进入 v2；已经存在的 legacy Session 继续按 legacy 只读兼容，不动态混合。

## 5. 组件处置矩阵

### 5.1 原样复用

| 能力 | 复用结论 |
| --- | --- |
| HttpOnly Fusion Session Cookie | 继续只恢复不透明 Session，不向浏览器暴露 learner/credential。 |
| PostgreSQL transaction/row lock | 继续保护 Session、attempt、event 和状态提交。 |
| Session identity immutability | lesson、learner、credential reference 不允许在 CAS 中改变。 |
| Scene Catalog 所有权 | 继续属于 OpenMAIC；DeepTutor 只返回协议无关 TeachingIntent。 |
| Planner 的策略匹配与上限方向 | 保留纯函数和 Catalog 匹配思想，在 v2 输入/状态下重写验证。 |
| timeout/circuit breaker | diagnosis 能力继续单独熔断；失败结果改为 durable degradation。 |
| production Mock fail-closed | 生产不得因新 Provider 失败回退 F08 Mock。 |

### 5.2 扩展

| 当前能力 | 必要扩展 |
| --- | --- |
| `FusionSessionRecord` | 增加 frozen context/digest revision、`inClassProtocolVersion`、event intake state 和 v2 RuntimeState reference。 |
| Scene Catalog/checkpoint | 增加 questionRef/questionDigest、checkpoint revision 和 attempt eligibility。 |
| `contracts.ts` | 增加 CheckpointAttempt、LearningEvidenceRequest、Diagnosis status/source、planned Directive、SceneExecutionReceipt、Observation Fact v2。 |
| `classroom-events` Route | 拆为 attempt issue、answer submit、diagnosis orchestration 和幂等结果查询职责。 |
| RuntimeState | 分离 planned/acknowledged/executed/failed；retry count 使用实际 checkpointId。 |
| Persistent facts | 保存 digest、mapping、attempt、diagnosis run、planned directive 和 execution outcome 的稳定引用。 |
| UI 状态 | 显示诊断中、已降级、调整待应用、应用失败和可恢复状态；不把 planned 显示为 executed。 |
| DeepTutor diagnosis | 校验 frozen semantic/mapping/question refs，输出独立 correctnessSource/status/warning。 |

### 5.3 新增

| 新组件 | 职责 |
| --- | --- |
| `CheckpointAttemptStore` | 签发稳定 attempt/idempotency key，绑定 lesson/context/map/checkpoint/question/status/TTL。 |
| `ClassroomEventStoreV2` | 在诊断之前持久化最小可信提交，并按 attempt/event 幂等。 |
| `DiagnosisRecordStore` | DeepTutor 持久保存可回查 diagnosisId/revision/confidence/provenance。 |
| `SceneDirectiveStore` | 保存 planned directive、期望 runtime revision 和状态。 |
| `SceneExecutionReceiptStore` | 验证执行层 receipt，作为推进 RuntimeState 的唯一依据。 |
| `InClassShadowComparator` | 比较 legacy/new 事实、诊断、指令、错误和延迟，不影响正式状态。 |
| `ProtocolModeResolver` | 只在 Session 创建时由服务端选择 legacy/shadow/canonical，后续不可变。 |

### 5.4 替换或升级

| 当前职责 | 替换方向 |
| --- | --- |
| 任意 Quiz 自动提交第一题 | 只有 formal checkpoint renderer 使用服务器签发 attempt；普通 Quiz 保持 OpenMAIC 本地行为。 |
| 浏览器上传 question/local correctness | 浏览器只上传 opaque attemptId、答案和 submission key；题目与本地评估由服务器恢复或重算。 |
| 随机 eventId 每请求生成 | attempt 创建时冻结稳定 event/idempotency identity，重试返回原结果。 |
| 诊断成功后才写事实 | 先写 event，再诊断；失败写 durable degradation。 |
| `applyDirective` 即执行 | 规划只写 planned；执行层 receipt 到达后才 CAS RuntimeState。 |
| 进程内 Observation Ledger 作为结果 | 由持久 facts/read model 生成；内存 store 只保留 development fixture 职责。 |
| `/real-diagnosis` 调用 F08 固定规则 | 新版本 Route/Provider 使用权威 question/map 与受限诊断管线；synthetic provider 明确隔离。 |

### 5.5 兼容期后退役

- 正式课堂由通用 `QuizView` 自动调用旧 classroom-events body。
- 旧 `ClassroomEvent v1` 中浏览器提供 originalQuestion/local correctness 的正式权威语义。
- 服务端把 planned Directive 立即记为 executed 的路径。
- `development-checkpoint` retry count 硬编码。
- 正式 `/real-diagnosis` 对 F08 fixed slope service 的依赖。
- 进程级 `runtimeState` 和 `classroomObservationLedger` 的正式职责。

历史 Session 和事实按原 schema 只读恢复或自然过期，不静默重写成 v2。

## 6. 数据库迁移路线

本节描述逻辑 schema 和顺序，不是最终 DDL。实现 Feature 必须根据 PostgreSQL migration 工具、DeepTutor 选定存储和备份要求定稿。

### 6.1 OpenMAIC additive schema

建议新增：

```text
fusion_checkpoint_attempts
  attempt_id PK
  idempotency_key UNIQUE
  lesson_session_id
  semantic_request_digest
  mapping_id / mapping_revision
  checkpoint_id / checkpoint_revision
  question_id / question_revision / question_digest
  status
  issued_at / expires_at / submitted_at?
  revision

fusion_classroom_events_v2
  event_id PK
  attempt_id UNIQUE
  lesson_session_id
  canonical_payload_hash
  event_status
  event_json
  occurred_at / created_at

fusion_scene_directives
  directive_id PK
  source_event_id UNIQUE
  expected_runtime_revision
  status: planned | acknowledged | executed | failed | expired
  directive_json
  planned_at / terminal_at?

fusion_scene_execution_receipts
  receipt_id PK
  directive_id UNIQUE
  execution_id UNIQUE
  observed_runtime_revision
  status
  reason_code?
  received_at
```

`fusion_sessions` 逻辑增加：

```text
generation_context_schema_version
semantic_request_digest
mapping_revision
in_class_protocol_version
event_intake_status
```

关键查询字段使用独立列和约束；完整版本化 payload 可以继续使用 JSONB。不要只在 JSONB 内保存 protocol version 后靠应用猜测。

### 6.2 DeepTutor additive schema

建议新增持久 `fusion_diagnosis_records`，至少保存：

```text
diagnosis_id / revision
event_id UNIQUE per revision
lesson_session_id
learner_subject_id
semantic_request_digest
mapping_id / mapping_revision
question_digest
status / correctness / correctness_source
diagnosis_json
model_or_policy_revision
created_at
```

该表既服务课中重放，也为课后 Candidate 中 `sourceDiagnosisId` 回查提供权威记录。具体物理后端遵循 DeepTutor 单一权威存储选择。

### 6.3 Migration 顺序

1. 创建新表、索引和 nullable 新列；不改变旧 Route。
2. 部署 v2 repository/parser，但 protocol mode 默认 `legacy_v1`。
3. 新创建的授权合成 Session 可写 `shadow_v2`；旧 Session 不回填 semantic digest。
4. shadow 数据稳定后，为新 v2 Session 启用 `NOT NULL`/CHECK/UNIQUE 约束；旧记录通过 protocol version 隔离。
5. canonical cohort 切换后停止创建新的 v1 事实。
6. 等 legacy Session 保留期结束、审计与回滚窗口完成后再删除旧正式写入路径和冗余列/表。

### 6.4 禁止回填

- 不从旧 fixed Map 猜测 `semanticRequestDigest`。
- 不把旧 Directive 的数据库 CAS 推断成实际 execution receipt。
- 不为旧随机 event 合成 checkpoint attempt。
- 不将旧 local correctness 改标为 DeepTutor independent diagnosis。

无法证明的历史状态保持 legacy/unknown，不能通过 migration 制造可信事实。

## 7. 双轨兼容

### 7.1 Session 固定模式

```text
legacy_v1
  旧 Session/Route/事实语义；仅兼容和回滚

shadow_v2
  legacy 仍控制用户路径；v2 旁路计算与持久化隔离

canonical_v2
  v2 attempt/event/diagnosis/receipt 控制正式路径
```

- 模式由服务端在 Session 创建时固定。
- 浏览器、请求 body 和 feature query string 不得选择模式。
- 同一 Session 不能从 v2 facts 回退后继续写 v1 facts。
- 旧 Session 不动态升级；新 Session 可按受控 cohort 创建。

### 7.2 Route/contract 隔离

- v1/v2 使用不同 schema 和严格 parser；可使用不同 endpoint 或显式版本 dispatch。
- v2 parser 不接受 v1 body 后自行补 attempt/digest。
- legacy response 不得被 v2 execution layer 当作 planned directive。
- dual write 只允许同一权威 attempt 派生 read model，不允许分别生成两组 event ID。

## 8. Shadow 验证

### 8.1 Shadow 不得产生的副作用

- 不改变播放器 Scene。
- 不推进正式 RuntimeState。
- 不写入正式课后 Candidate eligibility。
- 不向用户显示“已执行”或“画像已更新”。
- 不因 shadow 失败让课堂失败，也不回退 Mock 冒充新结果。

### 8.2 比较内容

| 维度 | 比较方式 |
| --- | --- |
| Attempt 绑定 | checkpoint、question、Map、digest 必须与 Frozen Context 精确一致。 |
| Event 幂等 | 同 attempt/submission 重放必须返回相同 event/result。 |
| Diagnosis | 比较 status、correctnessSource、correctness、misconception code、confidence 和 warnings；语义差异进入审阅，不要求旧 synthetic 结果成为真值。 |
| TeachingIntent | 比较 kind、目标知识点、策略码和 reason；Map 外目标为阻断错误。 |
| Directive | 使用同一 Catalog/RuntimeState 比较 planned kind/target/reason；v2 不执行。 |
| Failure | 网络、无效响应、超时必须在 v2 形成 durable degradation；旧 503 仅作为现状对照。 |
| 数据最小化 | 浏览器 payload、跨域请求、日志不得新增 learner、token、Memory 或无关正文。 |
| 延迟 | 记录 v2 各阶段 p50/p95/p99，阈值由实现 Feature 基于测试环境定稿。 |

### 8.3 Shadow 切换门槛

正式 cohort 前至少满足：

- 0 个跨 lesson/learner/digest/mapping 错配。
- 0 个普通 Quiz 被创建为 formal attempt。
- 诊断失败场景 100% 保留稳定 event 与 degradation reason。
- 相同 attempt 重放 100% 返回同一权威结果。
- planned Directive 0 次在 receipt 前被标记 executed。
- retry/remediation 上限由实际 checkpointId 验证。
- 所有 diagnosis 语义差异完成分类：expected improvement、legacy defect、new defect 或 product review。

比例阈值不能掩盖身份、完整性或跨用户错误；这些错误出现一次即阻止切换。

## 9. 最低风险迁移阶段

### 阶段 A：前置契约与存储骨架

目标：实现 F31 canonicalizer、v2 contracts/parser、additive migration，不改变用户路径。

- 两个 Fork 消费同一 golden fixtures。
- OpenMAIC 建立 Attempt/Event/Directive/Receipt repository。
- DeepTutor 建立 strict request/diagnosis record schema。
- Session protocol mode 默认 legacy。

完成判据：契约、canonical bytes、migration up/down、未知版本/字段、digest/mapping mismatch 负向测试通过。

### 阶段 B：服务器拥有的 CheckpointAttempt

目标：切断通用 Quiz 和正式 checkpoint 的混淆。

- Catalog 编译 formal checkpoint 与 question revision。
- OpenMAIC 服务端签发 attempt；browser 只提交 attemptId+answer。
- submission 重放使用稳定 idempotency identity。
- 普通 Quiz 不调用正式 Fusion event route。

完成判据：伪造 scene/checkpoint/question/local correctness、非 checkpoint Quiz 和响应丢失重放均不能产生重复或错属事实。

### 阶段 C：先持久 Event，再独立诊断

目标：学生提交不会因 DeepTutor 故障丢失。

- Event 在诊断前事务落盘。
- DeepTutor 新 Route 校验 lesson/digest/map/question refs。
- synthetic provider 明确标记，真实 Provider 在后续小 Feature 替换。
- 失败写 durable `diagnosis_unavailable` 和 continue reason。

完成判据：超时、熔断、无效 payload、event mismatch、重启和重放测试均保留同一 event；local correctness 不能直接成为 independent diagnosis。

### 阶段 D：planned Directive 与执行回执

目标：只有课堂执行层确认后才改变权威可见状态。

- Planner 只创建 planned Directive。
- 浏览器/Stage 受控执行允许的 Scene 变化。
- receipt 关联 directive/source event/runtime revision。
- 服务端验 receipt 后 CAS RuntimeState，写 executed/failed/expired。

完成判据：断网、重复 receipt、过期 revision、非法 target、客户端应用失败和刷新恢复均不会产生伪 executed。

### 阶段 E：Shadow v2

目标：在授权合成 cohort 比较 legacy 与新链路，不控制课堂。

- 使用同一 Frozen Context、attempt 输入和 Catalog。
- 保存结构化 diff，不保存额外敏感数据。
- 修复所有阻断错误并完成诊断语义审阅。

完成判据：满足第 8.3 节全部门槛，并完成受控重启/并发/失败注入证据。

### 阶段 F：正式读取与执行切换

目标：只让满足课前硬门槛的新 Session 使用 canonical v2。

- 服务端 cohort flag 创建 canonical v2 Session。
- v2 attempt/event/diagnosis/receipt 成为唯一正式权威链。
- UI 显示真实状态与恢复入口。
- legacy Session 继续 legacy，不混写。

完成判据：端到端课堂中至少覆盖 continue、remediation、retry、diagnosis unavailable、execution failure 和刷新恢复。

### 阶段 G：旧课中路径退役

目标：移除无正式消费者的 v1 语义源。

- 停止创建 legacy Session，监测旧 Route 流量。
- 等保留窗口内 legacy Session 完成或失效。
- 演练完整版本回滚，不依赖新旧对象拼接。
- 最后删除旧正式 Quiz 自动提交、提前 applyDirective、fixed diagnosis 和内存正式状态。

完成判据：正式课中只有一个 attempt/event/execution 权威链；旧路径无流量且无数据库活跃依赖。

## 10. 回滚规则

| 阶段 | 回滚动作 | 保留内容 |
| --- | --- | --- |
| A–B | 关闭 v2 issue/shadow flag，恢复 legacy 新 Session 创建 | 新表与 migration 保留，避免破坏已写数据。 |
| C | 停止新 Diagnosis Provider 调用，保留已持久 Event/degradation | 不删除学生已经提交的事实。 |
| D | 停止签发新的可执行 v2 Directive；未终态 Directive 标记 expired | 已执行 receipt 与 RuntimeState 不倒推删除。 |
| E | 关闭 shadow，不影响 legacy 用户路径 | diff/指标按政策保留或清理。 |
| F | 只对尚未开始的新 Session 恢复 legacy 创建 | 已是 canonical v2 的 Session 必须继续 v2、受控结束或显式终止，不能降级混写。 |
| G | 仅在旧代码/表尚未删除且回滚演练通过时恢复完整 legacy 版本 | 不通过临时兼容桥混合 schema。 |

数据库 drop、历史事实重写和删除旧 Route 都是末期不可逆动作，必须单独审批、备份、演练并确认无消费者。

## 11. 退役条件

旧课中路径只有同时满足以下条件才可退役：

- 课前 Frozen Context 正式切换完成。
- canonical v2 新 Session 覆盖目标 cohort，并完成稳定观察窗口。
- 旧 Route、v1 Session、fixed diagnosis 和旧 facts 的活跃读写为零。
- legacy Session 已完成、过期或按明确策略失效。
- 课中 v2 全部 F26 findings 回归通过。
- rollback 只需要部署一套完整旧版本，不依赖混合数据库语义。
- 两个 Fork 分别完成构建、测试、独立审查、提交、推送与发布证据。

## 12. Finding 到阶段追踪

| F26 finding | 主要阶段 | 完成证据 |
| --- | --- | --- |
| H1 通用 Quiz/本地评分冒充 checkpoint | B、C | server-owned attempt、普通 Quiz 隔离、independent diagnosis 负向测试。 |
| H2 planned 被记为 executed | D | execution receipt、刷新/失败/重复回执测试。 |
| H3 诊断失败丢事实 | C | event-first 与 durable degradation 失败注入。 |
| M1 event 无稳定幂等 | B、C | 响应丢失、双提交和重启重放。 |
| M2 retry count 硬编码 | D | 多 checkpoint Catalog 上限测试。 |
| M3 mapping/degraded/executionStatus 失真 | C、D | v2 fact/read model 重建与正常 continue 测试。 |
| M4 real diagnosis 仍固定规则 | C、E、F | synthetic 标记、真实 Provider 切换与 warning/来源验证。 |

## 13. Feature 切分建议

至少拆为：

1. 跨 Fork v2 contract/canonicalizer 与 additive migration。
2. OpenMAIC CheckpointAttempt 和 formal checkpoint renderer。
3. Event-first 持久化与 durable degradation。
4. DeepTutor v2 diagnosis Route/Record 与独立 Provider。
5. planned Directive、Stage executor 与 execution receipt。
6. shadow comparator 和受控验证。
7. canonical v2 正式切换。
8. legacy 课中路径退役。

每个 Feature 都应限制文件/数据库范围，包含负向测试、失败注入、并发/重启验证及所属 Fork 的 Git 闭环。

## 14. 迁移台账

截至 2026-07-31：

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| A：契约与存储骨架 | `not_started` | F31 只有规范和 fixtures，两个 Fork 尚未实现。 |
| B：CheckpointAttempt | `not_started` | 当前仍由通用 Quiz 提交第一题。 |
| C：Event-first 与独立诊断 | `not_started` | 当前诊断失败仍在事实落盘前返回 503。 |
| D：执行回执 | `not_started` | 当前服务端仍在浏览器执行前推进 RuntimeState。 |
| E：Shadow v2 | `not_started` | 尚无 comparator 或隔离 shadow store。 |
| F：正式切换 | `not_started` | 受课前 Frozen Context 硬门槛阻塞。 |
| G：旧路径退役 | `not_started` | 所有 legacy 组件仍需保留。 |

F32 `passing` 只能表示本路线设计完成。只有后续代码 Feature 提供测试、运行、审查和 Git 证据后，才能更新上表。

## 15. 迁移完成总体判据

- 只有服务器签发的 formal attempt 能进入课中 Fusion。
- 浏览器不能覆盖 question、checkpoint、Map、digest、correctness 或 runtime revision。
- Event 先可靠持久化；诊断失败不会丢失提交。
- DeepTutor 诊断来源独立、版本化、可回查，synthetic 状态不会冒充真实诊断。
- Directive planned、执行层 receipt 和 RuntimeState 提交严格分离。
- Observation Fact 能重建 digest、mapping、attempt、diagnosis、directive 和 execution outcome。
- 同一 attempt/event/receipt 重放幂等，跨 Session/Map/revision 请求失败关闭。
- legacy 路径无正式流量并按证据退役。
