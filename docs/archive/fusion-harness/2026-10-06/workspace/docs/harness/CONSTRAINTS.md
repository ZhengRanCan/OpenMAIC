# Constraints

## 交付边界

- 同一时刻只有一个 `active` feature；先更新该 feature 合同，再扩大产品、架构、数据、AI、安全或视觉范围。
- 不改变上游公开行为、数据格式、许可证或大范围代码，除非合同列出影响、兼容/回滚策略和验证证据。
- 两个 Fork 继续独立安装、运行、测试和提交；根目录不得添加伪统一的依赖、数据库或运行时。

## 数据、身份与安全

- 不提交 API Key、令牌、Cookie、真实用户资料、生产课堂、知识库、聊天记录、`.env.local`、`data/` 或本地数据库。
- 浏览器不得持有供应商密钥或跨应用持久身份权限；外部 AI、搜索、媒体、文档解析和 URL 访问必须保持服务端密钥边界，并有输入、超时和错误处理。
- 未有明确授权、身份映射与权限检查前，不得把 OpenMAIC 的 `localStorage`、IndexedDB 或 Dexie 当作跨用户、跨设备或服务端可信记录。
- 跨应用只传最小必要、可追溯且版本化的数据。不得直接读写对方内部文件、数据库或浏览器状态。
- F16 Launch Code 仅向明确授权的测试用户签发，TTL 为 5 分钟且一次性消费；未使用 Code 必须可按 codeId 撤销。生产环境 auth-disabled 或 Mock issuer 启用均为配置错误并拒绝发码。委托凭证仅限 profile:read、diagnosis:request、classroom-event:write、profile-update:submit，绑定 learnerId、OpenMAIC audience、lessonSessionId、expiration 与 tokenId；浏览器不得接触该凭证。开发凭证仅可通过环境变量保存，生产 Secret Manager 选型为 TBD，且不允许认证失败回退到高权限全局凭证。

## AI 与教学

- 模型输出、关键词命中和单次对照结果不能直接证明事实正确、教学有效或真实学习效果。
- 涉及生成、评分、建议或自动行动时，界面必须显示状态、失败原因和恢复入口，并提供与风险相称的人工审阅。
- 向外部服务发送学习上下文、附件、课堂内容或导出物前，feature 必须说明最小字段、用途、授权、保存与退出机制。

## 工程与证据

- 每项变更必须有与风险相称的静态检查、功能测试、构建或人工路径；结果写入当前 feature 证据。
- 修改 Fork 代码的 feature 通过前还需独立审查、所属 Fork 的提交/推送证据和 `node scripts/harness-gate.mjs`；根级 harness 文档或脚本不冒充为 Fork 提交。
- UI 变更覆盖相关的加载、空、失败、无权限和恢复状态，并按合同完成目标视口的人工验证。
