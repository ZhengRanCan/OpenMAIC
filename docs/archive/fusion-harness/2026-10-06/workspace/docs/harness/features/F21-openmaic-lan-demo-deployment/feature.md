---
id: F21
title: OpenMAIC 局域网演示部署
version: v0.1
status: passing
dependsOn: ["F18"]
scope: {"code":["OpenMAIC/package.json","OpenMAIC/scripts/lan-demo.ps1","OpenMAIC/scripts/lan-demo-preflight.mjs","OpenMAIC/scripts/lan-demo-runner.mjs","OpenMAIC/next.config.ts","OpenMAIC/middleware.ts","OpenMAIC/app/layout.tsx","OpenMAIC/app/lan-demo/page.tsx","OpenMAIC/lib/fusion/lan-demo-classroom.ts","OpenMAIC/lib/i18n/locales/*.json"],"tests":["OpenMAIC/tests/scripts/lan-demo-preflight.test.mjs","OpenMAIC/tests/fusion/**"],"docs":["docs/harness/INITIALIZATION_CONTRACT.md","docs/harness/features/feature-index.json","docs/harness/features/F21-openmaic-lan-demo-deployment/**","docs/log/artifacts/F21/**","docs/harness/incidents/**","docs/progress.md"]}
evidence: {"lastVerifiedAt":"2026-07-26","commands":[{"command":"cd OpenMAIC && corepack pnpm test:lan-demo","result":"passed (15 tests)"},{"command":"cd OpenMAIC && corepack pnpm test -- tests/fusion/lan-demo-boundary.test.ts","result":"passed"},{"command":"cd OpenMAIC && corepack pnpm check:i18n-keys","result":"passed"},{"command":"cd OpenMAIC && OPENMAIC_LAN_DEMO_MODE=true OPENMAIC_LAN_DEMO_DATA=synthetic NODE_ENV=production corepack pnpm build","result":"passed"},{"command":"cd OpenMAIC && scoped eslint/typecheck/prettier and git diff --check","result":"passed"},{"command":"cd OpenMAIC && guarded production-like LAN smoke","result":"passed"}],"manualSmoke":"2026-07-26：合成配置下的真实预检、production build、固定 `/lan-demo` 的 Student A 内容、指定本机 LAN 地址绑定、CSP、首页/Provider API/logo 404 与受跟踪服务关闭后的端口关闭均已通过。演示者确认在校园网第二设备访问更新后的 `/lan-demo`，仅看到固定 Student A「一次函数」合成课堂；按 Ctrl+C 停服后该地址不可访问，并确认该校园网仅作为短期受控演示范围。"}
completionGate: {"version":"v0.1","l3":"required","userPath":["演示者可在受信任局域网内启动 OpenMAIC，并让另一台同网设备访问固定的 `/lan-demo` 合成学生 A「一次函数」只读课堂；演示结束后可停止服务且不暴露凭证或真实学生数据。"],"integrationEvidence":["2026-07-26：演示者确认校园网第二设备可访问更新后的 `/lan-demo` 固定合成课堂；停服后地址不可访问，并将该网络限制为短期受控演示范围。"],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"0621660aa934dbe65d579b2285e40c83f11e3541"}]}}
---

# F21 OpenMAIC 局域网演示部署

## 目标

为组会准备一个可重复、可停止的 OpenMAIC 局域网演示启动路径：演示主机以明确私网地址和端口监听，受信任局域网中的其他设备可访问；启动前检查端口、已有 Next 进程、Demo 配置与必要依赖。该 Feature 仅服务于短期受控演示，不构成公网、生产或多用户部署。

## 集成决策

- 集成宿主：OpenMAIC；以 production-like `next build`/`next start --hostname 0.0.0.0` 或等效受控启动方式提供 LAN 访问，不依赖浏览器直连 DeepTutor。
- 展示数据：只允许 F18 的隔离合成集成测试身份、固定 Demo 课堂或不含个人资料的预生成内容；禁止真实学生数据、真实课堂导出、Memory、Token、Cookie、`.env.local` 和本地数据库进入演示设备或证据。
- 网络边界：只允许演示者明确确认的私网网段和临时端口。不得自动创建宽泛防火墙规则、端口映射、反向隧道、云部署、公网暴露或绕过操作系统安全设置。
- 访问控制：此 Feature 不新增生产认证；演示者必须将其视为受信任的短期 LAN 展示。若网络无法受信任，应停止并改用本机演示，而不是扩大暴露范围。
- 运行边界：同一 OpenMAIC 目录只能启动一个 Next 实例；脚本必须检测已有端口/`.next` lock 并给出安全恢复提示，不得盲目杀死未知进程。

## 范围

### 允许改动

- 提供 LAN 启动与只读 preflight 脚本、`package.json` 命令、受控的 host/port 参数和必要的初始化文档。
- 提供固定的学生 A「一次函数」只读合成课堂页面；它不读取浏览器本地案例、Provider 设置、Cookie 或凭证，也不发起模型、DeepTutor 或课堂事件请求。
- 检查 Node/pnpm 构建产物、端口占用、已有实例、私网地址格式、Demo 模式与禁止的配置组合。
- 增加脚本单元测试、构建验证、同网设备人工烟测、演示关闭步骤和脱敏证据。

### 不在范围内

- 公网/云/容器/Kubernetes 部署、自动 Windows 防火墙修改、反向代理、TLS、生产多用户认证、真实身份/画像数据、凭证分发或外部网络穿透。
- 修改 DeepTutor 服务、F19 持久化实现、F20 Integrated MVP 验收逻辑或任何课堂业务功能。

## 验收标准

- [x] 演示者可用一条记录在文档中的 OpenMAIC 命令启动 LAN 服务，并获得可复制的私网 URL；已有实例/端口冲突会被明确报告。
- [x] 同一受信任局域网中的第二台设备可加载 Demo；浏览器请求仍只访问 OpenMAIC，未暴露 DeepTutor 地址、凭证或真实数据。
- [x] preflight 拒绝非私网地址、生产/真实数据配置、缺失构建产物和不安全的运行组合；不会自动修改防火墙或终止未知进程。
- [x] 演示完成后可按文档停止对应实例；关闭后端口不再可访问，演示证据不含敏感数据。
- [x] OpenMAIC 脚本测试、范围内 lint/build、独立审查、Git 提交/推送证据和 Harness gate 通过。

## 风险与兼容性

- Windows 网络配置、防火墙和企业网络策略是环境前置条件，脚本只能检测/说明，不能绕过它们。
- Next 开发服务器并非演示服务的安全边界；即使临时使用，也只能用于受信任局域网和合成 Demo 数据。
- 真实 AI 模型配置、外部 Provider 成本和网络连通性由演示者在本机安全配置；启动脚本不得输出密钥或配置值。

## 完成证据

- 验证证据：`docs/log/artifacts/F21/verification-summary.md`
- 独立审查：`docs/log/artifacts/F21/independent-review.md`
