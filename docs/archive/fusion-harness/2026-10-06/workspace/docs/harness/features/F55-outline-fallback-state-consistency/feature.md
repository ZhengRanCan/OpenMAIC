# F55 — outline fallback state consistency

## 状态

- `passing`
- version: `v0.1`

## 目的

修复 OpenMAIC 单场景生成阶段将 `interactive` outline 局部降级为 `slide`，但未同步回写全局 `allOutlines`/session outline 列表的问题。

该状态分裂会导致：

```text
scene-outlines-stream: scene_4 = interactive
allOutlines:          scene_4 = interactive
current outline:     scene_4 = slide
content:              slide-shaped
```

最终可能造成场景组装失败、重试状态不一致、课堂 store 与 outline 不一致，并阻断 F54 的 scene materialization/export 验证。

## 用户路径

1. 用户从普通课堂或正式 Fusion 入口生成 scene outlines。
2. 某个 interactive outline 缺少有效 `widgetType/widgetOutline` 或 legacy `interactiveConfig`。
3. OpenMAIC 对当前 outline 应用 fallback。
4. 系统必须将规范化后的 outline 与全局 outline 列表保持一致。
5. scene-content、scene-actions、课堂 store 和恢复逻辑使用同一个 canonical outline。

## 核心验收标准

### AC1 — 单一 canonical outline

同一个 scene ID 在以下边界的 type 和配置必须一致：

- scene-outlines-stream 输出；
- session `sceneOutlines`；
- `allOutlines`；
- 当前 scene request 的 `outline`；
- scene-content / scene-actions 使用的 effective outline；
- classroom store 中的 scene type。

### AC2 — Fallback 原子同步

当 interactive outline 因配置不完整降级为 slide 时：

- fallback 必须是显式、可定位的规范化步骤；
- 当前 outline 与 `allOutlines` 必须同时更新；
- 后续 content 必须按 slide 生成；
- 后续 actions 和 scene builder 必须使用同一个 slide outline；
- 不得继续让全局列表保留旧的 interactive type。

### AC3 — Interactive 配置完整性

当 interactive outline 具有有效的 `widgetType + widgetOutline` 或 legacy `interactiveConfig` 时，不得无故降级为 slide。

### AC4 — 失败可定位

日志和 API 错误至少记录最小诊断字段：

- scene ID；
- 原始 outline type；
- effective outline type；
- content shape/type；
- fallback reason；
- model route/error category。

不得记录 token、cookie、完整 learner profile、原始 DeepTutor 数据或模型思维内容。

### AC5 — Fusion 场景边界不被破坏

F54 追加的 checkpoint/remediation outline 不得被错误 fallback；其服务端 Fusion metadata 必须保持不变。

### AC6 — ordinary generation 不回归

普通 slide、quiz、interactive、LAN Demo、历史课堂恢复路径保持现有行为。

## 模型错误边界

DeepSeek 或其他模型可能返回格式错误、截断 JSON 或错误内容类型。F55 不承诺解决模型本身的生成质量问题，也不替代 provider retry/structured-output 能力。

F55 只负责：

- 对模型结果进行最小类型校验；
- 防止 fallback 后状态分裂；
- 将模型错误与 outline/content 类型错误区分记录；
- 在无法安全规范化时返回明确、可定位的失败。

## 允许修改

- `OpenMAIC/app/generation-preview/page.tsx`
- `OpenMAIC/lib/hooks/use-scene-generator.ts`
- `OpenMAIC/lib/generation/outline-generator.ts`
- `OpenMAIC/lib/generation/scene-generator.ts`
- `OpenMAIC/lib/generation/scene-builder.ts`
- `OpenMAIC/app/api/generate/scene-content/route.ts`
- `OpenMAIC/app/api/generate/scene-actions/route.ts`
- 相关 OpenMAIC 类型、测试、日志和 feature evidence
- 本 feature 合同、索引和 `docs/progress.md`

## 不在范围

- 重新训练或替换 DeepSeek 模型；
- 建立通用模型质量保障平台；
- 课中 Fusion answer handling；
- remediation directive、retry 或课后 writeback；
- DeepTutor 数据结构或 pre-class contract；
- F54 checkpoint 设计本身。

## 验证要求

### 自动测试

至少覆盖：

- interactive 缺少配置时 fallback 为 slide；
- fallback 后 `allOutlines` 与当前 outline 一致；
- interactive 配置完整时保持 interactive；
- slide content 不会与 interactive effective outline 组合；
- F54 checkpoint/remediation metadata 不被改变；
- ordinary generation 不回归；
- 失败日志包含最小类型诊断。

### 人工测试

使用：

```text
Linear functions and graphs
```

至少确认：

1. `scene-outlines-stream` 的 scene_4 类型；
2. `scene-content` 请求的 outline 与响应 content；
3. `scene-actions` 请求的 outline 与 content；
4. `allOutlines` 与当前 outline 类型一致；
5. 课堂生成不因普通 scene fallback 阻断 Fusion checkpoint/remediation；
6. 新建 Fusion session 后可继续验证 F54。

## 依赖与关系

- F54 暂时 blocked，因为 Fusion server canonical outline 与浏览器 effective content 的跨边界冲突仍需 F56 处理，且 outline 字段丢失仍需 F57 处理。
- F55 已完成浏览器内部 fallback state consistency。
- F56 先建立安全 Fusion outline reconciliation；F57 再修复 stream/session 字段保留；之后重新激活 F54，继续验证 checkpoint/remediation 的物化、恢复和导出。
