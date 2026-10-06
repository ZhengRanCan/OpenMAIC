---
id: F29
title: 课堂中与课堂后 Fusion 语义交换设计
version: v0.1
status: passing
dependsOn: ["F28"]
scope: {"code":[],"tests":[],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F29-in-post-class-semantic-exchange-design/**","docs/harness/FUSION/**","docs/log/artifacts/F29/**"]}
evidence: {"lastVerifiedAt":"2026-07-31","commands":[{"command":"read-only review of F26/F27 reports and current OpenMAIC/DeepTutor event, diagnosis, runtime, closeout, Candidate, Outbox and Receipt paths","result":"passed","summary":"F26 3 High + 4 Medium and F27 5 High + 3 Medium were mapped to explicit protocol rules without changing either Fork."},{"command":"PowerShell finding-count and Markdown fence consistency checks","result":"passed","summary":"The trace matrix covers exactly 7 F26 and 8 F27 findings; all four Fusion protocol documents have balanced code fences."},{"command":"node scripts/harness-gate.mjs","result":"passed","summary":"29 Feature contracts, Registry/progress state and architecture split consistency passed with 0 errors."}],"manualSmoke":"Not run: F29 is a documentation-only protocol design based on read-only F26/F27 evidence."}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["维护者能够从 F26/F27 findings 追溯到课堂中和课堂后的语义对象、所有权、状态转换、安全不变量及后续实现切片。"],"integrationEvidence":["docs/harness/FUSION/04-in-class-semantic-exchange-protocol.md","docs/harness/FUSION/06-post-class-semantic-exchange-protocol.md","docs/log/artifacts/F29/finding-to-protocol-matrix.md","docs/log/artifacts/F29/verification-summary.md"],"knownUnverified":[],"humanReviewRequired":[]}
---

# F29 课堂中与课堂后 Fusion 语义交换设计

## 目标

基于 F26 与 F27 的只读审查证据，设计 OpenMAIC 与 DeepTutor 在课堂中和课堂后的纯语义信息交换逻辑，并保持 Fusion Adapter 作为唯一中介和防腐层。

F29 要解决：

1. 浏览器提交如何先成为可信、幂等的 OpenMAIC checkpoint 事实，再进入 DeepTutor 诊断。
2. DeepTutor 如何只返回独立 `LearningDiagnosis + TeachingIntent`，而不操纵 OpenMAIC Scene/UI。
3. OpenMAIC 如何区分计划中的 Directive 和课堂执行层实际完成的 Directive。
4. 课堂完成时如何原子冻结事实集合并形成最小 `ProfileUpdateCandidate`。
5. DeepTutor 如何持久幂等地接收 Candidate，并返回可严格关联的 `ProfileUpdateReceipt`。
6. 如何确保 accepted/queued/duplicate 只表示接收状态，不表示长期画像已更新。

## 设计产物

- `docs/harness/FUSION/04-in-class-semantic-exchange-protocol.md`
- `docs/harness/FUSION/06-post-class-semantic-exchange-protocol.md`
- `docs/log/artifacts/F29/finding-to-protocol-matrix.md`

## 核心边界

- DeepTutor 拥有学习诊断、教学意图和长期画像聚合语义。
- OpenMAIC 拥有 checkpoint、题目版本、课堂事实、Scene Catalog、RuntimeState、Directive 规划和实际执行事实。
- Fusion Adapter 校验跨域契约、身份、lesson、semantic digest、mapping revision、幂等和最小化。
- 浏览器只提交答案和 opaque attempt/execution 标识，不提供权威 checkpoint、mapping、correctness、RuntimeState 或 learner。
- 课堂中跨系统只传 `ClassroomEvent` 与 `LearningDiagnosis + TeachingIntent`；`SceneDirective` 和执行回执属于 OpenMAIC 内部课堂域。
- 课堂后跨系统只传 `ProfileUpdateCandidate` 与 `ProfileUpdateReceipt`；Candidate 是观察证据，不是长期画像写入命令。

## F26 设计结论

- 正式 checkpoint 必须由 OpenMAIC 服务端创建 attempt，绑定 checkpoint、题目版本、Map 和 Frozen Lesson Context。
- 浏览器本地评分只能是带来源的 advisory input，DeepTutor 必须独立诊断或返回证据不足。
- ClassroomEvent 必须先以稳定 event/idempotency ID 持久化；诊断失败也要形成 durable degradation fact。
- TeachingIntent 保持协议无关，OpenMAIC Planner 才能将它映射为 SceneDirective。
- Directive 必须经历 `planned -> executed/failed/expired`；CAS 计划不等于播放器执行。
- 实际执行后由 OpenMAIC execution receipt 推进 RuntimeState 和 Observation Fact。

## F27 设计结论

- closeout 必须在同一权威事务内锁定 Session、拒绝后续事件、冻结 fact set、写 completed、创建 Candidate 并入 Outbox。
- Candidate 只允许 `mappingStatus=mapped` 且具有完整 authoritative ref 的观察进入长期聚合边界。
- Worker 使用独立服务身份和持久化 lesson/learner 授权，不依赖短期课堂 delegation 是否仍在内存或未过期。
- idempotency key 必须绑定 candidate ID、canonical payload hash 和原 Receipt；同 key 不同 payload 必须 rejected。
- Receipt 必须携带 schema、candidateId、payload hash、status 和 receivedAt；OpenMAIC 严格比对后才能标记 delivered。
- transient、dead-letter、replay 和不可重放 discarded 必须具有真实、互斥的状态语义。
- Session、facts、completion、Outbox、Receipt 和 Secret 必须进入统一删除/保留编排。

## 后续实现切片

F29 不实施代码。建议后续至少拆分为：

1. OpenMAIC server-owned checkpoint attempt 与稳定幂等事件。
2. DeepTutor 独立诊断 Provider 与严格 `LearningDiagnosis/TeachingIntent` 契约。
3. OpenMAIC planned Directive、客户端/执行层 receipt 与权威 RuntimeState 提交。
4. OpenMAIC 原子 closeout 与 eligible Candidate projector。
5. DeepTutor 持久 Candidate inbox、服务身份授权和严格 Receipt。
6. Outbox transient 分类、discarded 状态与跨存储生命周期编排。

每个实现 Feature 必须单独定义 Fork 文件范围、负向测试、构建、人工路径、独立审查和 Git 证据。

## 明确排除

- 不修改 OpenMAIC 或 DeepTutor 代码、测试、运行配置或数据库。
- 不运行服务、模型、Worker、浏览器、容器或真实课堂。
- 不合并 `ARCHITECTURE.md`；阶段规范继续独立归档。
- 不定稿 DeepTutor 诊断 Agent 的 prompt、模型、工具和 mastery 算法。
- 不定义长期画像聚合算法；Receipt 仍只证明 Candidate 接收状态。

## 验收标准

- [x] F26 的 3 High、4 Medium 均映射到明确协议规则或状态转换。
- [x] F27 的 5 High、3 Medium 均映射到明确协议规则或生命周期约束。
- [x] 课堂中只交换可信 ClassroomEvent 与协议无关 Diagnosis/TeachingIntent。
- [x] planned Directive 与实际执行事实明确分离，诊断失败仍保留 durable event/degradation。
- [x] 课堂后 Candidate 保持最小、mapped-only、非长期结论语义。
- [x] 服务身份、幂等、Receipt 关联、重试/丢弃和数据生命周期形成闭环设计。
- [x] 后续代码工作可拆成独立、可验证的实现 Feature。
- [x] Harness gate 通过，且未修改两个 Fork 或把设计描述成已实现事实。
