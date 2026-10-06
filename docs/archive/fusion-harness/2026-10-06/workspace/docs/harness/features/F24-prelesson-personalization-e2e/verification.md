# F24 验证计划

## v0.2 完成记录（2026-07-30）

本节优先于下方 v0.1 的课中/课后人工路径；F24 v0.2 仅验证课前正式生成，课中与课后运行时验证已移交 F26/F27。

- [x] 用户确认同一固定短课堂要求下的 baseline、正式 A、正式 B 均已生成；A/B 在生成前使用首页正式连接，F02 Demo 未作为正式路径证据。
- [x] 五份现有导出（含两份归类为 baseline 的误跑样本）由 F03 审查，0 项自动失败；人工审查观察到 A 的支架方向与 B 的应用/挑战方向。
- [x] 正式 Session 到冻结教学上下文、outline/content/actions 的服务器绑定由 `generation-session` 与客户端传播测试验证；测试为 2 files、5 tests 通过。
- [x] 相关类型检查、ESLint、Git 证据和 Harness gate 通过；独立审查报告建议 F24 v0.2 通过。
- [x] 证据未包含 Token、Cookie、Session ID、Profile、Map 原文或数据库记录。个别历史导出不能单独反证或证明正式 Session；该事实由用户操作确认和服务端强制绑定测试共同支撑。

## 自动验证

- 在 DeepTutor 运行两个 allowlist 合成身份的 Launch、Profile/Map 授权、差异、隔离与清理测试。
- 在 OpenMAIC 运行全部 Fusion、正式生成接入和无密钥回归测试。
- 运行两 Fork 的范围 lint/类型检查或 Python 静态检查、构建和 `git diff --check`。
- 从根目录运行 `node scripts/harness-gate.mjs`。

## 人工验证路径

- [ ] 执行前由用户确认固定短课堂要求、模型、生成配置、三次真实生成的费用上限、A/B 合成身份和预期差异。
- [ ] 生成普通 baseline、正式 Fusion A 和正式 Fusion B；确认 A/B 均来自 DeepTutor Launch 与 HttpOnly Cookie 权威 Session，F02 Demo 未参与。
- [ ] 导出三门课堂，使用本 Feature 目录中的测试声明运行 F03 CLI，将报告写入 `classroom/review/F24/<测试批次>/`。
- [ ] 审阅共同要求、A/B 差异、checkpoint 与 remediation 证据；明确记录未满足项和单次生成限制。
- [ ] 任选 A/B 完成一次 checkpoint 诊断、Scene 调整和课后 closeout，确认课前教学上下文未变化。
- [ ] 清理 Launch Code、Cookie、合成测试记录、临时配置、服务进程、数据库卷和不需要的原始导出。

## 通过前的证据要求

- 记录课堂要求 hash、生成配置摘要、脱敏 F03 报告、Session/revision 关联、课中/课后结果和清理结果。
- 不记录 Token、Cookie、`.env`、真实用户资料、原始 Memory、完整 Prompt、本地数据库或未脱敏课堂内容。
- `knownUnverified` 与 `humanReviewRequired` 清空后才能标记 passing。
