# 课堂后 Fusion 代码迁移路线

## 1. 文档定位与当前状态

本文说明如何从当前课堂完成、Candidate Outbox 与 DeepTutor Receipt happy path，渐进迁移到[课堂后语义交换协议规范](./06-post-class-semantic-exchange-protocol.md)定义的跨域目标，并接入 [Learner 身份解析](./08-deeptutor-learner-state-and-identity-resolution.md)与 [Candidate Inbox 自动画像流水线](./09-candidate-inbox-driven-profile-pipeline.md)提供的 DeepTutor 内部基础。三者是协议、身份和内部处理的平行专门规范，不是文档隶属关系。

- 性质：provisional/reference 实施导航、数据库迁移、兼容/回滚和迁移台账，不是新的画像算法。
- 依据：F27 只读审查、F29 协议、F30 身份/Inbox 设计、F31 canonical digest 规范。
- 当前实现状态：**所有迁移阶段均为 `not_started`**；当前正式链路仍是 F27 审查的 happy path。
- 审核状态：本文尚未完成人工审核，不能直接作为已批准实现路线。
- 前置关系：可靠 closeout 依赖[课堂中迁移路线](./05-in-class-fusion-code-migration-roadmap.md)产出的可信课中事实；正式 v2 Candidate 依赖文档 `10` 的 `factSetDigest`/`canonicalPayloadHash` 和文档 `08` 的 DeepTutor Lesson Binding。
- 边界：本文不修改两个 Fork、数据库、Secret、架构 SSOT 或长期画像算法，也不表示 F27 findings 已修复。

## 2. 审查基线

### 2.1 Git 基线

截至 2026-07-31：

- OpenMAIC：`fusion-adapter`，`d4d6604dbf597c38957ebe6440361762a0673f1a`。
- DeepTutor：`fusion-adapter`，`afc8af303c71d32bc144f549a628d58f310fbadc`。
- 版本与 F27 报告一致；F27 的 5 High、3 Medium 仍适用。

### 2.2 当前交互路径

```text
PostgreSQL fusion_classroom_facts
  -> POST /api/fusion/lesson-completed
  -> completePersistentLesson()
  -> 读取当前 facts
  -> 只按 authoritativeRef 投影 observations
  -> fusion_lesson_completions + fusion_outbox 同事务
  -> 事务外 Session CAS completedAt
  -> Outbox Worker lease
  -> service-account client 注入 learnerKey
  -> DeepTutor /real-profile-updates
  -> 短期 delegation/test service-account 校验
  -> 进程内 _accepted set 去重
  -> accepted/duplicate status-only Receipt
  -> OpenMAIC delivered/retry/dead-letter
```

### 2.3 现有实现位置

| 职责 | 当前实现 | 当前行为 |
| --- | --- | --- |
| 课堂完成 Route | `OpenMAIC/app/api/fusion/lesson-completed/route.ts` | 先执行 closeout，再单独 CAS `completedAt`；CAS 冲突未形成补偿。 |
| facts/completion | `OpenMAIC/lib/fusion/persistent-lesson.ts` | JSONB facts；completion 与 Outbox 同事务，但 Session/event intake 不在同一事务边界。 |
| Candidate projector | `OpenMAIC/lib/fusion/persistent-lesson.ts` | 只检查 authoritativeRef，不强制 `mappingStatus=mapped`，无 fact set/payload digest。 |
| 开发 Candidate | `OpenMAIC/lib/fusion/profile-update-candidate.ts` | v1 最小结构存在，但固定 development Map。 |
| PostgreSQL Outbox | `OpenMAIC/lib/fusion/outbox/postgres-store.ts` | lease、attempt、retry/dead-letter、operator action 骨架存在；discard 不形成终态。 |
| Worker | `OpenMAIC/lib/fusion/outbox/worker.ts` | 错误分类只看有限异常形状，未识别错误首次可 dead-letter。 |
| Service client | `OpenMAIC/lib/fusion/adapter/service-account-client.ts` | 发送 payload 时注入 learnerKey，只解析 Receipt status/reason。 |
| Secret 边界 | `OpenMAIC/lib/fusion/credentials/secret-manager.ts` | 数据库只保留 credentialRef；缺统一正常删除/保留任务。 |
| Session Store | `OpenMAIC/lib/fusion/session-store/postgres.ts` | 支持按 learner/lesson 删除和过期清理，但不级联 facts/completion/Outbox/Secret。 |
| DeepTutor 服务身份 | `DeepTutor/deeptutor/api/services/fusion_delegation.py` | test service identity 仍要求同进程、未过期课堂 delegation。 |
| DeepTutor Candidate Route | `DeepTutor/deeptutor/api/routers/fusion_profile_updates.py` | 从 Candidate 读取 learnerKey 辅助授权。 |
| DeepTutor 接收/幂等 | `DeepTutor/deeptutor/api/services/fusion_profile_updates.py` | 严格能力有限，使用进程内 `_accepted` set，无 payload hash 冲突检测。 |

### 2.4 当前正向资产

- Candidate 是观察证据，不直接指定 mastery、偏好或长期弱点。
- completion marker 与 Outbox message 的正常创建已经位于同一 PostgreSQL transaction。
- Outbox 已有 PostgreSQL lease、SKIP LOCKED、attempt、retry、dead-letter 和 operator audit 基础。
- Worker 已使用独立服务 Token Provider，不从浏览器读取课堂 token。
- Outbox payload 有凭证字段扫描，数据库只保存 credential reference。
- 课堂总结保持 `longTermProfileStatus=not_confirmed`，没有把 accepted 冒充画像已更新。

### 2.5 当前语义断点

1. closeout 后 event intake 仍开放，完成 facts 与 Candidate 可分叉。
2. Session completed、fact set freeze、Candidate 和 Outbox 不在同一事务。
3. 没有不可变 FrozenLessonFactSet/factSetDigest。
4. Candidate eligibility 未强制 `mappingStatus=mapped`。
5. 没有 `canonicalPayloadHash`，重复与冲突无法可靠区分。
6. Worker service identity 仍被短期内存 delegation 限制。
7. Candidate 自带 learnerKey，DeepTutor 没有持久 Lesson Binding。
8. DeepTutor Inbox/Receipt 只在进程内，重启后丢失幂等状态。
9. Receipt 没有严格 candidate/key/hash/schema/receivedAt 关联。
10. transient cause chain 与 Secret unavailable 可被误判 permanent。
11. discard 后仍可 replay，payload 继续保留。
12. Session/facts/completion/Outbox/Secret/Inbox/派生画像没有统一生命周期。

## 3. 目标代码路径

```text
可信 ClassroomObservationFacts
  -> lock Fusion Session
  -> verify event intake open
  -> close event intake
  -> freeze FrozenLessonFactSet + factSetDigest
  -> mapped-only Candidate projection
  -> canonicalPayloadHash
  -> atomic Session completed + fact set + completion + Candidate Outbox
  -> asynchronous Worker with minimal service identity
  -> DeepTutor lessonSessionId -> persistent Lesson Binding -> learnerSubjectId
  -> durable Candidate Inbox + strict Receipt
  -> Fact/Mastery/Memory projectors
  -> separately queryable ProcessingOutcome
```

课堂完成请求只等待 OpenMAIC 本地事务，不等待 DeepTutor、Agent、Mastery 或 L3。

## 4. 前置依赖与阶段门禁

### 4.1 可信课中事实

v2 closeout 只能消费满足以下条件的课中事实：

- 来自 server-owned CheckpointAttempt。
- event、diagnosis、directive 和 execution status 可追踪。
- 带 Frozen Context 的 semantic digest、Map ID/revision。
- diagnosis unavailable 也有 durable fact，不靠缺失记录表达。
- closeout 能明确判断 mapped eligibility。

在课中 v2 未切换前，可以开发 closeout repository/projector，但不得把旧事实自动宣称为 `factSetSchema=v2`。旧事实只能进入 legacy/shadow 对照。

### 4.2 Canonical digest

正式 v2 需要两个 Fork 已实现并通过 F31 共用 fixtures：

- OpenMAIC 计算/保存 `factSetDigest` 与 `canonicalPayloadHash`。
- DeepTutor 重算 Candidate hash，拒绝 mismatch。
- Receipt 回显 canonicalization/digest schema 和 payload hash。

禁止临时使用 `JSON.stringify`/`json.dumps` 默认输出填充目标字段。

### 4.3 Lesson Binding

正式 v2 Candidate 不带 learnerId/learnerKey。DeepTutor 必须在 Launch Code exchange 时持久创建：

```text
lessonSessionId -> learnerSubjectId
```

Binding 的生命周期长于课堂 delegation；短期 delegation 过期或 DeepTutor 重启后仍可解析。只有 Binding、服务身份和 lesson scope 同时有效，Candidate 才能入 Inbox。

### 4.4 正式切换门槛

一个 Session 只有同时满足以下条件才能使用 `postClassProtocolVersion=v2`：

1. 课中 fact schema 和 Frozen Context 版本受支持。
2. OpenMAIC atomic closeout migration 已应用。
3. F31 canonicalizer 在两端可用。
4. DeepTutor Lesson Binding 已持久创建。
5. Candidate Inbox 与 strict Receipt 为持久权威后端。
6. Outbox v2 状态、错误分类和 lifecycle coordinator 可用。

不满足时，不能生成“部分 v2 Candidate”；legacy Session 按其旧协议完成或明确标记不具备 v2 资格。

## 5. 组件处置矩阵

### 5.1 原样复用

| 能力 | 复用结论 |
| --- | --- |
| PostgreSQL transaction/row lock | 继续作为 OpenMAIC atomic closeout 基础。 |
| Outbox SKIP LOCKED/lease | 保留并扩展状态、hash 和 receipt 关联。 |
| attempt/backoff 上限方向 | 保留有限重试，不无限投递。 |
| Secret reference 边界 | 数据库继续只保存 reference，不保存 token。 |
| Candidate 不含长期命令 | 继续作为硬 schema 约束。 |
| 课堂不等待后台更新 | closeout 只保证本地可靠入队。 |
| `longTermProfileStatus=not_confirmed` | 在真正 Outcome 可查询前继续使用。 |

### 5.2 扩展

| 当前能力 | 必要扩展 |
| --- | --- |
| `FusionSessionRecord` | 增加 event intake、closeout/fact set revision、post-class protocol version 和 lifecycle state。 |
| facts/completion | 增加 immutable fact set、digest schema、canonical hash 和 closeout result。 |
| Candidate projector | 强制 mapped-only、provenance、sourceDiagnosis refs、稳定 observation ID。 |
| Outbox row | 增加 payload hash/digest versions、strict receipt、discarded 和 payload-retention state。 |
| Worker | 显式 transient/permanent error types、cause chain、Secret unavailable、unknown delivery outcome。 |
| Service client | 不再注入 learnerKey；严格解析并关联 Receipt 全字段。 |
| Session/Outbox delete | 由 lifecycle coordinator 编排全部数据库和外部 Secret 删除。 |
| DeepTutor user scope | Binding 解析后显式安装/reset CurrentUser/UserScope。 |

### 5.3 新增

| 新组件 | 职责 |
| --- | --- |
| `FrozenLessonFactSetStore` | 保存 immutable fact IDs、revision、digest 和 closeout time。 |
| `EligibleCandidateProjector` | 从 frozen facts 严格投影 mapped-only Candidate。 |
| `FusionLessonBindingStore` | DeepTutor 持久解析 lesson -> learner subject。 |
| `CandidateInboxStore` | 事务接收、幂等/hash 冲突、Receipt、lease/retry/dead-letter。 |
| `FusionLearningFactStore` | 保存外部 Candidate 到内部事实的 provenance/revision。 |
| `CandidateProcessingOutcomeStore` | 分开记录 facts/mastery/proposal/L2/L3 结果。 |
| `FusionLifecycleCoordinator` | 编排 Session、facts、completion、Outbox、Secret、Binding、Inbox、Facts 与派生投影删除。 |
| `PostClassShadowComparator` | validate-only 比较 legacy/new Candidate，不产生长期写入。 |

### 5.4 替换或升级

| 当前职责 | 替换方向 |
| --- | --- |
| completion 后再 Session CAS | 在同一事务锁 Session、关 event intake、freeze、completed、Candidate/Outbox。 |
| 仅凭 authoritativeRef 资格 | 同时要求 `mappingStatus=mapped`、完整 ref、相同 Map/digest 和事实 provenance。 |
| candidateId 既作 key 又无 payload hash | 使用稳定 candidate/idempotency identity + `canonicalPayloadHash`。 |
| Candidate 传 learnerKey | Candidate 只传 lessonSessionId；DeepTutor 查询持久 Lesson Binding。 |
| DeepTutor `_accepted` set | 持久 Candidate Inbox，保存 key/candidate/hash/原 Receipt。 |
| status-only Receipt | 版本化 Receipt，严格回显 candidate/key/hash/status/receivedAt。 |
| discard 写 reasonCode | `discarded` 不可重放终态，并按政策清空 payload。 |

### 5.5 兼容期后退役

- `fusion_lesson_completions` 作为仅 candidate ID/time 的完整 closeout 语义。
- Session completedAt 的事务外补写路径。
- 正式 Candidate 中的 `learnerKey`。
- DeepTutor 进程内 `_accepted` 和 `_delegations` 作为后台授权/幂等权威。
- status-only Receipt parser。
- `dead_letter + operator_discarded reason` 的伪 discard。
- 没有统一生命周期的独立 purge 方法作为完整删除语义。

## 6. 数据库迁移路线

### 6.1 OpenMAIC additive schema

建议新增：

```text
fusion_lesson_fact_sets
  fact_set_id PK
  lesson_session_id UNIQUE
  fact_set_revision
  fact_set_digest
  canonicalization
  digest_schema_version
  source_event_ids_json
  status: frozen | deleting | deleted
  closed_at

fusion_closeout_results
  lesson_session_id PK
  closeout_revision
  fact_set_id
  candidate_id?
  idempotency_key?
  canonical_payload_hash?
  eligibility_status
  reason_code?
  completed_at

fusion_lifecycle_jobs
  job_id PK
  scope_type / scope_id
  operation
  status / attempt_count / next_attempt_at
  last_reason_code?
  created_at / updated_at
```

`fusion_sessions` 逻辑增加：

```text
event_intake_status: open | closing | closed
post_class_protocol_version
closeout_revision
fact_set_id?
lifecycle_status
```

`fusion_outbox` 逻辑增加：

```text
canonical_payload_hash
canonicalization
payload_schema_version
receipt_schema_version?
receipt_candidate_id?
receipt_payload_hash?
received_at?
status includes discarded
payload_retention_status
```

现有 `fusion_classroom_facts` 可在兼容期保留；v2 facts 必须有 protocol/digest/mapping/execution 列或稳定 JSON schema，供事务内 eligibility 查询。

### 6.2 DeepTutor additive schema

物理后端遵循文档 09 的单一权威选择。逻辑新增：

```text
fusion_lesson_bindings
  lesson_session_id UNIQUE
  learner_subject_id
  audience / launch_token_id
  status / revision
  expires_at / retention_until

fusion_candidate_inbox
  candidate_id
  receipt_id
  idempotency_key UNIQUE
  canonical_payload_hash
  canonicalization / payload_schema_version
  lesson_session_id
  learner_subject_id
  payload_json
  status / attempt_count / next_attempt_at
  received_at / processed_at?

fusion_processing_runs
  run_id
  candidate_id
  worker_id / lease_until
  status / projector_versions
  outcome_json / error_code

fusion_learning_facts
  fact_id
  candidate_id / observation_id
  learner_subject_id / lesson_session_id
  authoritative_ref / provenance / revisions
  value_json / confidence fields
  occurred_at / created_at
```

Inbox unique constraint必须绑定 idempotency key 与 payload hash 冲突检测；同 key/同 hash 返回原 Receipt，同 key/不同 hash 拒绝且不覆盖。

### 6.3 Migration 顺序

1. 两端创建 additive 表/列/索引，所有新写开关关闭。
2. Launch exchange 对授权合成新 Session 双写 Lesson Binding；旧 delegation 保留。
3. OpenMAIC closeout 生成 frozen fact set 和 v2 Candidate shadow，但不投递。
4. DeepTutor 新 Inbox 以 validate-only/isolated shadow 接收合成 Candidate，不触发长期 Projector。
5. 加强约束并验证重启、冲突、删除和并发。
6. 新 cohort 单投递 v2 Candidate；严禁 legacy/v2 双投递到生产 Inbox。
7. 停止创建 legacy completion/Candidate 后等待保留窗口。
8. 最后清理旧字段、进程内 authority 和旧 Route。

### 6.4 回填规则

- 旧 Session 没有持久 Lesson Binding 时不从 Candidate learnerKey 反向伪造 Binding。
- 旧 facts 没有可信 execution status/digest 时不回填 v2 fact set。
- 可将旧完成记录标记 `legacy_v1`，但不能生成假的 factSetDigest。
- 旧 `_accepted` set 无法可靠迁移；只对切换后新 Candidate 使用持久 Inbox。
- 已 delivered legacy Candidate 不重新投递 v2，避免长期画像双计。

## 7. 双轨兼容

### 7.1 Session 固定模式

```text
legacy_v1
  旧 closeout/Candidate/Receipt；只服务历史 Session

shadow_v2
  生成新 fact set/Candidate 并 validate-only 比较，不投递长期写入

canonical_v2
  新 atomic closeout、Binding、Inbox、strict Receipt 为唯一权威链
```

- 模式在 Session 创建时固定并继承课中协议版本。
- v2 不能消费 legacy 与 canonical facts 的混合集合。
- 一个课堂最多向生产 DeepTutor Inbox 投递一个 protocol family 的 Candidate。
- 浏览器不能选择模式、重试方式或 learner binding。

### 7.2 Receipt 与状态兼容

- legacy Receipt 只供 legacy message parser 使用。
- v2 Outbox 必须使用 strict Receipt parser；缺 candidate/key/hash/schema/time 即失败。
- 旧 UI 状态可继续展示 queued/received/not_confirmed，但不得把 legacy Receipt 转译成 v2 processing outcome。
- Candidate accepted 与长期 projection outcome 始终分开。

## 8. Shadow 验证

### 8.1 安全形态

Shadow 必须是以下之一：

- OpenMAIC 本地只生成/比较 v2 Candidate，不发送。
- 发送到 DeepTutor 隔离的 validate-only endpoint/store，明确禁止创建 Fusion facts、Mastery 或 Memory projection。

禁止把 legacy 和 v2 Candidate 都发到生产 Inbox，再靠下游“去重”。两种 Candidate 的 ID/hash/observation 可能不同，无法保证不双计。

### 8.2 比较内容

| 维度 | 比较方式 |
| --- | --- |
| Fact set 完整性 | closeout 锁内 facts 数、sourceEventIds、revision 和 digest；closeout 后 event 必须拒绝。 |
| Candidate eligibility | v2 只能等于或严格收窄 legacy eligible set；任何 non-mapped 新增为阻断错误。 |
| Provenance | 每个 observation 可追到 event/diagnosis/map revision。 |
| Canonical hash | 不同 key insertion order 相同；任何语义变化不同；两端重算一致。 |
| Binding | delegation 过期/DeepTutor 重启后仍解析同 learner；Candidate 无 learner 字段。 |
| Inbox 幂等 | same key+same hash 返回原 Receipt；same key+different hash rejected。 |
| Receipt | candidate/key/hash/schema/receivedAt 全量关联。 |
| Reliability | Secret/DNS/connect/timeout/429/5xx 重试；schema/auth/mismatch permanent。 |
| Lifecycle | learner/lesson 删除覆盖两端存储和 Secret，失败任务可恢复。 |

### 8.3 Shadow 切换门槛

- 0 个 closeout 后 facts 被接受。
- 0 个 non-mapped/Map 外观察进入 v2 Candidate。
- 0 个 Candidate 双投递或跨 learner Binding。
- canonical hash 跨语言 fixture 与 shadow payload 100% 一致。
- DeepTutor 重启、delegation 过期、重复投递、同 key 冲突测试全部通过。
- transient failure 全部进入有限 retry，permanent failure 不循环。
- discard 后 replay 100% 被拒绝，payload 按政策处置。
- 删除/保留失败可重试且最终无孤儿 facts/completion/Secret/Inbox。

身份、数据资格、完整性和双写错误出现一次即阻止切换。

## 9. 最低风险迁移阶段

### 阶段 A：Atomic closeout 与 Frozen Fact Set

目标：先闭合 OpenMAIC 自身完成边界。

- 在同一事务锁 Session、检查 open、关闭 event intake。
- 冻结可信 facts、计算 factSetDigest、写 completed/fact set/closeout。
- event route 在同一权威锁语义下拒绝 closed Session。
- 暂不改变正式 Candidate 投递。

完成判据：event-after-closeout、并发 event/closeout、重复 closeout、事务失败与重启测试无事实漏出。

### 阶段 B：Mapped-only Candidate 与 Canonical Hash

目标：让 OpenMAIC v2 Candidate 投影可独立验证。

- 实现 F31 `factSetDigest`/`canonicalPayloadHash`。
- 严格 Map parser 和 mapped-only projector。
- observation ID/provenance/source diagnosis revision 完整。
- 只做 shadow，不向生产 Inbox 双投递。

完成判据：missing/lesson_local/unresolved/ref mismatch/digest mismatch 全部拒绝；两端 fixtures 一致。

### 阶段 C：Lesson Binding 与服务身份

目标：落实文档 `08` 已选定的持久 Lesson Binding。

- DeepTutor Launch exchange 原子创建持久 Binding。
- Worker 使用最小 service identity，Candidate 删除 learnerKey。
- delegation TTL 与 Binding retention 分离。
- 撤销/删除状态进入 Binding。

完成判据：DeepTutor 重启、delegation 过期、lesson 冲突、服务 scope 错误、撤销/删除和跨 learner 尝试测试通过。

### 阶段 D：Persistent Candidate Inbox 与 Strict Receipt

目标：可靠接收并严格关联，不立即跑画像 Agent。

- 建立 Inbox/Processing Run 与唯一约束。
- 重算 hash，same/same 返回原 Receipt，same/different 冲突拒绝。
- Receipt 回显 schema/candidate/key/hash/status/receivedAt。
- OpenMAIC 全量校验后才 delivered。

完成判据：重启幂等、并发重复、hash 冲突、畸形 Receipt、wrong candidate 和数据库失败测试通过。

### 阶段 E：Outbox 可靠性与状态修复

目标：让 transient/permanent、discard/replay 具有真实语义。

- 定义 typed delivery errors 并遍历 cause chain。
- Secret unavailable/DNS/connect/timeout/429/5xx 为 transient。
- `discarded` 为不可重放终态，可清除 payload。
- unknown delivery outcome 保持可恢复，不误报 delivered。

完成判据：真实 Node fetch error shape、Secret outage、lease expiry、四次上限、operator replay/discard 测试通过。

### 阶段 F：Lifecycle Coordinator

目标：闭合跨数据库和 Secret 的删除/保留。

- 数据库事务标记 deleting 并阻止新 lease/event。
- 删除 Session/facts/fact sets/completion/Outbox/audit 的受限内容。
- 可重试删除 credential Secret。
- 调用/编排 DeepTutor Binding/Inbox/Facts/derived projection 删除重建。
- 保留脱敏审计，不保留被删除正文。

完成判据：任一阶段故障后恢复、重复删除幂等、无 orphan 与保留期 purge 验证通过。

### 阶段 G：Shadow v2

目标：在合成授权 cohort 验证完整新链，但不产生长期画像副作用。

- legacy 控制课堂总结与正式投递。
- v2 生成并进入 isolated validate-only Inbox。
- 比较第 8.2 节全部维度。

完成判据：满足第 8.3 节门槛并完成并发、重启、错误注入、删除演练。

### 阶段 H：正式单轨切换

目标：符合全部前置条件的新 Session 只投递 v2。

- 服务端 cohort 创建 canonical v2 Session。
- atomic closeout 后只 enqueue v2 Candidate。
- strict Receipt 决定 delivered；长期 Outcome 独立显示。
- legacy Session 继续旧路径直至结束。

完成判据：课堂完成不阻塞；queued/retry/dead-letter/discarded/accepted/duplicate/processing outcome 均准确可恢复。

### 阶段 I：旧课后路径退役

目标：移除无正式消费者的旧授权、Candidate 和 Receipt 语义。

- 停止创建 legacy closeout/Candidate。
- 等 legacy Session/Outbox/retention window 清空。
- 演练完整版本回滚。
- 最后删除 learnerKey 注入、进程内 `_accepted`/delegation authority、status-only Receipt 和旧 completion 写法。

完成判据：生产只有一条 lesson Binding、Candidate hash、Inbox Receipt 与 lifecycle 权威链。

## 10. 回滚规则

| 阶段 | 回滚动作 | 不允许的动作 |
| --- | --- | --- |
| A–B | 关闭 v2 closeout/shadow 创建，保留 additive 表 | 不删除已冻结 fact set，不把 v2 rows 改写成 legacy。 |
| C | 停止为新 Session 选择 v2，保留已创建 Binding 到 retention | 不恢复 Candidate 自报 learner 覆盖已存在 Binding。 |
| D | 停止新 v2 Inbox 接收；已 accepted Candidate 保持原 Receipt/处理状态 | 不把 accepted 重新投递到 legacy Route。 |
| E | 关闭新 Worker cohort，保留 pending/retry/dead-letter/discarded 状态 | 不把 unknown 当作未发生，不重放 discarded。 |
| F | 暂停新 lifecycle jobs，继续恢复已有 deleting jobs | 不撤销已完成的隐私删除或恢复已删正文。 |
| G | 关闭 validate-only shadow，无用户影响 | 不将 shadow Inbox 改成生产 Inbox。 |
| H | 只对新 Session 恢复 legacy 创建 | canonical v2 Session 必须继续 v2、受控完成或显式终止，不能双投递。 |
| I | 仅在旧代码/表尚在且回滚演练通过时部署完整旧版本 | 不临时拼接新 Binding 与旧 learnerKey Candidate。 |

已经被 DeepTutor accepted 的 Candidate 是外部已发生事实，不能靠本地数据库回滚抹去；需要修正时走显式补偿、删除或重算流程。

## 11. 退役条件

旧课后路径只有同时满足以下条件才可退役：

- 课中可信 fact chain 已切换并稳定。
- F31 canonicalizer 两端生产实现通过共用 fixtures。
- 新 Session 全部创建持久 Lesson Binding。
- Candidate v2/strict Receipt/Inbox 经重启与并发验证。
- legacy Session 与 Outbox 无活跃记录，保留窗口结束。
- F27 8 项 findings 全部有回归证据。
- lifecycle coordinator 完成数据库、Secret 和 DeepTutor 下游删除演练。
- rollback 不需要混合新旧 Candidate/Receipt schema。
- 两个 Fork 完成测试、构建、独立审查、提交、推送和发布证据。

## 12. Finding 到阶段追踪

| F27 finding | 主要阶段 | 完成证据 |
| --- | --- | --- |
| H1 closeout 后事实漏出 | A | Session lock、event-after-closeout、并发 closeout 事务测试。 |
| H2 Worker 依赖短期 delegation | C | 持久 Binding、过期/重启/撤销测试。 |
| H3 transient 首次 dead-letter | E | typed error/cause chain/Secret/fetch 失败注入。 |
| H4 non-mapped 越界 | B | strict Map 与 mapped-only projector 负向矩阵。 |
| H5 lifecycle 不闭合 | F | 跨两端/Secret 删除、purge、故障恢复。 |
| M1 Inbox 幂等不足 | D | persistent key/hash/receipt、重启/冲突测试。 |
| M2 Receipt 不关联 Candidate | D | strict parser 与 candidate/key/hash/schema/time mismatch 测试。 |
| M3 discard 可 replay | E | discarded 终态、payload 处置与 replay 拒绝测试。 |

## 13. Feature 切分建议

至少拆为：

1. OpenMAIC atomic closeout/Frozen Fact Set migration。
2. Cross-Fork fact/candidate canonicalizer 与 mapped-only projector。
3. DeepTutor Lesson Binding 与 OpenMAIC learnerKey 退场兼容。
4. DeepTutor persistent Candidate Inbox/strict Receipt。
5. OpenMAIC Outbox error/status/Receipt 升级。
6. Cross-system lifecycle coordinator。
7. validate-only shadow 与受控验收。
8. canonical v2 正式单轨切换。
9. legacy 课后路径退役。

Mastery/Memory Projector 与画像 Agent 应在可靠 Inbox/Facts 之后另建 Feature，不能塞进 Candidate 接收迁移。

## 14. 迁移台账

截至 2026-07-31：

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| A：Atomic closeout | `not_started` | 当前 Session completedAt 仍在 closeout 事务外 CAS。 |
| B：Mapped-only + Hash | `not_started` | 当前无 factSetDigest/canonicalPayloadHash。 |
| C：Lesson Binding | `not_started` | F30 已选方案，但数据库与 Route 未实现。 |
| D：Persistent Inbox | `not_started` | DeepTutor 仍使用进程内 `_accepted`。 |
| E：Outbox 状态修复 | `not_started` | transient cause chain 与 discarded 尚未实现。 |
| F：Lifecycle | `not_started` | 当前只有分散 Session/Outbox purge。 |
| G：Shadow v2 | `not_started` | 尚无 validate-only comparator。 |
| H：正式切换 | `not_started` | 受可信课中事实、Binding、Inbox 门禁阻塞。 |
| I：旧路径退役 | `not_started` | legacy Candidate/Receipt/learnerKey 仍需保留。 |

F32 `passing` 只表示路线设计与审核完成；实现阶段必须由后续 Feature 更新台账。

## 15. 迁移完成总体判据

- closeout 在一个事务中关闭 event intake、冻结 fact set、写 completed、Candidate 和 Outbox。
- factSetDigest/canonicalPayloadHash 跨 TypeScript/Python 一致。
- 只有 mapped、完整 authoritativeRef 且 provenance 有效的事实进入 Candidate。
- Candidate 不带 learner；DeepTutor 通过持久 Lesson Binding 恢复 user scope。
- Inbox、Receipt 和 processing outcome 持久、幂等、可重启恢复。
- transient/permanent/retry/dead-letter/discarded 与 unknown outcome 语义真实。
- accepted 不等于 Mastery/L3 updated；各下游 revision 独立报告。
- learner/lesson 删除覆盖两端事实、队列、Secret 和派生画像。
- legacy 链路无正式流量并按证据退役。
