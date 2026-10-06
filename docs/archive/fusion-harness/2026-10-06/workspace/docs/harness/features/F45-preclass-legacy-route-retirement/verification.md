# F45 验证记录

## 必要命令

| 层级 | 命令 | 必需 | 证据 |
| --- | --- | --- | --- |
| L1 静态 | DeepTutor：`python -m compileall F45 changed modules`；OpenMAIC：`prettier check F45 changed files` | 是 | 均通过 |
| L2 Feature | DeepTutor：`uvx ruff check F45 changed files/tests`、定向 Fusion pytest；OpenMAIC：Vitest | 是 | 均通过 |
| L3 系统 | OpenMAIC：`tsc` 和 `build` | 是 | 均通过 |
| Harness | `node scripts/harness-gate.mjs` | 是 | `45 features, 0 errors` |

## 人工路径

- [x] 课前正式流程只读取服务端 `FrozenLessonGenerationContext`；旧 Profile/Map 路由无正式消费者。
- [x] 历史 Session 的 legacy 字段仅只读恢复或显式失效，不静默升级、不跨 schema/digest 拼接。
- [x] 普通课堂与 F02 Demo 保持独立，不作为 Fusion 失败的隐式回退。

## 通过证据

2026-08-09：

- DeepTutor：旧 `fusion_profile.py` 及 `/profile`、`/knowledge-map` 路由已移除，`profile:read` scope 已退役；定向 compileall、Ruff 和 Fusion pytest 通过。
- OpenMAIC：Launch 不再捕获旧 Profile/Map/Catalog 快照，正式连接探测只要求 `pre-class/context`；课中/课后在 legacy 字段缺失时读取冻结语义 Map；定向 Prettier、Vitest、tsc 和 build 通过。
- 历史兼容：legacy Session 字段保留为可选只读数据；不进行静默 schema/digest 升级或跨版本拼接。
- Git：DeepTutor `fusion-adapter` 提交 `8c66eb33deb8be3bfde6e9464744d20b41bf032d`；OpenMAIC `fusion-adapter` 提交 `d4f42747726eb5912719b359cb2daf185c6a8498`；两 Fork 工作树干净且已推送。
- 独立复核：`v4_flash_worker` 只读复核结论为 `pass`，未修改文件。
- Harness：`node scripts/harness-gate.mjs` 返回 `45 features, 0 errors`。

`knownUnverified` 与 `humanReviewRequired` 均为空；没有未解决的验证项。
