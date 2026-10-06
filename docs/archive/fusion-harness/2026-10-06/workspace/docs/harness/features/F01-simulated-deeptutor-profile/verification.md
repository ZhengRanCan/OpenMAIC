# F01 验证计划

## 必需命令

| 层级 | 命令 | 必需 | 证据 |
| --- | --- | --- | --- |
| L2 功能测试 | `cd DeepTutor; node --experimental-transform-types --experimental-loader ./integrations/openmaic/fusion/tests/typescript-loader.mjs --test ./integrations/openmaic/fusion/tests/adapter.test.ts` | 是 | 确定性的 fixture、策略、上下文、白名单与最小化测试输出；仅需 Node.js 22+，不访问网络或模型服务 |
| 静态检查 | `git -C DeepTutor diff --check` | 是 | 无空白错误的命令输出 |
| Harness | `node scripts/harness-gate.mjs` | 是 | 门禁输出 |

## 人工验证路径

- [x] 使用 `demo-student-a` 和主题“一次函数”调用 Mock Provider，确认返回基础型、慢节奏、图像/具体情境/分步骤偏好的确定性画像。
- [x] 使用 `demo-student-b` 和相同主题调用 Mock Provider，确认返回进阶型、快节奏、公式/图像与挑战任务偏好的确定性画像。
- [x] 传入未知学生或不支持主题，确认返回明确错误，且没有返回默认画像。
- [x] 审阅 fixture，确认它仅包含合成证据；审阅生成 prompt，确认不包含学生 ID、显示名、原始 L3 文本或证据标签。

## 通过前的证据要求

- 在 `docs/log/artifacts/F01/verification-summary.md` 记录命令日期、完整命令、环境限制与结果。
- 代码改动后，在 `docs/log/artifacts/F01/subagent-review.md` 记录独立审查。
- 在将 feature 标为 `passing` 前，必须清空 `knownUnverified` 和 `humanReviewRequired`。
