# F60 路线冻结记录

日期：2026-10-06。

用户决定将既有 DeepTutor/OpenMAIC Fusion 工作归档，后续以 OpenMAIC 原生模块为重点，并要求新开发线先同步官方最新 `main`。

F60 的实施与验收尚未开始，因产品路线冻结从 `active` 改为 `blocked`。这不是技术验收失败，也不是实现完成；F54/F58/F59 的既有 blocked 状态和缺失证据不变。当前没有新的 active Feature，后续原生模块或保留改进需建立独立合同。

保存点：

- 原 OpenMAIC `fusion-adapter`：`33b01a2628f7d62031187221e8015f03ee4a894a`。
- OpenMAIC 归档代码及缓存忽略修改：`1c7282e5d429b6892f4273267d2a9a6e39c66aaf`；根 harness 快照将追加到同名归档分支，以 manifest 和分支最终 SHA 定位。
- 原 DeepTutor `fusion-adapter`：`bfb148ef8631bf76bf4075e154ee3b365431723b`。
- DeepTutor 归档及未验证的调试日志修改：`24de083c39cf7ae88c04cc8ecfee443a06e63306`。
- 两个 Fork 的归档分支名：`archive/fusion-2026-10-06`。

若恢复 Fusion 路线，应使用对应代码和根 harness 快照恢复原目录布局，重新明确当前 Feature 并执行原合同的必要验证。不能以归档提交代替验收，不能把历史未验证修改视为已 passing。
