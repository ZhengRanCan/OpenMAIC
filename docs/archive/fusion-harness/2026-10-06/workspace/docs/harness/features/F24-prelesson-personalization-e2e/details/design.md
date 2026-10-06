# F24 本地正式 Fusion 连接入口

页面在旧的 F02 演示画像卡片之前显示独立的“正式 Fusion（本地测试）”卡片。

```text
未配置 → 显示“服务器未配置 DeepTutor 连接”
已配置 → [测试连接]
测试成功 → [连接当前测试身份]
Session 成功 → “本次生成将使用正式 Fusion Session” → 进入课堂
```

连接测试和启动都只能调用 OpenMAIC 同源 API。浏览器永远不访问 DeepTutor、不会保留 DeepTutor Token，也不会显示服务器地址。测试失败提供可重试状态；正式 Session 失效时，生成页面应说明重新返回首页连接测试身份。

## 本地启动约定

只需要两个服务窗口：

1. DeepTutor 以 A 或 B 对应的 `FUSION_DEVELOPMENT_LEARNER_ID`、`FUSION_DEVELOPMENT_MOCK_ENABLED=true` 启动。
2. OpenMAIC 的现有 `.env.local` 保留本地 PostgreSQL 和外部 secret 文件配置，另增加：

   ```dotenv
   DEEPTUTOR_FUSION_BASE_URL=http://127.0.0.1:8001
   FUSION_DEVELOPMENT_UI_ENABLED=true
   ```

OpenMAIC 启动后，先在首页点击“测试连接”，再点击“连接当前测试学习者”。第二步由 OpenMAIC 的同源开发 route 向 DeepTutor 请求一次性 Launch Code，并立即调用既有 `/api/fusion/launch`；浏览器只短暂处理该一次性代码，并最终只保留不透明的 `lessonSessionId`。委托 Token、Profile、Map、服务地址和 PostgreSQL 凭证均不发送至浏览器。

连接成功后，卡片会把 allowlist 中的 `f24-synthetic-a` 与 `f24-synthetic-b` 映射为可读的“合成学习者 A（数据不足：保守引导）”或“合成学习者 B（已有观察：进阶应用）”。页面不显示原始 learner ID、完整 Profile 或知识图谱。

更换 A/B 时，只重启 DeepTutor 到另一套合成身份，再回到同一 OpenMAIC 页面重新测试并连接。编辑课程需求也会使页面中的正式 Session 失效，避免把先前冻结的上下文用于新需求。
