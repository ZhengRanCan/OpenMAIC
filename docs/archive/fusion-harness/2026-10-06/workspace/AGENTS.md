# AGENTS.md

本工作区有两个独立 Git Fork：`DeepTutor/`（个性化学习工作区）和 `OpenMAIC/`（互动课堂应用）。根目录的 `docs/`、`scripts/` 和 `classroom/` 是共享 harness 与本地测试产物，不是第三个应用或 Git 仓库。

本文件只处理任务路由；产品、架构和 feature 决策以相应文档和当前 Feature 合同为准。

## 任务入口与按需读取

每次任务开始，依次读取：

1. `docs/harness/features/feature-index.json`
2. `docs/progress.md`
3. `docs/harness/features/README.md`

随后按 Registry 选择唯一当前 feature，并只读取它的 `feature.md` 和 `verification.md`。不要默认加载历史 feature、`docs/log/` 或全部基线文档。

| 任务涉及 | 读取 |
| --- | --- |
| 产品目标、用户路径、MVP 范围 | `docs/harness/PRODUCT_SPEC.md` |
| 模块边界、服务调用、数据流、跨仓库集成 | 优先按任务读取 `docs/harness/ARCHITECTURE/F35_ARCHITECTURE_SPLIT/` 中对应分片，再读取 `docs/harness/CONSTRAINTS.md` |
| AI、隐私、密钥、身份、授权、存储、外部调用 | `docs/harness/CONSTRAINTS.md` |
| 页面、交互、视觉或无障碍 | `docs/harness/DESIGN.md` |
| 安装、开发、测试、构建或 CI | `docs/harness/INITIALIZATION_CONTRACT.md` |
| 分支、远程、提交或同步上游 | `docs/git-workflow.md` |
| 导出课堂、比较 baseline/A/B 或审查 `manifest.json` | `docs/classroom-review-workflow.md` |
| 验证历史、构建失败、UI 错误或用户返工 | 当前 feature 的 `verification.md`、`docs/log/` 或 `docs/harness/incidents/` |

架构分片位于 `docs/harness/ARCHITECTURE/F35_ARCHITECTURE_SPLIT/`，按主题对应：

| 主题 | 读取 |
| --- | --- |
| 系统职责、领域所有权 | `01-system-responsibilities-and-domain-ownership.md` |
| Fusion Adapter 分层、ACL、信任边界 | `02-fusion-adapter-layering-and-trust-boundaries.md` |
| 身份、Lesson Binding、权威状态 | `03-identity-lesson-binding-and-authoritative-state.md` |
| 核心领域对象、阶段交接 | `04-core-domain-objects-and-stage-handoffs.md` |
| 课前、课中、课后主链路 | `05-pre-in-post-class-main-flow.md` |
| DeepTutor 画像、Candidate、Mastery/Memory 边界 | `06-deeptutor-profile-processing-boundary.md` |
| 完整性、可靠性、安全、生命周期 | `07-integrity-reliability-security-and-lifecycle.md` |
| 实现成熟度、迁移状态 | `08-implementation-maturity-and-migration-status.md` |
| 尚未定稿的架构决策 | `09-open-decisions.md` |

分片顶部的“上下文锚点”会提示必要的关联文件；只读取当前任务所需的最小集合。`REVIEW.md` 是重组前 F06 的历史审查证据，不是当前 SSOT 或待办清单。

`docs/harness/ARCHITECTURE.md` 仍是唯一 SSOT；`F35_ARCHITECTURE_SPLIT/` 是其受控生成的审阅分片。日常架构编辑应修改主文档后运行 `node scripts/architecture-split.mjs split` 和 `node scripts/architecture-split.mjs check`。只有需要审阅分片变更时，才运行受控的 `merge`；`node scripts/harness-gate.mjs` 会检查两者是否同步。

课堂审查的测试声明放在对应 Feature 合同目录；报告统一写入 `classroom/review/Fx/<测试批次>/`，不得写入原始课堂导出目录。

