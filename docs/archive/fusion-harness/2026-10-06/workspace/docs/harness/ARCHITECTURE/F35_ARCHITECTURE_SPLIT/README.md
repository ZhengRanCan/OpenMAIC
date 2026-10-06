# Architecture 分片索引

`docs/harness/ARCHITECTURE.md` 是唯一 canonical source of truth（SSOT）。本目录的九个编号分片由脚本生成，每个分片一对一承载一个全局架构主题；文件顶部的“上下文锚点”用于提示必要关联。

| 文件 | 主题 | 适合何时读取 |
| --- | --- | --- |
| `01-system-responsibilities-and-domain-ownership.md` | 系统职责与领域所有权 | 判断 DeepTutor、OpenMAIC、Fusion Adapter 与 Browser 的职责归属 |
| `02-fusion-adapter-layering-and-trust-boundaries.md` | Fusion Adapter 分层与信任边界 | 审查 Adapter 分层、ACL、依赖方向与跨域信任边界 |
| `03-identity-lesson-binding-and-authoritative-state.md` | 身份、Lesson Binding 与权威状态 | 讨论身份链、用户作用域、Lesson Binding 与状态所有权 |
| `04-core-domain-objects-and-stage-handoffs.md` | 核心领域对象与阶段交接 | 设计或审查跨阶段领域对象及交接关系 |
| `05-pre-in-post-class-main-flow.md` | 课前 → 课中 → 课后主链路 | 理解完整 Fusion 生命周期和阶段门禁 |
| `06-deeptutor-profile-processing-boundary.md` | DeepTutor 画像处理边界 | 处理 Candidate、事实投影、Mastery 与 Memory 边界 |
| `07-integrity-reliability-security-and-lifecycle.md` | 完整性、可靠性、安全与生命周期 | 审查摘要、投递、安全、删除与审计不变量 |
| `08-implementation-maturity-and-migration-status.md` | 实现成熟度与迁移状态 | 区分正式架构、详细设计、迁移参考和 provisional 内容 |
| `09-open-decisions.md` | 待决事项 | 查找尚未定稿、不得由实现临时决定的问题 |

## 推荐最小阅读路径

只理解系统主线时，阅读：

1. `01-system-responsibilities-and-domain-ownership.md`
2. `04-core-domain-objects-and-stage-handoffs.md`
3. `05-pre-in-post-class-main-flow.md`
4. `08-implementation-maturity-and-migration-status.md`

只设计身份与可靠性时，阅读：

1. `02-fusion-adapter-layering-and-trust-boundaries.md`
2. `03-identity-lesson-binding-and-authoritative-state.md`
3. `07-integrity-reliability-security-and-lifecycle.md`

只处理 DeepTutor 画像链路时，阅读：

1. `03-identity-lesson-binding-and-authoritative-state.md`
2. `05-pre-in-post-class-main-flow.md`
3. `06-deeptutor-profile-processing-boundary.md`
4. `07-integrity-reliability-security-and-lifecycle.md`

FUSION 专项文档的成熟度由第 8 分片统一说明：`02/04/06` 是阶段协议设计基准，`08/09/10` 是跨阶段或专项基础设计基准，`03` 是已审核课前迁移参考，`05/07` 仅为 provisional/reference。

`REVIEW.md` 是重组前 F06 版本的历史审核证据，不是当前 SSOT 或待办清单。

## 文档维护规则

- 默认只编辑 `docs/harness/ARCHITECTURE.md`，随后执行：

  ```powershell
  node scripts/architecture-split.mjs split
  node scripts/architecture-split.mjs check
  ```

- `check` 比较全部九个生成分片与 canonical；`node scripts/harness-gate.mjs` 也会运行该检查。
- 只有在分片中完成了经过审阅的编辑时，才显式运行 `node scripts/architecture-split.mjs merge`；合并后必须审阅 `ARCHITECTURE.md`，再运行 `split` 和 `check`。
- 根目录不是 npm 工程；以上 Node 命令是本工作区的标准入口。
