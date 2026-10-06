# F58 — Pre-class Fusion checkpoint materialization recovery

## 状态

- `blocked`
- version: `v0.1`
- relatedTo: `F54`
- dependsOn: `F56`, `F57`

## Harness registry metadata

```yaml
scope:
  repository: OpenMAIC
  branch: fusion-adapter
  paths:
    - app/api/generate/scene-outlines-stream/route.ts
    - app/api/generate/scene-content/route.ts
    - app/api/generate/scene-actions/route.ts
    - app/generation-preview/page.tsx
    - lib/hooks/use-scene-generator.ts
    - lib/fusion/generation-session.ts
    - lib/fusion/scene-catalog.ts
    - lib/generation/scene-builder.ts
    - lib/export/use-export-classroom.ts
    - app/classroom/[id]/page.tsx
    - tests

evidence:
  directory: classroom/review/F58
  required:
    - focused automated tests
    - fresh formal Fusion manual capture
    - export manifest audit
    - first-failure boundary report

completionGate:
  knownUnverified: true
  humanReviewRequired: true
  gitEvidence:
    repositories:
      - path: OpenMAIC
        branch: fusion-adapter
        commit: pending
```

## 目的

## Harness registry metadata

```yaml
scope:
  repository: OpenMAIC
  branch: fusion-adapter
  paths:
    - app/api/generate/scene-outlines-stream/route.ts
    - app/api/generate/scene-content/route.ts
    - app/api/generate/scene-actions/route.ts
    - app/generation-preview/page.tsx
    - lib/hooks/use-scene-generator.ts
    - lib/fusion/generation-session.ts
    - lib/fusion/scene-catalog.ts
    - lib/generation/scene-builder.ts
    - lib/export/use-export-classroom.ts
    - app/classroom/[id]/page.tsx
    - tests

evidence:
  directory: classroom/review/F58
  required:
    - focused automated tests
    - fresh formal Fusion manual capture
    - export manifest audit
    - first-failure boundary report

completionGate:
  knownUnverified: true
  humanReviewRequired: true
  gitEvidence:
    repositories:
      - path: OpenMAIC
        branch: fusion-adapter
        commit: pending
```

重新梳理并修复正式课前 Fusion 中 checkpoint/remediation 从服务端冻结上下文到最终课堂导出物的完整生命周期。

F54 已确认新的 `Linear Functions and Graphs.maic` 导出物缺少正式 Fusion checkpoint/remediation pair。F56 已解决 server/browser outline 类型分歧的安全协调，F57 已修复 outline 字段在 session persistence/recovery 中的丢失；但最终导出仍没有证明服务端追加的 formal pair 被完整物化。因此 F58 负责重新确认课前 Fusion 的领域边界、代码链路、物化契约和导出可追溯性，并修复首次丢失边界。

## 产品用户路径

1. 测试用户通过正式 Fusion Launch Code 创建新的 `lessonSessionId`。
2. OpenMAIC 服务端调用 DeepTutor pre-class context，并冻结 `FrozenLessonGenerationContext`。
3. OpenMAIC 服务端生成教学 outline，并由服务端追加唯一的 checkpoint 与 remediation scene。
4. 服务端通过 SSE 发送完整 outline 事件和 `done.outlines`。
5. 浏览器为每个 outline 请求 scene content/actions，并将完整 scene 写入课堂 store。
6. OpenMAIC session、Scene Catalog、runtime state 和浏览器课堂状态保持可追溯关联。
7. 用户导出 `.maic`，manifest 中包含 checkpoint/remediation scene 及最小可审计 Fusion binding。
8. 重新打开同一课堂或恢复同一 formal session 时，scene 数量、scene ID、role 和 metadata 不丢失。

## 领域和权威边界

### DeepTutor

- 提供已授权、版本化的 pre-class teaching context proposal；
- 提供知识映射、mapping revision 和 teaching guidance；
- 不生成 OpenMAIC scene ID、scene content、播放器命令或导出 manifest。

### OpenMAIC server

- 唯一负责冻结 formal context；
- 唯一负责创建 checkpoint/remediation scene identity、role 和 Fusion binding；
- 唯一负责 `generatedOutlines`、Scene Catalog、runtime 初始 checkpoint 和 materialization ledger 的权威持久化；
- 校验浏览器请求，不接受浏览器覆盖 checkpoint binding、mapping、revision 或 lesson scope。

### Browser

- 接收服务端 outline；
- 生成和展示普通课堂 content；
- 只能回传 content/materialization result 和最小诊断信息；
- 不能创建、删除、重命名或覆盖 formal checkpoint/remediation identity 和 metadata。

### Export

- 读取已经物化的 OpenMAIC classroom/session state；
- 不从浏览器输入重新推导 Fusion metadata；
- 不主动过滤 formal checkpoint/remediation scene；
- 对缺失或不一致的 formal pair fail closed 或输出明确错误，不静默生成普通 quiz 替代品。

## 目标数据流

```text
Launch / LessonBinding
  → resolveFormalFusion
  → FrozenLessonGenerationContext
  → server-owned FormalSceneMaterializationPlan
       ├─ checkpoint Scene Catalog entry
       └─ remediation Scene Catalog entry
  → generatedOutlines + sceneCatalog + runtimeState
  → SSE outline events + done.outlines
  → browser outline/session/store
  → scene-content / scene-actions
  → materialization ledger / classroom scenes
  → export manifest
```

## 核心验收标准

### AC1 — Formal plan is server-owned

当 `formalFusion.kind === resolved` 时，服务端必须为当前 formal session 创建唯一、可追溯的 checkpoint/remediation pair：

- checkpoint scene ID；
- remediation scene ID；
- checkpoint role；
- remediation role；
- `checkpointId`；
- `mappingId`；
- `mappingRevision`；
- `lessonKnowledgePointIds`；
- `remediationStrategy`；
- semantic request/context association。

浏览器或模型输出不得创建或覆盖这些字段。

### AC2 — One canonical pair across all boundaries

以下边界必须引用同一对 scene ID 和同一份 server-owned binding：

- `generatedOutlines`；
- `sceneCatalog`；
- SSE `outline` events；
- SSE `done.outlines`；
- browser session/store outlines；
- scene-content/actions requests；
- materialized classroom scenes；
- export manifest；
- session recovery。

不得出现标题相同但 identity 不同的普通 quiz 冒充 formal checkpoint。

### AC3 — Complete materialization

checkpoint 和 remediation 都必须进入 scene-content/actions 以及最终课堂 store：

```text
checkpoint → quiz outline → quiz-shaped content → classroom scene
remediation → slide outline → slide-shaped content → classroom scene
```

单个追加 scene 失败时，系统必须记录 scene ID、阶段和错误类别；不得静默丢弃 pair 或把 formal scene 替换成普通场景。

### AC4 — Persistence and recovery

formal session 必须持久化并恢复：

- complete `generatedOutlines`；
- Scene Catalog pair and roles；
- server-owned Fusion metadata；
- initial checkpoint runtime state；
- materialization status/diagnostics；
- scene IDs and scene count.

恢复后不得依赖浏览器自行重建 binding。

### AC5 — Export traceability

导出的 `.maic` manifest 至少必须包含：

- formal checkpoint scene；
- formal remediation scene；
- 可定位的 scene IDs/roles；
- 最小且不泄露敏感数据的 Fusion binding reference 或等价可审计关联。

导出不得包含 token、cookie、完整 learner profile、DeepTutor 原始响应、原始 prompt 或模型 trace。

### AC6 — Failure localization and fail-closed behavior

日志和错误必须区分以下边界：

- formal session missing/unresolved；
- server pair planning；
- session persistence/CAS；
- SSE transfer；
- browser outline/store；
- scene-content；
- scene-actions/build；
- classroom materialization；
- session recovery；
- export projection。

如果 pair 不完整、binding 不一致或 formal scene 无法物化，系统必须返回明确错误或 durable failed state，不能静默降级为普通 quiz/slide。

### AC7 — Non-Fusion compatibility

ordinary classroom、LAN Demo、历史课堂恢复和无 formal session 的生成路径：

- 不追加 checkpoint/remediation；
- 不要求 Fusion metadata；
- 不改变已有 content/export 行为；
- 不读取 DeepTutor 文件、数据库或浏览器跨应用状态。

### AC8 — Existing F56/F57 boundaries remain intact

- F56 reconciliation 继续保持 server-owned metadata 权威；
- F57 保留完整 outline 字段；
- browser 仍不能覆盖 Fusion binding；
- checkpoint/remediation 的修复不得重新引入 interactive→slide 静默不一致。

## 调查与实现范围

### 首要调查边界

1. `resolveFormalFusion` 是否在真实请求中返回 `resolved`；
2. `completeFormalLessonOutlines` 是否执行并返回 pair；
3. `persistFormalLessonOutlines` 是否成功写入 outlines/catalog/runtime；
4. SSE outline/done 是否包含同一 pair；
5. browser session/store 是否保留 pair；
6. scene-content/actions 是否为 pair 生成并保存 content；
7. classroom store 是否有 pair；
8. export 输入和 manifest 是否丢失 pair。

### 允许修改

- `OpenMAIC/app/api/generate/scene-outlines-stream/route.ts`；
- `OpenMAIC/app/api/generate/scene-content/route.ts`；
- `OpenMAIC/app/api/generate/scene-actions/route.ts`；
- `OpenMAIC/app/generation-preview/page.tsx`；
- `OpenMAIC/lib/hooks/use-scene-generator.ts`；
- `OpenMAIC/lib/fusion/generation-session.ts`；
- `OpenMAIC/lib/fusion/scene-catalog.ts`；
- `OpenMAIC/lib/generation/scene-builder.ts`；
- `OpenMAIC/lib/export/use-export-classroom.ts`；
- `OpenMAIC/app/classroom/[id]/page.tsx`；
- 相关类型、session/materialization store、API error code、测试、日志和 feature evidence；
- 本 feature 合同、verification、进度面板和审查证据。

扩大范围时，必须在 verification evidence 中记录原因、影响和验证方式。

## 明确不在范围

- 课中 checkpoint attempt、答题事件、动态 diagnosis 或 remediation directive；
- 课后 observation、Candidate、profile update 或 writeback；
- DeepTutor 内部 Book、Spine、Progress、Memory 或画像结构；
- 普通课堂教学质量全面重写；
- 用浏览器数据重建或覆盖 Fusion metadata；
- 保存完整 learner data、token、cookie、Launch Code 或模型内部 trace。

## 兼容、迁移与回滚

- 只对 `formalFusion.kind === resolved` 的新 session 创建 formal materialization plan；
- 已有 historical session 按原协议只读恢复，不伪造新的 checkpoint binding；
- pair 不完整时保持 F54 fail-closed，不静默降级为普通课堂；
- ordinary non-Fusion 路径不追加 formal pair；
- 若修复破坏 materialization/export，可回滚 F58 commit，但不得回退到浏览器拥有 Fusion metadata。

## 验证要求

### 静态验证

检查课前 Fusion 从 launch、context freeze、outline append、SSE、browser store、scene generation、session/catalog、classroom store 到 export 的完整调用链和所有权边界。

### 自动测试

至少覆盖：

- formal resolved 创建唯一 checkpoint/remediation pair；
- pair 的 ID、role、metadata 在 generatedOutlines/sceneCatalog/runtime 中一致；
- SSE outline events 与 done.outlines 一致；
- browser 不丢失或覆盖 pair；
- checkpoint/remediation 都进入 scene-content/actions 和 classroom store；
- persistence/recovery 保留 pair 与 metadata；
- export manifest 保留 pair；
- pair 缺失、不一致或 materialization 失败时 fail closed；
- ordinary generation、LAN Demo 和历史恢复不追加 pair；
- F56/F57 既有回归测试继续通过。

### 人工验证

使用全新正式 Fusion session：

```text
Linear functions and graphs
```

只保留最小脱敏证据：

1. formal resolution 状态；
2. checkpoint/remediation scene ID 和计数；
3. SSE outline/done 摘要；
4. scene-content/actions 状态码和 content shape；
5. classroom store scene ID/role；
6. session recovery 摘要；
7. export manifest 的 scene ID/role/metadata presence。

### 独立复核与 Git

通过前必须：

- 完成独立只读代码复核；
- `knownUnverified` 与 `humanReviewRequired` 为空；
- 运行 `node scripts/harness-gate.mjs`；
- OpenMAIC 提交并推送 `fusion-adapter`；
- 在 verification 中记录 commit SHA、测试命令、人工路径和证据位置。

## 依赖与关系

- F54：当前 formal checkpoint/remediation materialization 的失败验收来源；F58 完成后才能重新评估 F54；
- F56：提供 server/browser outline reconciliation 和 server-owned metadata 边界；
- F57：提供 outline 字段 preservation；
- F46/F47/F49/F53：formal Scene Catalog、材料边界和 pre-class shadow/context 前置能力。
