# Git 工作流

`OpenMAIC/` 与 `DeepTutor/` 是独立 Git 仓库。`main` 仅同步官方 `upstream`。用户于 2026-10-06 冻结跨应用 Fusion 路线，并选择 OpenMAIC 原生开发线：

- 两个 Fork 的 `fusion-adapter` 保留旧提交历史，不再扩展新功能。
- 两个 Fork 的 `archive/fusion-2026-10-06` 保存归档代码和选定本地改动；OpenMAIC 同时保存经过检查的根 harness 文档快照。
- OpenMAIC 的 `native-learning` 从官方最新 `main` 建立，后续保留改进和原生功能在相应合同授权后提交到该分支。
- DeepTutor 当前只归档并作为设计参考，不新建原生功能开发线。

| 目录 | `origin` | `upstream` |
| --- | --- | --- |
| `OpenMAIC/` | `ZhengRanCan/OpenMAIC` | `THU-MAIC/OpenMAIC` |
| `DeepTutor/` | `ZhengRanCan/DeepTutor` | `HKUDS/DeepTutor` |

## 后续原生开发

新开发线的代码变更在 `native-learning` 提交；新合同必须记录真实分支和 commit SHA。保留改进从旧线逐项提取，避免整文件覆盖最新上游代码。尚未建立新合同或执行迁入验证时，不声称原生迁移完成。

## 历史 Fusion feature 流程

对每个有代码改动的 Fork 单独执行：

```powershell
cd E:\project\github\classroom\OpenMAIC # 或 DeepTutor
git switch fusion-adapter
git add <仅本 feature 的文件>
git commit -m "feat(Fxx): concise summary"
git push origin fusion-adapter
git status --short # 必须无输出
git rev-parse HEAD
```

将 SHA 记入 feature 合同；两个 Fork 都改动时，必须各有一条记录：

```yaml
completionGate: {"gitEvidence":{"repositories":[
  {"path":"OpenMAIC","branch":"fusion-adapter","commit":"<40-char SHA>"}
]}}
```

`node scripts/harness-gate.mjs` 会校验 commit 已在当前分支和 `origin/fusion-adapter` 中，且工作树干净；否则 feature 不能标为 `passing`。

根目录的 `docs/`、`scripts/` 与 `AGENTS.md` 尚不属于 Git 仓库，不能作为任一 Fork 的提交内容。

## 原生线同步上游

```powershell
git fetch upstream
git switch main
git merge --ff-only upstream/main
git push origin main
git switch native-learning
git merge main
git push origin native-learning
```

先确认工作树干净。`main` 只允许 fast-forward；若远程或本地分叉，应检查并处理原因，不强推覆盖。原生功能线的上游合并与功能改动分开验证。归档线和旧 `fusion-adapter` 不随新路线变基或合并，以保持恢复点。

根目录存在 `.git` 目录不代表有有效 Git 仓库；当前 `git rev-parse` 仍确认根目录不是有效仓库。根 harness 通过明确清单复制到 OpenMAIC 归档分支保存，不直接作为业务 Fork 源码提交。
