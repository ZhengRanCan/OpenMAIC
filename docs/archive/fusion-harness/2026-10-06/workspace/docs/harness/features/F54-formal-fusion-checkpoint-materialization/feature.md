# F54 — formal Fusion checkpoint materialization

## 状态

- `active`
- version: `v0.1`

## 目的

排查并修复正式课前 Fusion 已经影响 OpenMAIC outline 生成，但服务端追加的 checkpoint/remediation 没有进入最终课堂导出物的问题。

本 feature 只处理课前生成链路中 checkpoint/remediation 的物化和可追溯性，不处理课中学生作答、动态 remediation 决策或课后 Fusion writeback。

## 用户路径

1. 测试用户通过正式 Fusion 入口创建 `lessonSessionId`。
2. OpenMAIC 调用 DeepTutor `/api/v1/fusion/pre-class/context`。
3. OpenMAIC 请求 `/api/generate/scene-outlines-stream`。
4. 服务端冻结 formal context，并根据 frozen context 追加 checkpoint 与 remediation outline。
5. 浏览器接收完整 outline 流并生成对应 scene content。
6. 用户打开课堂并导出 `.maic`/课堂包。
7. 导出物包含可定位的 checkpoint 和 remediation 场景。

## 验收标准

### AC1 — Formal outline 追加

当 formal Fusion 返回 `resolved` 时，`scene-outlines-stream` 的最终 `done.outlines` 必须包含：

- 一个 `type: "quiz"` 的 checkpoint outline；
- 一个 remediation outline；
- `fusionCheckpoint.checkpointId`；
- `fusionCheckpoint.mappingId`；
- `fusionCheckpoint.mappingRevision`；
- `fusionCheckpoint.lessonKnowledgePointIds`；
- `fusionCheckpoint.remediationStrategy`。

### AC2 — SSE 完整传递

服务端追加的 outline 必须通过 SSE 发送给浏览器，且 `done.outlines` 与此前发送的 outline 事件保持一致。客户端不得因流式解析、事件顺序、完成事件处理或路由跳转而丢失追加场景。

### AC3 — Content materialization

每个追加 outline 必须进入 scene-content 生成/物化流程，最终写入课堂 store。checkpoint 不得只存在于服务端 session 或 outline 响应中。

### AC4 — 持久化与恢复

formal session 的 `generatedOutlines`、`sceneCatalog` 和 runtime 初始 checkpoint scene 必须包含追加场景。重新打开同一课堂时，场景数量、场景 ID 和 Fusion checkpoint metadata 不得丢失。

### AC5 — 导出可追溯

导出的课堂 manifest 至少包含 checkpoint 和 remediation 场景。导出过程不得依赖浏览器端自行重建 Fusion metadata，也不得主动过滤 formal Fusion 场景。

### AC6 — 非 Fusion 不回归

ordinary classroom、LAN Demo、历史课堂恢复和无 formal Fusion session 的生成路径保持现有行为，不凭空追加 checkpoint/remediation。

### AC7 — 故障可定位

当链路失败时，服务端或客户端日志必须能够区分：

- formal session 缺失或未 resolved；
- 服务端 outline 未追加；
- SSE 未传递；
- 前端未保存；
- scene content 未物化；
- session/store 恢复丢失；
- 导出 manifest 丢失。

日志不得包含 token、cookie、完整 learner profile、原始 DeepTutor 学习数据或模型思维内容。

## 范围

### 允许修改

- `OpenMAIC/app/api/generate/scene-outlines-stream/route.ts`
- `OpenMAIC/app/generation-preview/page.tsx`
- `OpenMAIC/app/classroom/[id]/page.tsx`
- `OpenMAIC/lib/fusion/generation-session.ts`
- `OpenMAIC/lib/fusion/scene-catalog.ts`
- `OpenMAIC/lib/generation/scene-builder.ts`
- `OpenMAIC/lib/export/use-export-classroom.ts`
- 相关 OpenMAIC 类型、测试、日志和 feature evidence
- 本 feature 合同和 `docs/progress.md`

### 不在范围

- 课中 checkpoint 答题事件处理；
- remediation directive、retry 或动态场景跳转策略；
- 课后 observation、profile update 或 writeback；
- DeepTutor 画像、Book、Spine、Progress 或 CourseScope 数据结构；
- 普通课堂教学内容质量的全面重写；
- 下载按钮或历史课堂数据恢复，除非验证证明它直接阻断本 feature 的导出证据。

## 数据与身份边界

- 只使用 OpenMAIC 服务端已经冻结的 formal context。
- 不从 DeepTutor 文件、数据库或浏览器存储读取数据。
- 只在日志中记录 `lessonSessionId`、outline/scene ID、formal resolution 状态和计数等最小诊断字段；不得记录凭证。
- 浏览器不接触 Fusion delegation credential。
- checkpoint metadata 必须来自服务端 frozen context，浏览器输入不得覆盖。

## 兼容与回滚

- 只有 `formalFusion.kind === "resolved"` 时追加 formal checkpoint/remediation。
- formal session 无效、过期或未配置时维持 fail-closed/现有错误路径。
- ordinary generation 不改变。
- 若修复导致 materialization 或导出回归，可回滚本 feature commit；不得回退到读取浏览器自有 profile 或 DeepTutor 内部存储。

## 验证要求

### 静态验证

- 检查 formal outline 追加点、SSE `outline`/`done` 事件、前端 outline store、scene-content 入口、session persistence 和 export manifest。
- 确认所有追加场景都由服务端 metadata 绑定。

### 自动测试

至少覆盖：

- formal resolved 追加 checkpoint/remediation；
- SSE done 包含追加场景；
- 前端/生成流程不丢追加 outline；
- scene catalog 正确识别 checkpoint/remediation；
- ordinary generation 不追加；
- 导出 manifest 包含追加场景；
- session recovery 保留 metadata。

### 人工测试

使用测试请求：

```text
Linear functions and graphs
```

保留以下证据，不保存 token、cookie 或完整学生数据：

1. `/api/fusion/launch` 的 session 标识（脱敏）；
2. `/api/generate/scene-outlines-stream` 中 checkpoint/remediation outline 和 done 事件；
3. `/api/generate/scene-content` 对追加 outline 的请求/响应状态；
4. 最终课堂场景列表；
5. 导出 manifest 中 checkpoint/remediation 场景；
6. DeepTutor pre-class request/response 的最小日志。

## 完成门槛

- 所有验收标准通过；
- 自动测试、人工路径和故障定位证据齐全；
- `knownUnverified` 与 `humanReviewRequired` 为空；
- 完成独立只读复核；
- 若修改 OpenMAIC，提交并推送 `fusion-adapter` 分支，记录 commit SHA；
- 更新 `feature-index.json`、`docs/progress.md` 和本 feature 的 verification evidence。

## 依赖

- F23、F24、F25、F46、F47、F49、F53 已通过；
- DeepTutor `/api/v1/fusion/pre-class/context` 可返回 `ready`；
- OpenMAIC formal Fusion session、PostgreSQL local persistence 和模型配置可用。
