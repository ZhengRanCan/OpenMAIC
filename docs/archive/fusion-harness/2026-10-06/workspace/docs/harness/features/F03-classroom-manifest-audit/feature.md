---
id: F03
title: 通用课堂 Manifest 审查
version: v0.1
status: passing
dependsOn: ["F02"]
scope: {"code":["scripts/classroom-manifest-audit.mjs"],"tests":["docs/harness/features/F03-classroom-manifest-audit/tests/**"],"docs":["docs/classroom-review-workflow.md","docs/progress.md","docs/decisions.md","docs/harness/features/F03-classroom-manifest-audit/**","docs/log/artifacts/F03/**","docs/harness/incidents/**"]}
evidence: {"lastVerifiedAt":"2026-07-23T00:00:00.000Z","commands":[{"command":"node --check scripts/classroom-manifest-audit.mjs","result":"passed","runAt":"2026-07-23","summary":"语法检查通过。"},{"command":"node scripts/classroom-manifest-audit.mjs --spec docs/harness/features/F03-classroom-manifest-audit/examples/F02-fixed-prompt.json --output classroom/review/F02/F02-fixed-prompt-v1","result":"passed","runAt":"2026-07-23","summary":"审查 3 份 F02 导出物，0 项自动规则失败。"},{"command":"node --test docs/harness/features/F03-classroom-manifest-audit/tests/*.test.mjs","result":"passed","runAt":"2026-07-23","summary":"2/2 回归测试通过。"}],"manualSmoke":"用户明确接受 F03 v0.1 不再执行实际 AI/教师定性审阅；自动报告与脱敏审阅包已生成。"}
completionGate: {"version":"v0.1","l3":"not_required","userPath":["课程设计者以测试声明 JSON 指定一个 Feature 的本地导出课堂，并获得可追溯的规则报告与 AI 审阅包。"],"integrationEvidence":["docs/log/artifacts/F03/verification-summary.md"],"knownUnverified":[],"humanReviewRequired":[]}
---

# F03 通用课堂 Manifest 审查

## 目标

提供一个无外部依赖的本地 CLI。它读取某次 Feature 测试的声明 JSON 和其中列出的 `manifest.json`，输出：

- 可重复的结构与文本规则报告；
- 每条规则对应的场景编号、标题和命中词；
- 不含原始 Prompt、音频、互动 HTML 或凭证的 AI 审阅包；
- 供人工或选定 AI 填写的中文审阅问题。

它使 F02 的固定 Prompt baseline/A/B 对照成为第一个实例，但规则、样本数和 Feature ID 均由声明 JSON 决定，不能将 F02 的“一次函数”词汇写死在程序中。

## 产品与边界决策

- F03 是根目录 harness 工具，不是 DeepTutor 或 OpenMAIC 的运行时集成；不修改两个应用，也不读取其 Dexie、`localStorage`、数据库、用户目录或模型设置。
- 输入仅为用户显式导出的本地 `manifest.json`。`classroom/` 是本地测试产物目录，不是跨用户、跨设备或生产课堂的权威存储。
- 测试声明只记录 `promptId` 与 `promptSha256`，默认不保存 Prompt 原文。任何包含私人内容的课堂在提交给外部 AI 前，必须由操作者自行审阅、脱敏并获授权。
- F03 的确定性规则可以报“通过/失败”；AI 审阅只能给出带场景证据的辅助意见，不能自动宣称课程事实正确、教学有效或真实学生学习有效。
- 输出目录统一为 `classroom/review/Fx/<测试批次>/`，由操作者显式传入；生成物不得被当成 Git 证据或自动纳入版本控制，除非经人工脱敏审阅。

## 范围

### 允许改动

- 增加根级 Node.js 审查脚本、F03 合同、验证计划、F02 示例声明与非敏感测试 fixture。
- 从 manifest 提取课程名称、场景顺序/标题、内容类型、画布文字、LaTex 和课堂动作文字；忽略互动 HTML、音频和媒体二进制文件。
- 基于声明中的通用关键词、内容类型和最小场景数进行检查，输出 JSON/Markdown 报告和 AI 审阅包。

### 不在范围内

- 调用外部模型、读取或保存 API Key、将课堂自动上传至任何服务，或在浏览器内增加 UI。
- 以关键词命中替代教师审核、教学质量保证、事实核验或真实学习效果评估。
- 修改 F01/F02 的画像、生成逻辑、课堂导出格式，或把 `classroom/` 作为正式的应用数据源。

## 测试声明模型

声明 JSON 必须包含 `testId`、`featureId`、`artifacts`、`manifestStandard`、`sharedRequirements` 和 `groupRequirements`。

- 每个 artifact 声明 `id`、`group`、`manifest` 和受控输入指纹。
- `manifestStandard` 声明顶层必需字段、最少场景数和必需内容类型。
- 每条教学要求包含自然语言 `requirement`、可选 `automated` 规则和 `aiReview` 问题。
- `automated` 支持 `allOf`、`anyOf`、`contentTypes` 和 `minScenes`；AI 审阅包仍会保留所有要求，即使它没有自动规则。

## 验收标准

- [x] 对任意声明 JSON，CLI 能在不启动 DeepTutor/OpenMAIC、不使用密钥的情况下读取多个 manifest，并输出 `report.json`、`report.md` 与 `ai-review.md`。
- [x] 报告能区分 manifest 结构失败、共同要求、分组要求和受控输入一致性；每个文本规则均能定位到场景顺序和标题。
- [x] F02 baseline/A/B 示例使用同一个 Prompt SHA-256，且不将 Prompt 原文写入输出。
- [x] 提取过程不把互动 HTML、音频或媒体索引全文写入 AI 审阅包。
- [x] F02 示例的人工审查路径与已导出的 baseline/A/B manifest 一致；报告明确它只能审查输出差异，不能由单轮三份产物单独证明真实学习效果或排除模型随机性。

## 风险与兼容性

- OpenMAIC 导出格式会演化；F03 对格式不兼容时必须报告缺失字段，不可静默给出“通过”。
- LLM 课堂输出有随机性。受控 Prompt 哈希相同只证明测试声明一致；F02 已纳入同 Prompt 无画像 baseline，但仍推荐对每组重复运行，不能由单轮结果证明真实学习效果。
- 外部 AI 审阅会带来数据披露、费用与非确定性风险，因此 v0.1 只生成审阅包；是否接入具体服务商留待单独批准的 Feature。
