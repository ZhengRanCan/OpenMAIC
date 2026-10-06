# F06 验证计划

## 人工讨论路径

- [x] 确认真实 Adapter 层部署在何处，以及 DeepTutor、OpenMAIC 和浏览器各自的调用方向。
- [x] 确认最小学习上下文、课堂请求、课堂结果和回写结果的契约边界。
- [x] 确认身份映射、授权、状态流、失败恢复、幂等和审计的责任归属。
- [x] 用户审阅并确认 `ARCHITECTURE.md`，包括分片架构、Demo/Integrated MVP 边界与 SSOT 维护方案。

## 通过前的证据要求

- 在 `docs/log/artifacts/F06/verification-summary.md` 记录确认的决定、未决定事项和用户审阅结论。
- 从根目录运行 `node scripts/harness-gate.mjs`。
