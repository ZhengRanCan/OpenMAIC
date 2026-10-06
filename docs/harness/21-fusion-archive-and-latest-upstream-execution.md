# Fusion 归档与 OpenMAIC 官方最新基线执行记录

日期：2026-10-06。

用户确认将旧 Fusion 路线归档，并要求新开发线先升级至官方最新 OpenMAIC。本文记录已经完成的 Git 操作与实际边界；不宣称保留改进迁移、原生功能实现或运行验收完成。

## 已完成的保存与同步

| 对象 | 分支与固定提交 | 结果 |
|---|---|---|
| OpenMAIC 旧 Fusion | `fusion-adapter`：`33b01a2628f7d62031187221e8015f03ee4a894a` | 原有本地与远程历史保留，未变基或重写 |
| OpenMAIC 完整归档 | `archive/fusion-2026-10-06`：`991693431261be11ecb2569028245c76d91e1b3c` | 已推送；含旧代码、缓存忽略修改及根 harness 快照 |
| DeepTutor 旧 Fusion | `fusion-adapter`：`bfb148ef8631bf76bf4075e154ee3b365431723b` | 原有本地与远程历史保留 |
| DeepTutor 归档 | `archive/fusion-2026-10-06`：`24de083c39cf7ae88c04cc8ecfee443a06e63306` | 已推送；含原有本地诊断日志修改，其功能验证未补做 |
| OpenMAIC 官方基线 | `upstream/main`：`7230053af019b89c83d22dcab0a94f38fe193856` | 取回时及同步后再次核对均为官方最新 main |
| OpenMAIC Fork main | `main` / `origin/main`：同上 | 从原 `84b1907` fast-forward，并已推送 |
| 原生开发基线 | `native-learning`，核心提交 `1055b05e295ff061802755898e38da81c82aed1a` | 基于上述官方提交，仅另加本地缓存忽略规则；已推送 |

执行记录随后也会提交到原生分支，分支当前 tip 可通过 Git 查看；不要把“核心提交”理解成永远不变的分支 tip。

本地 OpenMAIC 已切到 `native-learning`；DeepTutor 位于日期归档分支。已有忽略数据、Provider 配置、依赖目录和浏览器数据未删除或上传。

## 新官方版本的变化

- 固定官方提交：`7230053af019b89c83d22dcab0a94f38fe193856`。
- 提交时间：2026-10-05 17:03:21 +08:00。
- 提交标题：`test(boot): keep register() from starting real background workers (#1803)`。
- `package.json` 版本：`1.2.0-rc.1`，来自官方 main，不是另选的稳定发布 tag。
- Node engine：`>=22.19.0`；本机 `node --version` 为 `v22.19.0`。
- 相对旧本地 main：新增 309 个提交，diff 涉及 2,784 个文件。

当前 `node_modules` 属于原工作环境，没有在本轮重装以匹配新 lockfile；没有启动新版服务、运行构建、完整类型检查或真实课堂验证。Node 版本满足最低要求，不等于依赖和运行已经验证。

## 根 harness 快照

OpenMAIC 归档提交中的目录为：`docs/archive/fusion-harness/2026-10-06/`。

快照保存 175 份选定源文件，另含 README、manifest 和归档专用 `.gitattributes`。包括根路由、进度与 Git 工作流、架构与协议、Feature 合同与验证记录、draft 11–20 和 harness 脚本。F60 的路线冻结记录也已保存。

manifest 逐项记录来源路径、归档路径、字节数与 SHA-256。复制后核对源文件与副本哈希，并核对 Git index blob 与副本原始字节一致。归档 `.gitattributes` 关闭文本转换，保留原有换行和历史末尾空行，避免跨平台 checkout 改变哈希。

快照不包含 `docs/log/`、incidents、artifact/evidence 目录及 `evidence.md`、课堂导出、附件、运行数据库、学习者数据或 Provider 配置值。凭据格式扫描通过；初次扫描中的 `task-engine` 文件名命中已核对为误报，没有脱敏改写源文档。

本轮新增执行记录晚于旧路线快照，另在新开发线上跟踪。Git 归档保存的是代码和选定文档，不是全部运行环境或数据备份。

## 验证结果与未完成事项

已完成的 Git 检查：

1. 通过 `git ls-remote` 核对两个远程日期归档 SHA 和原 Fusion SHA。
2. 确认 OpenMAIC 本地 main、远程 main 与官方最新 main 指向同一提交。
3. 确认原生核心提交只增加 `.npm-cache/`、`.pnpm-store/` 忽略规则，未迁入旧通信功能。
4. 核对 175 份源文件快照的哈希与 Git blob 字节。
5. 核对两个 Fork 工作树状态及 Node 版本。

以下事项没有在本轮完成：

- Windows 启动、排序、普通回退修复、LAN 共享和固定演示等候选改进的新版迁入。
- 新官方依赖安装、构建与运行验收。
- 原生教学/学习者模块的设计与实现。
- 历史正式 Fusion 课堂在原生分支上的兼容验收。

这些事项不能借用旧 Feature 的 passing 证据。官方新版已发生较大变化，需重新核对候选改进是否仍有必要及其接入点。

## 进度与下一步

F60 已因用户选择冻结旧产品路线改为 `blocked`；其实现和验收仍未完成。F54/F58/F59 保留原阻塞事实。根 Registry 当前无 active Feature，尚未创建新的原生实现合同。

后续应先阅读官方新版的结构和运行要求，明确原生路线范围，再建立独立合同与验证入口。旧根架构/协议继续作为 Fusion 历史设计和参考，不能自动当作原生路线规范；旧 gate 也不能直接验收新的 native-learning 分支。

恢复旧路线时，用两个固定归档提交和 manifest 还原同级 `OpenMAIC/`、`DeepTutor/` 及根 harness 布局，再按原合同重新确认验证条件。新线不合适时可以恢复旧代码，不需要删除当前数据或改写远程历史。

## GitHub 入口

- [OpenMAIC 新开发分支](https://github.com/ZhengRanCan/OpenMAIC/tree/native-learning)。
- [OpenMAIC 固定归档](https://github.com/ZhengRanCan/OpenMAIC/tree/991693431261be11ecb2569028245c76d91e1b3c)。
- [归档清单](https://github.com/ZhengRanCan/OpenMAIC/blob/991693431261be11ecb2569028245c76d91e1b3c/docs/archive/fusion-harness/2026-10-06/manifest.json)。
- [DeepTutor 固定归档](https://github.com/ZhengRanCan/DeepTutor/tree/24de083c39cf7ae88c04cc8ecfee443a06e63306)。
- [官方基线提交](https://github.com/THU-MAIC/OpenMAIC/commit/7230053af019b89c83d22dcab0a94f38fe193856)。
