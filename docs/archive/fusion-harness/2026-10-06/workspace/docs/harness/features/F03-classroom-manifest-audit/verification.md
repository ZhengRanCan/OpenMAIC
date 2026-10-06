# F03 验证计划

## 必需命令

| 层级 | 命令 | 必需 | 证据 |
| --- | --- | --- | --- |
| L1 静态 | `node --check scripts/classroom-manifest-audit.mjs` | 是 | F03 验证摘要 |
| L2 功能 | `node scripts/classroom-manifest-audit.mjs --spec docs/harness/features/F03-classroom-manifest-audit/examples/F02-fixed-prompt.json --output classroom/review/F02/F02-fixed-prompt-v1` | 是 | 输出的 `report.json`、`report.md` 与 `ai-review.md` |
| L2 回归 | `node --test docs/harness/features/F03-classroom-manifest-audit/tests/*.test.mjs` | 是 | 测试输出 |
| Harness | `node scripts/harness-gate.mjs` | 在标记 `passing` 前必须执行 | 验证摘要 |

## 人工验证路径

- [x] 确认 F02 baseline、A、B 示例均指向各自的 `second-prompt-fix/manifest.json`，并使用相同的受控 Prompt SHA-256。
- [x] 打开 `report.md`，确认共同教学要求、baseline、A 要求、B 要求分别列出结论和场景证据。
- [x] 打开 `ai-review.md`，确认其中没有原始 Prompt、互动 HTML、音频文件名或媒体索引。
- [x] 用户明确接受不执行教师/AI 定性审阅；报告仅保留自动规则证据，不将其表述为教学有效性结论。

## 通过前的证据要求

- 在 `docs/log/artifacts/F03/verification-summary.md` 记录命令、日期、测试声明、输出目录及结果。
- F03 只改根级 harness 脚本，不改 Fork 代码；Fork Git 证据和独立 Fork 代码审查不适用。标记 `passing` 前清空 `knownUnverified` 与 `humanReviewRequired`。
- 如果根级 harness 已建立为 Git 仓库，需在完成前补充其提交/推送证据；不得伪造为 OpenMAIC 或 DeepTutor 的提交。
