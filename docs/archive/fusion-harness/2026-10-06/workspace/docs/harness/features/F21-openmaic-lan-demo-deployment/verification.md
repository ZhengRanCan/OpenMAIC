# F21 验证计划

## 必需命令（实施时执行）

| 层级 | 命令 | 目的 |
| --- | --- | --- |
| 脚本测试 | 在 `OpenMAIC/` 运行 LAN preflight 测试 | 验证私网/端口/Demo 配置拒绝与提示。 |
| 构建 | 在 `OpenMAIC/` 运行 `corepack pnpm build` | 验证 production-like 演示构建。 |
| 质量 | 在 `OpenMAIC/` 运行范围内 lint 与 `git diff --check` | 检查脚本与配置改动。 |
| Harness | 根目录运行 `node scripts/harness-gate.mjs` | 验证 Feature 状态与 Harness。 |

## 人工验证路径

- [x] 在演示主机上执行 preflight 与 LAN 启动命令，记录私网 URL、端口和启动时间；确认没有已有 Next 实例冲突。
- [x] 用同一受信任局域网的第二台设备访问 URL，完成一条固定 Demo 路径；检查浏览器网络不直连 DeepTutor。
- [x] 尝试不安全配置（非私网地址、真实数据/生产模式、端口占用），确认脚本停止并给出安全提示。
- [x] 按文档关闭服务，从第二台设备确认端口不可访问；删除任何临时脱敏截图以外的演示产物。

## 通过前的证据要求

- 记录脱敏的启动命令、私网 URL 形式、第二设备烟测、关闭步骤及端口关闭结果。
- 不记录真实 IP 全量、设备名、Token、Cookie、`.env`、真实学生资料、数据库或完整模型 Prompt。
