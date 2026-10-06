# 本地运行与验证

根目录没有统一应用、`package.json` 或虚拟环境。DeepTutor 与 OpenMAIC 必须在各自目录使用自己的依赖和命令；harness 只提供无外部依赖的 Node.js 审查脚本。

## 目录与命令

| 目标 | 目录 | 常用命令 |
| --- | --- | --- |
| DeepTutor 服务 | `DeepTutor/` | 在已配置的 Python 环境中执行 `deeptutor start`。首次安装、模型配置和 Web 开发以该仓库 README 为准。 |
| OpenMAIC 开发服务 | `OpenMAIC/` | `corepack pnpm dev:windows`（Windows 推荐）；或 `corepack pnpm dev`。首次依赖安装：`corepack pnpm install`。 |
| OpenMAIC 静态/测试 | `OpenMAIC/` | `corepack pnpm lint`、`corepack pnpm test -- <目标测试路径>`、`corepack pnpm build`。 |
| Harness | 根目录 | `node scripts/harness-gate.mjs`；课堂导出审查见 `docs/classroom-review-workflow.md`。 |

## 当前本机 DeepTutor Python 环境

当前工作站已确认可用于 DeepTutor 服务与 Python 验证的 Conda 环境为 `skill`。在 PowerShell 中先执行：

```powershell
conda activate skill
```

随后进入 `DeepTutor/` 运行对应命令，例如 `deeptutor start` 或 Feature `verification.md` 指定的 `python -m pytest ...`。

`skill` 是当前机器的本地环境名称，不是仓库内的依赖锁定、CI 环境名称或其他开发者必须使用的名称。新机器仍须按 DeepTutor 的安装文档创建/选择满足项目依赖的 Python 环境；不要把 Conda 路径、`.env`、Token 或本地数据写入仓库。

运行真实 AI 生成前，按对应上游的安全方式配置本地模型服务商；不得将 `.env.local`、令牌、真实用户数据或生产课堂写入 harness 证据。

## 验证原则

- 每个 feature 的 `verification.md` 是唯一的必需命令清单；只执行与改动风险相称的检查。
- UI 或真实生成路径需要人工验证时，记录所用模式、可复现步骤和不含敏感数据的结果。
- `node scripts/harness-gate.mjs` 在 feature 标记 `passing` 前必须通过，但它不替代应用测试、构建或人工路径。
- OpenMAIC 开发服务同一目录只能启动一个实例。端口或 `.next/dev/lock` 冲突时，先停止遗留的 `node`/Next 进程，再重新启动。

## OpenMAIC 受信任局域网演示

F21 只用于短期、受信任的私有 LAN 展示，不是公网或生产部署。演示者先在现场确认使用的 RFC 1918 IPv4 地址、端口、允许访问的设备范围和 Windows 防火墙临时规则；脚本不会创建或修改防火墙规则、端口映射、反向隧道或云部署。

在 `OpenMAIC/` 中运行（将示例地址换成已确认的本机私有 LAN 地址）：

```powershell
corepack pnpm lan-demo -- -LanAddress 192.168.x.x -Port 3000 -ConfirmLan
```

该命令先以合成 Demo 配置进行只读预检，再执行 `next build` 与绑定所确认私网地址的 `next start --hostname <LanAddress>`。预检会拒绝非私有或非本机接口地址、缺少构建产物、端口/同目录 Next 实例/`.next` 锁冲突、`.env*` 文件，以及当前终端中任何 API key、Token、Secret、Provider URL、Fusion 持久化或凭证配置。它只报告变量名，绝不打印值；如需清除某个继承到当前终端的变量，只在该终端运行 `Remove-Item Env:<变量名>` 后重试，不要修改系统设置。

启动成功后，仅将输出的 `http://<私有地址>:<端口>/lan-demo` 提供给已确认的同一 LAN 设备。该固定学生 A「一次函数」页面是只读合成课堂，不依赖浏览器本地案例、模型设置或外部服务；浏览器 CSP 限制连接目标为 OpenMAIC 自身。演示结束时按 `Ctrl+C` 停止服务，再从第二台设备确认端口不可访问，并删除任何非脱敏临时材料。

## OpenMAIC 局域网共享工作区

F22 与 F21 是两条不同路径：F21 的 `lan-demo` 仍是无 Provider 的固定合成页面；需要让同网设备使用正常 OpenMAIC 界面、看到主机模型目录和已发布案例时，使用 F22。

先仅在 OpenMAIC 主机上创建被 Git 忽略的 `server-providers.yml`。其中填写当前本机已验证的 Provider 配置；示例中的占位符必须替换为主机自己的值，不能粘贴到聊天、截图、仓库或其他设备：

```yaml
providers:
  deepseek:
    apiKey: <host-only-key>
    baseUrl: <host-only-relay-url>
    models:
      - deepseek-v4-pro
      - deepseek-v4-flash
```

启动前从主机浏览器访问一次正常 OpenMAIC 首页，确认 Provider 和本地案例正常。随后在 `OpenMAIC/` 执行（将地址替换为已确认的主机私网 IPv4）：

```powershell
corepack pnpm lan-shared -- -LanAddress 192.168.x.x -Port 3000 -ConfirmLan
```

该命令以 `next build`/`next start --hostname 0.0.0.0` 运行正常 OpenMAIC：主机继续打开 `http://localhost:<端口>`，以访问已有浏览器 IndexedDB；访问者打开 `http://<私有地址>:<端口>`。浏览器 origin 包含端口，因此必须使用你之前本地工作区所用的相同端口（通常为 3000），否则旧案例不会显示。预检仍确认该私网地址属于主机。现有 `/api/server-providers` 仅发送可用 Provider ID 与模型清单，真实 Key 和 Provider URL 仍只在主机服务端解析。

首次共享既有课程案例时，在任一访问者浏览器的“最近学习”栏选择“发布到局域网”。这会将该浏览器的本地 Stage/Scene 复制为主机服务端的共同共享副本，且不会删除或覆盖原浏览器 IndexedDB 数据。访问者可打开共享案例；它会成为该访问者自己的浏览器工作副本，编辑或删除不会自动回写共同源，只有再次选择“发布到局域网”才会更新共同源。演示者明确选择了此短期 LAN 协作语义，因此任何同网访问者都可发布；不要在不受控网络中使用。已在浏览器本地 Blob 中、但未序列化进课堂内容的图片/视频媒体不会批量迁移，缺失时按课堂现有回退显示。

演示结束按 `Ctrl+C` 停止服务，再从第二台设备确认入口不可访问。`server-providers.yml` 与运行生成的 `data/` 内容均为主机本地运行材料，不提交到 Git；只删除本次明确生成的临时共享副本，避免误删主机既有案例。
