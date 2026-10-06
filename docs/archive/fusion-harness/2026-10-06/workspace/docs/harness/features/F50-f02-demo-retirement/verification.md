# F50 验证记录

## 必要命令

| 层级 | 命令 | 必需 | 证据 |
| --- | --- | --- | --- |
| L1 静态 | OpenMAIC：`prettier check F50 changed files`、`git diff --check` | 是 | 通过：`git show --check 45336e2` 无空白错误；`prettier --check` F50 改动文件 0 错误 |
| L2 Feature | OpenMAIC：全量 `vitest run`（含改写后的 fusion 测试） | 是 | 通过：342 test files / 2981 tests passed（4+7 skipped）；`tests/fusion` 63 passed / 3 skipped |
| L3 系统 | OpenMAIC：`tsc --noEmit`、`build`、`check:i18n-keys` | 是 | 通过：`tsc --noEmit` exit 0；`pnpm build` exit 0；`pnpm check:i18n-keys` 通过 |
| Harness | `node scripts/harness-gate.mjs` | 是 | 通过：50 features, 0 errors |

## 人工路径

- [x] 首页不再出现 A/B 演示学生选择；`/api/fusion/demo-session` 返回 410。
- [x] 生成请求体不再包含 `fusionSessionId`；正式 `lessonSessionId` 流程保持可用。
- [x] 正式 Fusion 错误文案不再指向演示画像。
- [x] F01 适配层、F02 历史合同与验证证据仍保留。

## 通过证据

2026-08-10：

- 退役范围：`lib/fusion/session-catalog.ts`、`lib/fusion/topic.ts` 与 F02 专有测试（`demo-session-route.test.ts`、`session-catalog.test.ts`、`outline-route.test.ts`、`scene-routes.test.ts`）已删除；`client-session-propagation.test.ts` 已改写为只覆盖正式 `lessonSessionId` 传播；`/api/fusion/demo-session` 保留为返回 410 的失效桩。
- UI 与文案：`app/page.tsx` 的 A/B 演示学生选择、演示会话创建请求与 `home.fusion.*` 文案已移除；`generation.fusionSessionUnavailable` 已删除，`generation-preview` 改用 `sceneGenerateFailed`/`outlineGenerateFailed` 通用错误文案；8 个 i18n locale 已清理。
- 生成链路：`scene-outlines-stream`、`scene-content`、`scene-actions`、`use-scene-generator.ts`、`generation-preview`、`classroom/[id]` 不再传递或消费 `fusionSessionId`；工作树 `rg` 复查无 `fusionSessionId`/`isFusionDemoSupported`/`fusionSessionUnavailable` 残留。
- LAN demo：`lib/fusion/lan-demo-classroom.ts` 删除对已退役 `FUSION_DEMO_TOPIC` 的引用，改用同值本地常量 `LAN_DEMO_TOPIC = '一次函数'`；无 session id 参与，F21 LAN demo 行为不变。
- 格式化：F50 改动文件经 `prettier --write` 对齐后 `prettier --check` 通过；`git diff --check` 与 `git show --check 45336e2` 无错误。仓库基线存在 1436 个文件的既有格式债（本地 `core.autocrlf=true` 检出与 `endOfLine: lf` 的差异），与 F50 无关。
- 验证：全量 Vitest 342 files / 2981 tests passed；`tsc --noEmit`、`pnpm build`、`pnpm check:i18n-keys` 通过；`node scripts/harness-gate.mjs` 返回 `50 features, 0 errors`。
- Git：OpenMAIC `fusion-adapter` 当前提交 `fafe95d9cc3ba44096096393d8469c6033da6ff3` 已推送至 `origin/fusion-adapter`，HEAD 与远程一致且工作树干净；该提交修复了 F50 引入的页面乱码。
- 历史 v4/blocked/fail 复核记录保留在 artifact 中作为历史，不作为当前 gate 依据。

`knownUnverified` 与 `humanReviewRequired` 均为空；没有未解决的验证项。

## 2026-08-17 remediation round

- 修复 F50 提交引入的 `OpenMAIC/app/page.tsx` 中文乱码及相关注释编码，提交 `fafe95d9cc3ba44096096393d8469c6033da6ff3`，并已推送到 `origin/fusion-adapter`。
- 当前工作树与远程提交一致；定向 Fusion 测试、`tsc --noEmit`、Prettier、`git diff --check`、F50 残留/乱码扫描及 Harness gate 均通过。
- provider-neutral 当前平台普通只读子代理于 2026-08-17 完成 fresh review，结论 `pass`：确认合同/证据一致、F02 运行时退役、正式会话与 LAN Demo 保留、乱码已修复、Git/测试/Harness gate 通过。F50 可恢复为 `passing`。
