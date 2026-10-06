# 课堂导出验证流程

本流程用于任何会导出 OpenMAIC 课堂的 Feature。目标是把“课堂看起来不错”的人工印象，变成可复跑、可定位场景证据的审查记录。

F03 是本地 Node.js 脚本，不启动 DeepTutor/OpenMAIC，也不调用外部 AI。

## 目录约定

```text
classroom/
├── Fx-.../                         # 本次测试导出的课堂，含 manifest.json
└── review/
    └── Fx/
        └── <测试批次>/              # F03 生成的审查结果
            ├── report.json
            ├── report.md
            └── ai-review.md
```

- 输入课堂目录由测试 Feature 自己命名，例如 `classroom/F02-A/second-prompt-fix/`。
- 所有审查输出必须放在 `classroom/review/Fx/<测试批次>/`；不要再放到 `classroom/F03/`。
- `<测试批次>` 建议使用能辨识实验条件的名字，例如 `fixed-prompt-v1`、`rerun-02`。

## 每次验证的步骤

1. 导出课堂，并保留对应的 `manifest.json`。
2. 新建测试声明 JSON。可复制 [F02 示例](harness/features/F03-classroom-manifest-audit/examples/F02-fixed-prompt.json)，改掉 Feature ID、样本路径和验收规则。
3. 为相同的受控 Prompt 记录相同的 SHA-256；不要默认把私人 Prompt 原文写入声明或报告。
4. 运行审查脚本。
5. 先阅读 `report.md` 的自动结论和场景证据，再使用 `ai-review.md` 做人工或外部 AI 的定性审阅。
6. 把本次是否通过、人工结论和限制记录回对应 Feature 的验证证据；不要只凭关键词命中宣称教学正确或画像有效。

## 测试声明应包含什么

| 字段 | 用途 |
| --- | --- |
| `testId` / `featureId` | 识别这次测试和所属 Feature。 |
| `artifacts` | 每组的 ID、组别、manifest 路径和受控输入指纹。 |
| `control.mustMatch` | 要求各实验组相同的字段；画像对照通常是 `promptSha256`。 |
| `manifestStandard` | 导出格式最低要求，如顶层字段、最少场景数、场景类型。 |
| `sharedRequirements` | 所有组都必须满足的教学要求。 |
| `groupRequirements` | 仅某一组必须体现的差异化要求，例如 A 的支架、B 的挑战。 |

每条教学要求可以同时包含：

- `automated`：可机械检查的 `allOf`、`anyOf`、`contentTypes`、`minScenes`；
- `aiReview`：要求审阅者作定性判断的问题。

## 命令模板

```powershell
node scripts/classroom-manifest-audit.mjs `
  --spec docs/harness/features/Fx-<name>/examples/<test>.json `
  --output classroom/review/Fx/<测试批次>
```

F02 当前实例：

```powershell
node scripts/classroom-manifest-audit.mjs `
  --spec docs/harness/features/F03-classroom-manifest-audit/examples/F02-fixed-prompt.json `
  --output classroom/review/F02/F02-fixed-prompt-v1
```

## 如何解读结果

- `report.json`：供后续脚本、表格或比较工具读取。
- `report.md`：结构规则、共同要求和分组要求的“通过/失败”，每项附场景编号和标题。
- `ai-review.md`：已脱去原始 Prompt、互动 HTML、音频和媒体索引的审阅材料；其中的跨组问题应以 baseline 为参照比较 A/B。

自动规则通过只能说明 manifest 中存在相应的可追溯证据。它不能证明内容事实正确、学生真正学会、或输出差异完全由画像造成。对照实验应至少固定 Prompt、模型与生成选项；有 baseline 时仍建议对每组重复生成。

## 失败处理

- manifest 缺失、JSON 无法解析或字段不满足标准：停止审查，修正导出物或声明后重跑。
- `promptSha256` 不一致：本次不构成受控 Prompt 对照，不能据此比较画像效果。
- AI/人工审阅与自动规则冲突：以证据重新审查规则；必要时调整测试声明并重新执行，不修改原始课堂导出物来“凑通过”。
