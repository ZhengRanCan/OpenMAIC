---
id: F28
title: Fusion 信息交换层改造说明
version: v0.2
status: passing
dependsOn: ["F25","F26","F27"]
scope: {"code":[],"tests":[],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F28-fusion-information-exchange-upgrade-plan/**","docs/harness/FUSION/**","docs/log/artifacts/F28/**"]}
evidence: {"lastVerifiedAt":"2026-07-30","commands":[{"command":"rg/read-only trace of current OpenMAIC and DeepTutor pre-class Fusion routes, providers, stores and F25-F27 reports","result":"passed","summary":"Every reuse, extension, replacement and retirement category is grounded in an existing component or an approved standalone Fusion specification."},{"command":"node scripts/harness-gate.mjs","result":"passed","summary":"Feature Registry, progress state, contract structure and architecture split consistency passed."}],"manualSmoke":"Not run: F28 is a documentation and migration-planning Feature; it does not modify or execute either application."}
completionGate: {"version":"v0.2","l3":"not_required","userPath":["维护者能够直接从 docs/harness/FUSION/ 找到当前 Fusion 代码基线、目标语义握手、可复用基础设施、必须替换的语义组件、迁移台账以及后续实施顺序。"],"integrationEvidence":["docs/harness/FUSION/01-fusion-document-routing-and-reading-index.md","docs/harness/FUSION/02-pre-class-semantic-exchange-protocol.md","docs/harness/FUSION/03-pre-class-fusion-code-migration-roadmap.md","docs/harness/features/F28-fusion-information-exchange-upgrade-plan/feature.md","docs/log/artifacts/F28/verification-summary.md"],"knownUnverified":[],"humanReviewRequired":[]}
---

# F28 Fusion 信息交换层改造说明

## 目标

在不修改 OpenMAIC 或 DeepTutor 业务代码的前提下，说明 Fusion 信息交换层从当前实现迁移到已归档课前语义协议时需要发生的改动，并为后续实现 Feature 提供可执行的拆分边界。

本 Feature 回答四个问题：

1. 当前课前信息如何经过 Launch、Provider、Session 和生成 Route 流动。
2. 哪些基础设施可以原样复用，哪些组件需要扩展，哪些固定 Mock 语义需要退出正式路径。
3. 如何通过新增契约和双轨切换实现渐进迁移，而不是推倒重写。
4. 后续 OpenMAIC、DeepTutor 和跨 Fork 集成工作应如何拆成独立实现 Feature。

## 产品与架构依据

- 产品要求 DeepTutor 的长期学习上下文与 OpenMAIC 的课堂生成能力通过版本化、最小化投影连接，两个 Fork 保持独立部署与 Git 历史。
- Fusion Adapter 是 OpenMAIC 与 DeepTutor 之间唯一允许的中介和防腐层；浏览器不得直连 DeepTutor，也不得持有 delegation credential。
- DeepTutor 拥有 learner、长期画像和权威知识语义；OpenMAIC 拥有课堂生成、Scene Catalog、运行态和 UI。
- 跨域对象必须显式版本化、可追踪、最小化；生产不得因真实 Provider 失败而回退到 Mock。
- 当前 `ARCHITECTURE.md` 仍是全局 SSOT；`docs/harness/FUSION/` 中的独立规范在课堂中和课堂后协议讨论完成前不并入主架构。

## 当前实现基线

当前正式课前链路为：

```text
Launch Code
  -> DeepTutor launch/exchange
  -> scoped delegation + verified learner
  -> OpenMAIC 并行 GET Profile / Knowledge Map
  -> FusionSessionRecord 保存快照、固定 Catalog 与 RuntimeState
  -> 首次 outline 接收浏览器 requirement
  -> OpenMAIC 本地拼接 FrozenTeachingContext
  -> 服务器大纲、content 和 actions
```

已确认的主要语义问题：

- DeepTutor 的 Profile/Knowledge Map 请求只携带 `lessonSessionId`，不知道课堂 topic、objectives 或 requested refs。
- DeepTutor 当前按合成 learner 查固定 `_PROFILES`，并返回固定 `lesson-linear-function-slope` 映射。
- OpenMAIC 后续才把任意 requirement 与已保存的固定 Map、固定 Scene Catalog 拼接。
- Profile/Map Provider 只检查通用 JSON object，没有执行严格的 schema、字段白名单和敏感字段拒绝。
- 当前 guidance 由 OpenMAIC `teaching-context.ts` 根据少量状态硬编码，不是 DeepTutor Agent 的课前教学决策产物。
- requirement、材料语义与 Profile/Map 没有共同的 semantic request ID、revision 或 digest。

F28 不回写或关闭 F25 的发现；它只把这些发现转换为后续改造边界。

## 目标状态

目标课前信息流为：

```text
LessonGenerationIntent
  -> Fusion Adapter 规范化与授权
  -> LessonSemanticRequest
  -> DeepTutor Agent 教学上下文化
  -> PreClassTeachingContextProposal
  -> Fusion Adapter 语义对齐与冲突处理
  -> FrozenLessonGenerationContext
  -> OpenMAIC 课堂生成
```

目标状态必须遵循：

- Profile、Knowledge Map 和 Teaching Guidance 共享同一个 semantic request revision 与 digest。
- Learner Cognitive Projection 只能包含当前 LessonKnowledgeMap 范围内的认知状态。
- Teaching Guidance 只表达教学目标、策略与约束，不包含 sceneId、route、组件或 UI 命令。
- Topic、objectives、材料引用或知识引用的实质变化创建新 request revision，不能原地覆盖旧快照。
- `needs_clarification`、`partial`、`unresolved` 和 `rejected` 必须显式处理，不能用固定 slope fixture 补齐。

## 改造范围总览

| 层次 | 现有组件 | F28 结论 | 后续改造方向 |
| --- | --- | --- | --- |
| Launch | DeepTutor `launch-codes`、`launch/exchange` | 复用 | 保持身份交换只负责 learner、audience、scope、lesson 和 TTL，不承载完整课堂语义。 |
| Delegation | OpenMAIC/DeepTutor token 校验与 credentialRef | 复用并扩 scope | 新课前语义操作使用最小新 scope 或经定稿的兼容 scope；浏览器仍不得接触 token。 |
| Transport | OpenMAIC `real-profile-provider.ts` | 替换其课前语义职责 | 新增面向 `LessonSemanticRequest` 的 Provider；旧 GET Provider 暂时保留兼容。 |
| DeepTutor Route | `GET /profile`、`GET /knowledge-map` | 渐进淘汰 | 新增单一课前语义上下文 Route，返回同 request 下的 Proposal；旧 Route 只用于兼容或受控测试。 |
| DeepTutor 计算 | `fusion_profile.py` 固定 `_PROFILES` | 替换 | 先用 Fixture 适配新 Proposal 契约，再在独立 Feature 中接入 Agent、Knowledge Authority、Mastery 和 Memory Projection。 |
| 契约校验 | OpenMAIC 通用 JSON object 检查 | 替换 | 为 request、proposal、map、profile projection、guidance 和 resolution 建立严格 parser、白名单与大小限制。 |
| Session | `FusionSessionRecord`、PostgreSQL、Cookie、CAS | 复用并扩展 | 增加 semantic request、proposal/frozen context、digest 和 source revisions；身份与 credentialRef 保持不可变。 |
| 冻结逻辑 | `generation-session.ts` 一次性 CAS 冻结 | 复用并更换输入 | 从“本地 requirement + 旧快照”改为“经 Adapter 验证的 Proposal”；继续保持单课次不可变和二次生成拒绝。 |
| Teaching Context | `FrozenTeachingContext` | 版本化升级 | 新增 `FrozenLessonGenerationContext`，旧 `f23-v1` 在双轨期保持可读，不原地改变旧 schema 语义。 |
| Guidance | OpenMAIC 硬编码 guidance | 替换来源 | DeepTutor 返回协议化 Teaching Guidance；Adapter 校验，OpenMAIC 只负责消费和编译。 |
| Catalog | 固定 slope `DEVELOPMENT_SCENE_CATALOG` | 退出正式语义来源 | OpenMAIC 仍拥有 Catalog，但它必须从冻结语义上下文编译或校验，不得绑定无关默认知识点。 |
| Generation Route | 首次 outline 才接收 requirement | 作为新握手切入点复用 | 在生成 outline 前构造 LessonGenerationIntent、调用 Adapter、完成语义冻结，再进入现有生成器。 |
| Reliability | Secret Manager、Circuit Breaker、PostgreSQL、CAS | 复用 | 新 Provider 纳入相同超时、重试、错误归一化和生产失败关闭规则。 |
| Observability | request/session/revision 日志骨架 | 扩展 | 增加 semantic request ID、digest、resolution status 和 parser/policy version；不记录敏感正文或思维过程。 |

## OpenMAIC 需要修改的内容

后续 OpenMAIC 实现 Feature 至少需要覆盖：

1. 新增课前语义领域对象及严格 parser。
2. 新增 `PreClassContextProvider`，通过 Fusion Adapter 调用 DeepTutor 新 Route。
3. 将浏览器 requirement、受控材料引用和生成约束规范化为 `LessonGenerationIntent`；不得接受浏览器 learner 覆盖。
4. 在首次正式 outline 前发起语义握手，并在成功后 CAS 冻结 `FrozenLessonGenerationContext`。
5. 扩展 `FusionSessionRecord` 保存 request/proposal/digest/source revisions，同时保持旧 Session schema 的显式兼容策略。
6. 让 outline/content/actions 只读取新冻结上下文，不再分别接受能覆盖语义的浏览器字段。
7. 让 Scene Catalog 与 checkpoint 从当前 Map 和 Guidance 编译或校验，移除正式路径对固定 slope Catalog 的依赖。
8. 保留 Launch、Cookie、credentialRef、PostgreSQL、CAS、Secret Manager、熔断和生产失败关闭。

## DeepTutor 需要修改的内容

后续 DeepTutor 实现 Feature 至少需要覆盖：

1. 新增版本化课前语义请求与 Proposal response model。
2. 新增受 delegation 保护的课前上下文 Route，并校验 lesson、audience、scope、expiry 和请求大小。
3. 从 delegation 推导 learner，不接受 payload 中的 learner 覆盖。
4. 回显 semantic request ID、revision 和 digest；所有 Map/Profile/Guidance 组成部分共享该语义根。
5. 第一阶段允许用现有 Fixture 适配新契约，但必须显式标记 synthetic/development 状态，不能伪装成动态 Agent 结果。
6. 后续独立 Feature 再接入 Knowledge Authority、Mastery Evidence、Memory Projection 和受限 Teaching Decision Agent。
7. 将当前进程内 Launch/delegation 状态迁移到共享 TTL 存储属于生产可靠性改造，不与语义契约首个切片强绑定，但必须在生产开放前完成。

## 渐进迁移策略

### 阶段 A：契约先行

- 固化课前 request/proposal/parser 和 digest 规则。
- 用现有合成 Fixture 生成符合新 schema 的 Proposal。
- 不切换正式课堂读取路径。

### 阶段 B：新增 Route 与 Provider

- DeepTutor 新增课前上下文 Route。
- OpenMAIC 新增对应 Provider。
- 保留旧 `GET /profile` 与 `GET /knowledge-map`，进行 shadow 调用或测试对照。

### 阶段 C：Session 双写

- 在首次 outline 前请求新 Proposal。
- Session 同时保存旧快照与新冻结上下文。
- 记录 digest、resolution 和 source revisions，但正式生成仍可由受控开关选择旧路径。

### 阶段 D：正式读取切换

- outline/content/actions 改为只消费 `FrozenLessonGenerationContext`。
- 主题错配、未知 schema、Map/Profile/Guidance 越界和过期 revision 全部失败关闭。
- 普通课堂与 F02 Demo 保持独立，不作为真实 Fusion 的错误回退。

### 阶段 E：移除旧语义来源

- 停止正式路径调用旧 Profile/Map GET。
- 移除固定 slope Provider 和正式路径固定 Catalog。
- 旧 Route 经过明确弃用期后再删除；历史 Session 继续按旧 schema 只读恢复或显式失效。

## 兼容与回滚原则

- 新契约使用新 schema version 或新 Session 字段，不原地改变 `f23-v1` 的含义。
- 新旧 Provider 在双轨期明确区分，不能把旧响应误解析为新 Proposal。
- 切换开关必须是服务端配置；生产不得因新 Provider 失败而自动回退 Mock 或固定 slope。
- 回滚只能回到明确允许的旧正式版本，不能把已使用新 digest 生成的 Session 与旧 Profile/Map 混合。
- 普通 OpenMAIC 课堂和 F02 Demo 的现有行为保持不变。

## 后续实现 Feature 建议

F28 完成后，实际代码工作至少拆成以下独立切片：

1. **Fusion 课前语义契约与严格解析器**：跨 Fork schema、digest、错误枚举和契约测试。
2. **DeepTutor Pre-Class Context Route**：先以合成 Fixture 适配新 Proposal，验证身份和 Transport。
3. **OpenMAIC Provider、Session 双写与 shadow 验证**：不立即切换用户路径。
4. **OpenMAIC 正式课堂读取切换**：生成、材料引用、Catalog 和失败状态统一使用冻结上下文。
5. **DeepTutor Agent/Knowledge/Mastery 生产计算链路**：用真实内部领域服务替换 Fixture。
6. **旧 Route 与固定 slope 退役**：完成兼容窗口、迁移和负向回归后删除。

每个修改 Fork 代码的 Feature 必须分别列出文件范围、测试、构建、独立审查、提交和推送证据；不得让 F28 的文档范围代替实现验证。

## 明确排除

- 不修改 OpenMAIC 或 DeepTutor 代码、测试、依赖、数据库或运行配置。
- 不设计课堂中的 TeachingIntent/SceneDirective 新协议。
- 不设计课堂后的 Candidate/Receipt 新协议。
- 不定稿 DeepTutor Agent 的内部 prompt、工具列表、知识映射算法或 mastery 算法。
- 不合并或修改 `docs/harness/ARCHITECTURE.md` 及其分片。
- 不使用真实 learner、真实课堂、生产 Secret、外部模型或数据库。

## 验收标准

- [x] 当前课前 Route、Provider、Session、生成消费者和固定语义来源均有明确基线描述。
- [x] 每个目标协议对象都能追溯到需要新增、扩展或替换的现有组件。
- [x] 复用、扩展、替换和退役边界明确，结论不表述为底层完全重写。
- [x] 迁移策略包含契约先行、双轨/双写、读取切换、失败关闭和旧路径退役。
- [x] OpenMAIC 与 DeepTutor 的后续改动能够拆成独立、可验证的实现 Feature。
- [x] 课中、课后、UI、真实数据和 Agent 内部算法未越过本 Feature 范围。
- [x] `node scripts/harness-gate.mjs` 通过，且未修改两个 Fork 或伪造 Git 证据。

## 预期完成证据

- 本合同中的当前态、目标态、改造矩阵和迁移切片。
- `docs/harness/FUSION/` 中通用规范、课前协议与课堂前代码迁移路线的交叉一致性检查。
- F25–F27 审查发现与 F28 范围的只读追踪摘要。
- Harness Gate 结果；不需要应用测试、构建、服务或人工课堂烟测。
