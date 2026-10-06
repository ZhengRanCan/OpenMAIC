# F20 验证计划

## 必需命令（实施时执行）

- 在 DeepTutor 和 OpenMAIC 分别运行真实 Fusion API、Provider、持久化与 E2E 测试。
- 执行已批准的安全/权限/故障演练，不在日志或 artifact 中保留敏感数据。
- 分别执行质量检查、独立审查、Fork Git 推送验证和 `node scripts/harness-gate.mjs`。

## 人工验证路径

- [x] 仅以 `ENVIRONMENT=test` 与已 allowlist 的合成 learner 启动 DeepTutor；不要在日志、截图或本文件中记录 Launch Code、委托 Token 或服务账号 Token。
- [x] 在 OpenMAIC 的未提交 `.env.local` 中配置本地 Docker PostgreSQL URL、DeepTutor URL、`FUSION_PERSISTENCE_MODE=local_postgres` 和仓库外 Secret 文件路径；缺失任一项时确认启动报错不回显配置值。
- [x] 交换一次 Launch Code 后，确认浏览器只收到 HttpOnly `openmaic_fusion_session` Cookie，且 PostgreSQL `fusion_sessions` 仅有 `credential_ref` 与冻结的 Profile/Map 快照，不含 `token`、`secret`、`password` 或 Launch Code。
- [x] 提交一个正确和一个错误 checkpoint，并故意提交伪造的 `learnerId`、`lessonSessionId` 或 mapping 字段；确认 DeepTutor 收到的事件仍使用 Cookie 恢复的权威会话，且诊断失败返回可恢复错误、不会回退 F08 Mock。
- [x] 调用 `lesson-completed`，确认 `fusion_lesson_completions` 和 `fusion_outbox` 同时出现或同时缺失；课堂总结必须显示即时课堂完成、画像更新已排队/重复/保存失败以及 `longTermProfileStatus=not_confirmed`。
- [x] 从仓库外 Secret 文件提供受限的本地服务账号引用，运行 `processOneConfiguredFusionOutbox()`；确认 accepted 后重复投递为 duplicate，复用原 `candidateId` 与 `idempotencyKey`，且跨 learner 的提交被 DeepTutor 拒绝。
- [x] 分别演练 Profile、诊断、更新、Outbox、会话和认证故障，确认可理解降级与恢复；审阅浏览器、日志、导出和数据库记录，确认没有 DeepTutor 凭证、原始 Memory 或越权数据。
- [x] 演练结束后停止本地服务，并允许删除 Docker 测试卷与仓库外测试 Secret 文件。
