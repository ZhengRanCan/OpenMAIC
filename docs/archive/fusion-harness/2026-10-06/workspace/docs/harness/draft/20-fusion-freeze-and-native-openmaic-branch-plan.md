# Fusion 工作归档与 OpenMAIC 原生路线分支方案

> 日期：2026-10-06。
>
> 状态：用户已确认路线，并于 2026-10-06 要求新开发线先升级至官方最新版本。本轮执行旧工作归档和官方基线同步；独立改进迁入及原生模块实施另行验证。第二节保留执行前的 Git 盘点，实际执行证据另行记录。
>
> 本文解决旧工作保存、新路线起点和代码取舍，不设计新的学习者模块，不替代后续实现合同。

## 执行修订：使用官方最新基线

用户将原方案“当前本地 main”调整为“先同步官方最新 main”。2026-10-06 已从配置的 `THU-MAIC/OpenMAIC` upstream 取回 `7230053af019b89c83d22dcab0a94f38fe193856`，其提交日期为 2026-10-05，包版本为 `1.2.0-rc.1`，Node 要求为 `>=22.19.0`。它相对原本地 main 增加 309 个提交。

新分支 `native-learning` 从这个最新官方提交建立。以下保留清单仍是候选行为；需要先针对新版重新评估，不能在本次同步中直接整批应用旧补丁。归档和 Git 基线同步不等于旧改进迁移完成，也不等于新版已安装、构建或完成真实课堂验证。

## 一、目标与推荐方案

保存两个 Fork 中现有 Fusion 的代码、历史和未完成状态，同时为 OpenMAIC 内部教学增强建立一个不依赖 DeepTutor 通信的新开发起点。DeepTutor 后续主要作为设计参考；原有 Fusion 工作可以按归档点恢复。

推荐在两个 Fork 中分别建立同名的日期归档分支；OpenMAIC 的新工作分支从当前 `main` 出发，选择性迁入独立改进。DeepTutor 当前不需要新的原生开发分支。

拟议名称：

| 仓库 | 分支 | 用途 |
|---|---|---|
| OpenMAIC | 现有 `fusion-adapter` | 保留原有提交历史和远程分支 |
| OpenMAIC | `archive/fusion-2026-10-06` | 保存旧路线最终归档快照、选定本地改动和归档说明 |
| OpenMAIC | `native-learning` | 从当前 `main` 创建，迁入批准保留的独立改进，作为新路线起点 |
| DeepTutor | 现有 `fusion-adapter` | 保留原有提交历史和远程分支 |
| DeepTutor | `archive/fusion-2026-10-06` | 保存旧路线最终归档快照及选定本地改动 |

以上名称是设计建议，尚未创建。执行前要检查重名情况。归档完成后记录每个快照的完整 SHA；分支约定不再接受新功能，不依靠分支名本身保证内容不可变。

```text
OpenMAIC main（固定起点）
    ├── 已有 fusion-adapter ── 日期归档分支
    └── native-learning ── 独立改进迁入 ── 新原生功能

DeepTutor main
    └── 已有 fusion-adapter ── 日期归档分支
```

## 二、已核对的 Git 状态

| 项目 | OpenMAIC | DeepTutor |
|---|---|---|
| 当前本地分支 | `fusion-adapter` | `fusion-adapter` |
| 当前 HEAD | `33b01a2628f7d62031187221e8015f03ee4a894a` | `bfb148ef8631bf76bf4075e154ee3b365431723b` |
| 本地 `main` / `origin/main` | `84b1907255208ad39fd04beac7c9087d202d146c` | `b728354863540466f5410bec3530eb55a9fe0edc` |
| 与当前 `main` 的 merge-base | 等于上述 `main` | 等于上述 `main` |
| GitHub `origin/fusion-adapter` | 与当前 HEAD 一致 | 与当前 HEAD 一致 |
| 本地未提交内容 | `.gitignore` | `deeptutor/api/routers/fusion_preclass_context.py` |
| 相对 `main` 的提交后差异 | 128 个文件，11,202 行增加、118 行删除 | 35 个文件，3,340 行增加 |

GitHub 分支 SHA 已通过 `git ls-remote origin` 核对，因此现有提交并非只保存在本地。以上差异不包含未提交修改，也不说明已经同步最新官方 upstream；本方案以当前固定 `main` 为起点，将同步上游与路线迁移分开。

OpenMAIC 的本地改动增加 `.npm-cache/`、`.pnpm-store/` 忽略规则，可以作为通用维护改进保留。DeepTutor 的本地改动是在课前路由增加请求和结果状态日志，属于未验证的 Fusion 调试修改：建议纳入归档，保留其未验证身份，不迁入新 OpenMAIC 路线。执行时必须重新核对工作树，防止漏掉后来新增的改动。

根目录 `docs/`、`scripts/`、`AGENTS.md` 不属于任一 Fork 的 Git 仓库。只给两个 Fork 建分支，不能自动保存这些设计、合同和证据。

## 三、新分支起点的选择

| 方案 | 收益 | 代价 | 结论 |
|---|---|---|---|
| 从当前 `main` 创建，选择性迁入独立改进 | 起点清楚；跨应用逻辑默认不进入；可逐项验证保留内容 | 混合提交需要提取补丁，不能全部直接 cherry-pick | 推荐 |
| 从 Fusion 分支创建，再删除跨应用功能 | 当前功能起点完整 | 要清理 128 文件中的功能、调用、类型、依赖、测试和配置，残留更难发现 | 可选，但维护成本更高 |
| 从 Fusion 分支创建，仅关闭入口或开关 | 初期改动较少 | 通信契约和基础设施仍随新路线维护，不能达到减少耦合的目标 | 只适合短期过渡 |

推荐方案保留完整旧历史在归档线，新线只承接有明确用途的差异。新线每个迁入提交应记录原始来源 SHA 和所保留的具体行为。不要整文件覆盖首页、生成接口、共享类型或依赖文件。

可先在独立 worktree 中组装和验证新基线，避免边筛选代码边扰动当前本地运行环境。是否最终切换现有 `OpenMAIC/` 目录，应在新基线验收后决定；若使用新目录，harness 路径和启动目录必须同步明确。

## 四、代码处置原则

所有现有代码均保存在旧路线归档；下面的“保留”“剔除”只针对新分支。剔除通常通过不迁入来实现，不删除归档内容。

1. 官方 `main` 已有功能作为基线保留，包括课堂生成、材料处理、Quiz、互动、PBL、用户本地资料和导入导出。
2. 不依赖 DeepTutor 的用户可见改进和可靠性修复，优先迁入。
3. 混合文件只迁入独立行为；原生课堂代码恢复到普通路径，再按新合同增强。
4. 教学记录、上下文快照和证据分离等设计可以参考，但不直接搬入旧跨域对象与数据表。
5. 新路线不伪造旧 Map、digest、身份绑定或执行事实，不把旧 Fusion 测试通过等同于新路线通过。

### 4.1 推荐保留的内容

| 内容 | 主要路径或来源 | 新分支处置 |
|---|---|---|
| 普通课堂与官方已有能力 | 当前 `main` | 原样作为基线，不从 Fusion 文件反向覆盖 |
| 最近课堂按创建/更新时间排序及时间显示 | `app/page.tsx`、八种 locale；来源 `d4d6604` | 提取排序、显示和对应文案；原提交依赖已改过的首页，需适配 |
| Windows 开发启动支持 | `scripts/dev-windows.ps1`、`package.json` 的 `dev:windows` 与 webpack 配置 | 提取迁入；重新验证端口识别、目录边界和启动行为 |
| 本地缓存忽略规则 | 未提交 `.gitignore` 修改 | 归档后作为小型维护改动迁入 |
| 普通大纲回退的状态同步 | `lib/hooks/use-scene-generator.ts`、生成预览中的有效 outline 同步 | 保留 `synchronizeEffectiveOutline` 及其调用；排除 Fusion session 传播 |
| SSE 同 ID outline 更新时替换已有项 | `app/generation-preview/page.tsx`；来源 `ae2ae14` | 保留通用去重行为，不带正式上下文流程 |
| 场景完成度通过 outline ID 关联 | `lib/store/stage.ts` 的完成/恢复判断 | 提取一般关联修复；排除正式 pair 完整性检查 |
| 普通内容形状与大纲类型一致性检查 | `lib/generation/outline-reconciliation.ts` 的通用部分及相关测试 | 可提取分类与一致性检查；正式服务器/浏览器 reconciliation 不照搬 |
| 局域网共享工作区（F22） | `app/api/lan-shared/**`、`lib/lan-shared/classrooms.ts`、首页共享区、脚本及测试 | 推荐保留独立功能，包括发布、音频读取、内容脱敏与并发写入修复 |
| 固定合成 LAN 演示（F21） | `app/lan-demo/page.tsx`、脚本、middleware、layout、headers、locale | 建议作为可选演示能力保留整组约束；合成数据 helper 从 `lib/fusion/lan-demo-classroom.ts` 移到 LAN 专用目录 |
| 对上述行为有效的测试与文案 | `tests/generation/**` 中独立测试、LAN 测试、相应 locale key | 随保留行为迁入，删除其对 Fusion 的不必要依赖 |

F21 是固定合成只读演示，F22 是正常界面的局域网共享，两者必须分开。保留 F21 时必须同时保留它的路由限制、预检与浏览器连接限制，不能只复制绕过普通入口的 layout 分支。保留 F22 时必须保留凭据脱敏和原浏览器数据不被覆盖的语义。

LAN 功能当前在旧工作区已有使用约定，但它们不是未来原生学习者模块的多用户身份或数据库方案。新学习者功能需要独立设计。

### 4.2 新分支不迁入的跨应用内容

| 内容 | 主要范围 | 原因 |
|---|---|---|
| Fusion 连接、Launch Code、委托凭证与跨应用身份 | `app/api/fusion/**` 中连接/启动/session、`lib/fusion/identity/**`、`credentials/**`、Adapter 客户端 | 运行时依赖 DeepTutor，当前新路线不需要 |
| 正式课前握手、冻结 Proposal、shadow、澄清及普通恢复 | `lib/fusion/generation-session.ts`、`preclass-contracts.ts`、`teaching-context.ts`、`adapter/preclass-context-provider.ts`、预览相关 helper | 旧跨域流程不成为新路线的前置条件；未来内部语义模块另行设计 |
| 自动 checkpoint/remediation pair 与专用 Catalog | `lib/fusion/materialization.ts`、`scene-catalog.ts`、生成 route 的 pair 调用 | 为旧跨域协议服务；普通 quiz、interactive 能力保留 |
| 跨应用诊断、Directive 与旧运行态 | `adapter/classroom-diagnosis-adapter.ts`、`real-event-update-provider.ts`、`scene-directive-planner.ts`、`lesson-runtime-state.ts`、Quiz 的 Fusion 回调 | 旧协议不随新基线迁入；以后原生反馈处理独立设计 |
| 课后 Candidate、写回与 Outbox | `persistent-lesson.ts`、`post-lesson-closeout.ts`、`profile-update-candidate.ts`、`outbox/**`、观察 Ledger | 数据结构与旧诊断、映射、投递关联耦合；课堂事实设计思想可参考 |
| Fusion session 和数据库基础设施 | `session/**`、`session-store/**`、`reliability/**`、Docker 的 `fusion-postgres` 服务 | 不为原生路线预设旧存储和投递架构 |
| 正式场景字段、导出 pair 检查 | `fusionRole`、`fusionCheckpoint`、scene ID 特例、store/export 中的 `assertFormalPairScenes` | 专属旧契约；普通导出和原生 `outlineId` 功能不受影响 |
| 通信配置及专用依赖 | `.env.example` 的 Fusion 条目；`pg`、`@types/pg`、`@electric-sql/pglite`、`types/node-sqlite.d.ts` 等 Fusion 引入项 | 新基线未决定原生数据库；检查无保留消费者后不迁入 |
| Fusion 专用测试与退役 Demo 桩 | `tests/fusion/**`（LAN 独立测试除外）、`app/api/fusion/demo-session/route.ts` 等 | 保存在归档作为旧证据，不参与新路线验收 |
| DeepTutor Fusion 增量 | `deeptutor/api/routers/fusion_*`、`services/fusion_*`、`deeptutor/fusion/**`、`integrations/openmaic/fusion/**`、相关测试、`api/main.py` 注册 | 整体归档；不移植为 OpenMAIC 原生资料模块 |

新分支不迁入 Fusion 的 PostgreSQL 配置，不意味着新学习者资料一定使用浏览器存储。资料所有权、多用户隔离、持久化与权限是后续原生设计问题。

### 4.3 只作为设计参考的内容

保留课前请求、教学提案和生成输入分层的思路；保留上下文版本与生成结果关联、课堂事实与长期判断分离、显式不确定性、消费与输出对齐分别取证的原则。

这些原则可以帮助原生模块设计，但不自动授权复制 `FrozenLessonGenerationContext`、Knowledge Map、Candidate 或跨应用 Receipt 的 schema。DeepTutor 原有学习者模块也是参考来源，不应整体复制或以未来尚未获取的学习者信息作为当前生成前提。

## 五、混合文件的迁移边界

| 文件或文件组 | 保留/恢复的普通行为 | 排除的旧行为 |
|---|---|---|
| `app/page.tsx` | 用户输入、材料、本地资料；批准的排序与 LAN 共享改进 | Fusion 连接、课程 scope 选择、启动和材料兼容提示 |
| `app/generation-preview/page.tsx`、`types.ts` | 普通解析、搜索、SSE、大纲审阅、内容生成；通用有效 outline 修复 | session 传播、Proposal 澄清、失败 Fusion 恢复状态 |
| `app/api/generate/scene-outlines-stream/route.ts` | 普通要求与已有模式选择 | freeze/resolve、formal prompt、Catalog/pair、正式持久化 |
| `scene-content/route.ts`、`scene-actions/route.ts` | 普通内容与动作生成、必要的类型回退修复 | 服务器正式 outline 恢复、Fusion 素材约束、跨域 context 注入与错误分支 |
| `components/scene-renderers/quiz-view.tsx` | 官方 Quiz 展示、提交与反馈 | Fusion event HTTP 调用及 Directive 接入 |
| `lib/hooks/use-scene-generator.ts` | 普通生成与通用状态同步 | `lessonSessionId` 传播及旧恢复协议 |
| `lib/generation/scene-builder.ts` | 原有 `outlineId` 关联、类型兼容行为 | 特殊 ID 前缀决定 Scene ID/角色，`fusionCheckpoint` 复制 |
| `lib/store/stage.ts` | 普通状态、恢复和一般 outline ID 检查 | formal pair 完整性门禁 |
| `lib/export/**`、`lib/types/generation.ts`、`stage.ts` | 普通场景、课堂导出与原有数据结构 | Fusion 专用字段和导出门禁；历史兼容见下一节 |
| locale | 排序、LAN 共享与可选演示对应 key | Fusion 连接、澄清、恢复文案 |
| `package.json`、lockfile、Docker、middleware、layout、next config | 官方配置加批准迁入的独立运行支持 | Fusion 数据库/依赖；LAN 安全约束按完整能力迁入 |

不能根据单词 `fusion` 批量删文件或代码。当前 upstream 基线中也有媒体模型名称和 PBL 内部术语包含该词，它们不是本项目跨应用 Fusion 增量。应以固定 `main` 与归档线的 diff 和消费者关系决定处置。

已确认部分“通用改进”与 Fusion 修改同处一个提交。例如 `ae2ae14` 同时修改正式 reconciliation 和普通状态同步；`d4d6604` 的首页排序补丁基于包含 LAN/Fusion 的首页上下文。执行时应提取行为，不能无条件整批 cherry-pick。

## 六、历史课堂与本地数据

新基线优先保证普通课堂及批准的独立功能可用，不默认承担旧正式 Fusion 课堂继续运行或课后写回的兼容责任。历史正式课堂需要继续运行时，使用归档代码与原有隔离环境恢复。

归档代码本身不是数据库、浏览器 IndexedDB、Blob、Provider 配置或密钥备份。已有本地数据和配置保留在原位置，不因分支迁移自动删除、转换或上传。若需要更换目录，应明确运行所需配置与数据位置；不要将忽略的 `.env`、数据库或真实学习者数据加入 Git。

对普通导出物和带旧 Fusion 元数据的导出物，需要分别验证。后者若能作为普通只读内容打开，应明确不再承担旧运行协议；若不能可靠读取，应给出明确兼容状态或在归档环境打开。具体历史使用需求在执行前确认，不能声称所有旧正式课堂已兼容新分支。

## 七、根目录 harness 与设计文档归档

只保存 Fork 分支不足以保存根目录材料。推荐将经过审阅的根目录快照放入 OpenMAIC 日期归档分支的 `docs/archive/fusion-harness/2026-10-06/`，以保持本次归档不新增第三个业务仓库。

快照包含：根 `AGENTS.md`、进度与 Git 工作流；架构/协议/约束；Feature Registry、合同与验证记录；相关 harness 脚本；本轮 draft 11–20。具体按文件清单打包，逐项确认适合上传的内容。`docs/log/`、incidents、evidence/artifacts 中的本地记录及 `classroom/` 导出不默认整体打包，需确认没有凭据、真实用户信息或私有原始响应后再选入。

归档清单记录原始根路径、内容哈希、两个 Fork 的最终归档 SHA、源 `main` SHA、保留/不迁入列表，以及恢复目录布局的方法。复制后的历史文档使用独立 archive 目录，不冒充新路线的当前 SSOT；恢复时需要按清单还原根 harness 与两个 Fork 的相对位置。

新路线的活动设计、Feature 合同和验证入口应单独建立并进入 Git 跟踪。建议在 OpenMAIC 新分支的 `docs/harness/` 内建设原生路线文档，根路由再指向它；不要继续让未纳入 Git 的根文档成为新工作唯一记录。

## 八、Feature 和验证入口的过渡

当前 F60 仍是唯一 active，验证记录为实现未开始。本次方案没有完成其合同，也不能将它标记 passing。执行路线冻结时，应将它按 Registry 现有状态模型改为 `blocked`，明确原因是产品路线冻结而非技术验收失败；F54/F58/F59 保留原有阻塞事实。

旧 `scripts/harness-gate.mjs` 会校验所有 passing 代码 Feature：当前目录必须处于记录分支，HEAD 包含历史 commit，远程分支包含该 commit，工作树干净。因此在同一目录切到从 `main` 派生的新分支后，不能期望旧 gate 继续通过。

推荐旧 Registry、合同和验证入口作为归档线的历史体系保留；原生路线使用独立 Registry 与验证入口。新入口检查新分支和实际迁入行为，不借用旧 passing 状态。若以后统一 gate，也必须区分“归档 commit/远程可恢复性”和“当前 Feature 工作树验收”，不能修改历史证据 SHA 来适配新分支。

执行前需要更新或新增相应合同与路由说明，包括 `AGENTS.md`、Git 工作流和初始化入口，使新原生分支成为明确允许的开发宿主。本方案不在 F60 scope 下直接实现清理或新学习者模块。

## 九、执行阶段与验收

### 阶段 A：完整保存旧路线

重新检查两个工作树；按白名单审阅本地改动；在两个日期归档分支记录选定改动；为根 harness 制作可上传快照和清单。保留原 `fusion-adapter` 历史，不重写历史或强推。

向各自 `origin` 推送归档分支后，核对远程 SHA 与本地最终快照一致、每项本地改动得到明确处理，并确认根文档快照可按布局恢复。此阶段不要求把 blocked Feature 修好，不伪造完成证据。

### 阶段 B：建立原生开发基线

从固定 OpenMAIC `main` 创建 `native-learning`；在独立目录组装批准的改进，每组形成独立提交并标记来源；依次迁入 Windows 支持、排序、普通回退修复、LAN 能力及对应文案/测试。混合修改用提取补丁实现。

迁入后检查新运行路径没有 DeepTutor 请求、Launch Code、委托凭证、Fusion session、shadow、Outbox 或 pair 依赖；检查没有因批量处理损坏官方 PBL/媒体等功能。更新依赖时由包管理器生成一致的 lockfile。

### 阶段 C：验证新基线并建立新开发入口

必要验证包括 TypeScript、适用 lint、构建，以及保留行为的测试和人工路径：普通需求到课堂；材料生成；大纲审阅、回退与恢复；Quiz；导入导出；首页排序；Windows 启动；批准保留的 LAN 共享/固定演示。实际命令和结果写入新的迁移合同。

新基线完成独立只读复核后，提交并推送新分支，核对远程 SHA。此时才宣布新开发起点可用，再创建新的原生教学/学习者功能合同。不得把“分支创建成功”当作“迁移验收完成”。

本轮只读检查没有运行上述迁移验证，不能保证所有候选补丁直接应用或新基线已通过。

## 十、回退与待确认选择

归档分支与精确 SHA 提供代码恢复点；独立 worktree 可以在新基线不满足要求时继续使用旧目录。回退不通过破坏性 reset、批量删除数据库或伪造历史记录实现。

需用户审阅的关键选择是：采用从当前 `main` 派生并迁入独立改进的方案；使用拟议分支名称；保留推荐的非 Fusion 能力（特别是 F21 固定演示与 F22 LAN 共享）；历史正式课堂以后在归档环境使用，还是要求新线提供特定只读导入兼容。

保留改进与原生模块的具体实施仍需独立合同和计划。上表是初始盘点与处置建议；本次归档和基线同步的实际状态以执行记录为准。

## 参考入口

- [Git 工作流](../../git-workflow.md)。
- [当前进度](../../progress.md)。
- [F60 合同](../features/F60-preclass-fusion-remove-checkpoint-remediation/feature.md)与[验证记录](../features/F60-preclass-fusion-remove-checkpoint-remediation/verification.md)。
- [旧 harness 的 Git 验证入口](../../../scripts/harness-gate.mjs)。
- [初始化与 LAN 使用约定](../INITIALIZATION_CONTRACT.md)。
- [生成 hook 与通用回退同步](../../../OpenMAIC/lib/hooks/use-scene-generator.ts)。
- [大纲内容一致性模块](../../../OpenMAIC/lib/generation/outline-reconciliation.ts)。
- [LAN 共享模块](../../../OpenMAIC/lib/lan-shared/classrooms.ts)。
- [普通场景构建](../../../OpenMAIC/lib/generation/scene-builder.ts)。
