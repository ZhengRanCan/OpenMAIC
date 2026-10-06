# Feature Registry

`feature-index.json` 是轻量任务选择器。每个条目仅包含 `id`、`title`、`status`、`feature_folder` 和 `version`；完整合同存放在对应目录。

## 标准工作流程

1. 读取索引与 `docs/progress.md`。
2. 若存在唯一的 `active` feature，继续它；否则选择依赖均为 `passing` 的最小编号 `not_started` feature。
3. 仅读取当前 feature 的 `feature.md` 与 `verification.md`。
4. 仅修改合同 `scope` 允许的文件；需要扩大范围时，先更新合同并在 `docs/progress.md` 说明原因、影响和验证方式。
5. 完成实现或文档工作后，将命令、人工路径和结论写入该 feature 的 evidence/artifacts，并同步合同、索引、进度面板；必要时更新长期决策。

有效状态为 `not_started`、`active`、`blocked` 和 `passing`，且至多一个 feature 可处于 `active`。

## 创建 feature

创建前先向用户汇报 `PRODUCT_SPEC.md`、`CONSTRAINTS.md`、`ARCHITECTURE.md`、`DESIGN.md` 和 `INITIALIZATION_CONTRACT.md` 的相关结论，并取得产品方向确认。随后：

1. 在 `feature-index.json` 添加轻量条目。
2. 建立 `docs/harness/features/Fxx-short-name/`，写入 `feature.md` 和 `verification.md`。
3. 在合同、索引和 `docs/progress.md` 中将其同步标为 `active`，再开始实现。

合同必须写明集成宿主、用户路径、允许改动范围、数据/身份/AI 边界、兼容或迁移策略，以及与风险相称的验证层级。

## Passing gate

通过前应同步更新索引、合同和进度面板，并完成所有验收标准、必要验证、人工路径、证据和独立代码审查。`knownUnverified` 与 `humanReviewRequired` 必须为空。

### 独立只读复核

每个准备标记为 `passing` 的 feature，在主代理完成合同要求的实现与验证后、宣布完成前，必须委派一次独立子代理进行有边界的只读复核。默认使用当前平台可稳定投递 assignment 的普通子代理；只有在平台明确保证 `v4_flash_worker` assignment 可达且权限匹配时才使用它。复核输入仅限当前 feature 的 `feature.md`、`verification.md`、相关改动或 diff 范围，以及完成复核所需的非敏感验证证据。

子代理应检查合同与 `scope` 是否一致、验收标准和必要验证是否完整、证据是否充分，以及是否存在实质性回归；返回 `pass`、`fail` 或 `blocked`，并附带简明、可定位到文件的依据。子代理不得修改文件、替代主代理的验证，或作出最终产品判断。

`fail` 或 `blocked` 均不得将 feature 标记为 `passing`：主代理必须处理发现的问题后重新委派复核。若首选子代理不可用，可改用当前平台提供且 assignment 可达的普通子代理；不得使用未经平台批准的外部 API、模型 CLI 或本地替代模型。复核结论、实际 provider/agent 类型及主代理处置必须记录在该 feature 的 verification evidence/artifacts 中。

任何外部 provider 都不得接收密钥、凭据、个人/学生数据，或用户未明确授权发送的其他材料；无法保持此数据边界时，应记录为 `blocked`，而非扩大子代理输入。

#### Provider 选择与失败处理

独立复核优先选择 assignment 投递稳定、权限与只读要求匹配的当前平台子代理。若使用外部 provider，必须由平台配置并记录实际 provider；不得调用第三方代理 URL、直接 HTTP API、模型 CLI 或本地替代模型。API key 仅由运行环境读取，绝不写入任务消息、文档、日志或提交，也不得传给子代理。投递失败、鉴权失败、额度不足或权限不匹配时，复核结果必须记录为 `blocked`；在同一轮中可切换到平台提供的普通子代理重新执行，但不得伪造复核结论。

修改 `DeepTutor/` 或 `OpenMAIC/` 代码的 feature 还必须完成所属 Fork 的 Git 闭环：只暂存该 feature 的文件，提交到 `fusion-adapter`（或合同声明的后续融合分支），推送至该 Fork 的 `origin`，并确保工作树干净。合同的 `completionGate.gitEvidence` 必须记录每个改动 Fork 的 `path`、`branch` 和 commit SHA：

```yaml
completionGate: {"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"<40-char SHA>"}]}}
```

`node scripts/harness-gate.mjs` 会校验 commit 位于当前分支和 `origin/<branch>`，并校验工作树干净。根目录 harness 文档尚无 Git 提交归属，不能伪造为业务 Fork 的提交。
