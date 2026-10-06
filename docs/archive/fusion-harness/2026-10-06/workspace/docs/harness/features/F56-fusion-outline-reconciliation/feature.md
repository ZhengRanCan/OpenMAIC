# F56 — Fusion outline reconciliation

## 状态

- `passing`
- version: `v0.1`

## 目的

在不削弱正式 Fusion 服务端权威边界的前提下，解决服务端 canonical outline 与浏览器已经生成的 effective content 类型不一致的问题。

当前已确认的冲突链条不是从原始 SSE 缺少字段开始，而是发生在后续状态边界：

```text
scene-outlines-stream:
  scene_5 = interactive
  widgetType/widgetOutline = present
  teachingObjective/estimatedDuration = present

后续 done.outlines / session / browser 某个状态:
  scene_5 = interactive
  widgetType/widgetOutline = missing
  其他合法扩展字段可能丢失

browser scene-content:
  根据不完整 interactive outline 判断配置缺失
  fallback → effective outline = slide
  content = slide-shaped

scene-actions request:
  browser outline = slide
  content = slide-shaped

formal Fusion server canonical:
  scene_5 = interactive

scene-actions effective outline:
  server canonical interactive

buildCompleteScene:
  interactive + slide-shaped content
  => null
```

F56 的目标是先建立安全、可观察、可验证的 reconciliation 策略。字段丢失本身另由后续 feature F57 处理；F56 不假设字段丢失已经修复，而是让字段丢失导致的 server/browser 类型分歧能够被安全协调或明确拒绝。

## 用户路径

1. 用户创建新的正式 Fusion session。
2. 原始 outline stream 可能包含完整 interactive 配置。
3. 在 done/session/store 的后续边界，部分合法扩展字段可能丢失，形成不完整的 browser outline。
4. scene-content 根据不完整 outline 触发 fallback，生成 slide-shaped content 和 browser effective outline。
5. scene-actions 在正式 Fusion 模式下重新读取服务端 canonical outline。
6. 系统比较 server canonical outline、browser/request outline、fallback evidence 和 content shape。
7. 系统生成一个明确、可审计的 effective outline，保留 server-owned Fusion metadata，并保证 outline 与 content 类型兼容；无法安全对齐时 fail closed。

## 核心验收标准

### AC1 — Fusion metadata 保持服务端权威

以下字段只能来自服务端正式 Fusion outline/context，不得由浏览器覆盖：

- `fusionCheckpoint`；
- `checkpointId`；
- `mappingId`；
- `mappingRevision`；
- `lessonKnowledgePointIds`；
- `remediationStrategy`；
- 其他正式 Fusion binding / frozen-context metadata。

### AC2 — content-compatible effective outline

当浏览器已经明确生成了 slide-shaped content，且存在可验证的安全 fallback 证据时，服务端可以将 server canonical outline 的生成类型安全降级为 `slide`，同时保留全部 server-owned Fusion metadata。

当 content 是 interactive-shaped 时，必须使用 interactive-compatible outline；不得把 interactive outline 强行与 slide content 组装。

### AC3 — canonical allOutlines 对齐

scene-actions 的：

- effective current outline；
- `allOutlines` 中相同 scene ID 的 outline；
- actions generation context；
- `buildCompleteScene()` 输入；

必须使用同一个 reconciled outline。

### AC4 — 不信任浏览器 metadata

浏览器可以提供 type/fallback 结果作为协调证据，但不能覆盖服务端 Fusion metadata，也不能新增、修改或删除 checkpoint binding。

### AC5 — 可观察 reconciliation

日志和错误响应至少包含：

- scene ID；
- browser/request outline type；
- server canonical outline type；
- effective outline type；
- content shape/type；
- reconciliation reason；
- model/provider error category（如适用）。

不得记录 token、cookie、完整 learner profile、原始 DeepTutor 数据或模型思维内容。

### AC6 — 安全失败

当没有足够证据证明 fallback 合法时，不得静默强制转换类型。系统必须返回可定位的类型冲突错误，例如：

```text
OUTLINE_CONTENT_TYPE_MISMATCH
```

并明确指出 server canonical type、browser type 和 content shape。

### AC7 — F54 场景不被破坏

checkpoint/remediation scene 的 Fusion metadata 必须保持不变；普通 scene 的类型协调不得修改 checkpoint binding 或 Scene Catalog identity。

## 明确不在范围

- 修复 outline stream → done/session 的字段丢失；
- 重建或替换 DeepSeek；
- 通用模型质量平台；
- F54 checkpoint/remediation 设计；
- 课中答题、remediation directive 或课后 writeback；
- 允许浏览器覆盖 Fusion server-owned metadata。

字段丢失问题单独记录为 F57，依赖 F56 提供可观察的安全对齐结果。

## 允许修改

- `OpenMAIC/app/api/generate/scene-actions/route.ts`；
- `OpenMAIC/app/api/generate/scene-content/route.ts`（仅为传递必要 reconciliation evidence）；
- `OpenMAIC/lib/generation/scene-builder.ts`；
- `OpenMAIC/lib/generation/outline-generator.ts` 或新增受控 reconciliation helper；
- `OpenMAIC/lib/hooks/use-scene-generator.ts`、`OpenMAIC/app/generation-preview/page.tsx`（仅用于传递并同步 effective outline/fallback evidence，不能改变 Fusion metadata）；
- 相关 OpenMAIC 类型、测试、日志和 feature evidence；
- 本 feature 合同、索引和 `docs/progress.md`。

## 验证要求

### 自动测试

至少覆盖：

- server interactive + browser slide + slide-shaped content → safe slide effective outline；
- Fusion metadata 完整保留；
- reconciled current outline 与 `allOutlines` 同步；
- server interactive + slide-shaped content 但没有 fallback 证据 → fail closed；
- interactive-shaped content 不被降级为 slide；
- checkpoint/remediation metadata 不变；
- ordinary non-Fusion generation 不回归；
- 日志和错误包含最小 reconciliation diagnostics。

### 人工测试

使用新的 Fusion session：

```text
Linear functions and graphs
```

观察同一个 `scene_5`：

1. scene-outlines-stream 原始 outline；
2. scene-content request/response；
3. scene-actions request；
4. scene-actions 服务端 effective outline；
5. `allOutlines[scene_5]`；
6. 最终 scene type；
7. checkpoint/remediation metadata 是否保持不变。

人工验证目标不是证明字段丢失已修复，而是证明字段丢失或 fallback 存在时，Fusion 安全对齐策略正确、可观测、不会静默破坏 metadata。

## 依赖与关系

- F55 已完成浏览器本地 fallback state consistency，但不处理 Fusion server canonical 与 browser content 的跨信任边界协调。
- F56 不修复原始 stream → done/session 的字段丢失；它必须在该缺陷仍存在时证明 reconciliation 安全有效。
- F56 完成后，继续 F57 修复 outline stream → done/session 的字段丢失。
- F54 在 F56/F57 完成并有新 session 的 scene materialization/export 证据前保持 blocked。
