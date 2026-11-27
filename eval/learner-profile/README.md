# 离线学习画像实验

在 OpenMAIC 目录运行。无需启动网页或数据库。`direct` 复用正式新画像的四区 Memory 提示词、预算和状态校验，`two-stage` 在同一批输入前增加候选逐来源抽取。该抽取器不是正式 Quiz/Dialogue Evidence 接口，也不实现持久 Evidence 层。离线的事件分批、失败即停、模型参数和修正选项不等于生产队列；数据库授权、并发和队列行为仍由产品集成测试验证。

实验一另支持 `raw-history` 参考组，从相同的来源投影直接回答问题，不更新画像。配置增加 `"methods":["direct","two-stage","raw-history"]` 可同时运行三组，省略时仍按原来的两组执行。三组共用回答提示词与 `learningContext` 字段，只改变资料表示。`maxAnswerInputBytes` 默认 250,000 UTF-8 bytes，包含系统提示词和问题，超过上限记失败，完整历史不截断。

## 无密钥预检

```powershell
New-Item -ItemType Directory -Force eval/learner-profile/results | Out-Null
corepack pnpm eval:learner-profile validate --events eval/learner-profile/fixtures/events.json --questions eval/learner-profile/fixtures/questions.json --config eval/learner-profile/fixtures/config.json
corepack pnpm eval:learner-profile run --events eval/learner-profile/fixtures/events.json --questions eval/learner-profile/fixtures/questions.json --config eval/learner-profile/fixtures/config.json --output eval/learner-profile/results/my-fixture-01
```

输出目录的父目录必须存在，运行目录必须是新的。再次运行换一个目录。不会覆盖旧产物或原始输入。`fixture` 是确定性的协议回执，只用于检查调用、隔离、校验和报告，回答固定为 `unknown`，评分使用字面相等，其分数不代表任何模型能力。

## 真实模型技术预检

使用现有主机供应商配置，例如已配置的 `DEEPSEEK_API_KEY`。程序不自动载入 `.env.local`，配置中只写模型名称及运行参数，不写密钥。其他供应商按 OpenMAIC 的现有模型配置方式提供凭据。

将以下配置保存到被忽略的 `eval/learner-profile/local-data/live-config.json`，父目录自行创建。模型名称由运行者明确选择。

```json
{
  "mode": "live",
  "model": "deepseek:deepseek-v4-flash",
  "batchSize": 1,
  "maxCalls": 100,
  "timeoutMs": 90000,
  "maxRetries": 0,
  "maxOutputTokens": 6000,
  "temperature": 0,
  "checkpoints": [1, 5, 10, 20]
}
```

```powershell
corepack pnpm eval:learner-profile run --events eval/learner-profile/fixtures/events.json --questions eval/learner-profile/fixtures/questions.json --config eval/learner-profile/local-data/live-config.json --output eval/learner-profile/results/my-live-01
```

真实调用使用 `callLLM`，禁用模型 fallback、SDK 自动重试和 thinking。各阶段使用配置中的同一模型，同模型裁判需披露。`maxCalls` 是所有组及全部阶段合计上限，显式重试计入预算。超时不自动重试；调用异常由 `maxRetries` 控制，返回后的解析／校验错误由独立的 `validationRetries` 控制，后者默认关闭。超出修正次数的协议错误或暂缓决定保留为运行失败。

## 输入文件

事件和问题使用 JSON 数组或 JSONL，见 `fixtures/`。事件按学习者、原始序号排序，重复事件只计一次，同 ID 不同内容和冲突顺序被拒绝。一个事件最多 16 个 part，`batchSize` 控制每轮事件数，共享内核的来源批量最多 16 项，容量退让时可拆成多个调用。批次包含多个事件时，检查点按实际批次终点记录，最终状态始终导出。

- 事件包含 `id`、`learnerId`、`ordinal`、`occurredAt`、`kind`、`origin` 和 `parts`。Quiz 保留题目、实际作答及评分，QA／Discussion 的 `answer` 是学生发言，`previous` 保留可见的教师／学生前文。帮助只能是已记录的条件或 `unknown`。
- 公开正误日志可省略实际 `answer`，同时提供题目和正确／错误判定。投影明确 `answerAvailable=false`，不伪造提交。原始时间无时区时存于 `recordedTime`，`occurredAt=null`，不擅自指定时区。
- 评测问题包含 `id`、`learnerId`、`category`（IE／MR／HC）、`question`、`gold` 和可选 `sourceIds`。Gold 文件不会传入抽取或维护模型。每组所有回答保存后再逐题评分。
- 各组初态为空。旧来源只从本组当前画像仍支持的记录回读，内容预览以 512 码点为目标；关键元数据不截断，过长时由输入容量退让省略旧正文。两阶段保存本方法抽取表示供后续回读，原始事件仍单独供人工核对。
- 首轮回答只读取最终 Memory 正文和问题，排除 supports 内的原文。按需检索原始历史是另外的实验条件。
- `raw-history` 将同一截止点的全部共同可见来源按顺序提供给回答器，没有 Memory 维护成本。该组没有画像快照或画像陈述，结果中的空快照不表示丢失数据，实际回答输入在调用日志中。

## LongTutor 最小导入

从 [LongTutor 固定版本](https://github.com/liano3/LongTutor/tree/ba40af3b9e976f5960c42a15a645c0e9c3a7d718/data/XES3G5M) 取得 `sequences_long.jsonl`、`questions.jsonl`、`human_an_updated.jsonl`，在本地保存。文件及逐人结果勿提交。导入在本机完成，不调用模型。

```powershell
New-Item -ItemType Directory -Force eval/learner-profile/local-data | Out-Null
corepack pnpm eval:learner-profile import-longtutor --sequences PATH/sequences_long.jsonl --bank PATH/questions.jsonl --gold PATH/human_an_updated.jsonl --limit 3 --output eval/learner-profile/local-data/lt-dev-01
corepack pnpm eval:learner-profile validate --events eval/learner-profile/local-data/lt-dev-01/events.json --questions eval/learner-profile/local-data/lt-dev-01/questions.json --config eval/learner-profile/fixtures/config.json
```

导入按作者 XES 题目渲染方式，用 `uid||SHA256(当前题文本)` 关联 Gold；只有本机关联保留当前题结果和时间，模型背景严格移除二者。当前题不进入历史。历史与背景知识点统一按 `----` 分段，保留选项顺序和参考答案。题库答案／解析不进入历史。Q1／Q2／Q3 对应 IE／MR／HC，兼容没有题号的旧标注。v1 导入背景曾误带当前结果，必须重新导入到新目录，不能复用旧问题文件。将历史截短后不可沿用完整历史的 Gold。

`--limit` 控制成功关联的学习者数，导入报告给出扫描数、关联数、缺题、文件哈希与缺失字段。少量扫描结果不代表全量关联率，导入样例作为开发数据。若有关联缺口，报告保留数量，不按 uid 直接猜配。

公开数据进入真实模型前需在配置中明确 `allowPublicExternal=true` 和实际的 `permissionNote`，核定所取发行版本、研究用途及第三方处理权限。首轮技术预检用可提交的合成材料即可，许可未核定时只做本地导入。私有课堂、生产库和用户本人画像没有默认使用授权。

## 产物与评分

| 文件 | 内容 |
| --- | --- |
| `manifest.json` | 提交、脏工作树标志、执行源文件指纹、数据及配置指纹、模型、可见范围与评分条件 |
| `calls.jsonl` | 每次派发和完成回执，含方法、学习者、问题、阶段、实际输入输出、用量和失败。相同 index 的最后一条是当前状态，只有派发记录时结果未知 |
| `steps.jsonl` | 所有批次的前后画像、来源处理决定、调用索引和选定检查点标志 |
| `results.json` | 每个学习者两组的最终画像、完成状态和逐题结果 |
| `report.json` | 分任务、分方法的问答结果、覆盖、调用数、耗时、可获得 Token 与共同有效题差值 |
| `review.json` | 人工核对画像陈述的本地表，附该片段引用的原始事件，初始尚未评分 |
| `completed.json`／`failed.json` | 程序终态。部分方法或题目失败时仍保存报告，退出码为 1 |

问答按含义由本地模型裁判评分，不是官方评分器的复现。`accuracy` 仍为 correct/scored；`confirmedCorrectOverExpected` 是全部预期题中的已确认正确比例，未确定评分不在此指标中获得正确分，但也未被重新判为错误。`scoringCoverage`、`unresolved` 保留评分缺口。`explicitUnknownAnswers`／`explicitUnknownOverExpected` 是句首未知表达的词法计数，不是可靠的语义弃权判定，不修改裁判结果。已知事实回答不知道应判 false，仅参考本身不可解释才允许 null。共同有效题差值仍可能受缺失影响，不能脱离覆盖率排序。非零调用的用量不可得记 null 并计缺失；零调用用量为 0。

`validationRetries` 默认 0，可显式设为 1 或 2。它在模型成功返回后对解析／内核校验失败补充错误码并修正，逐次保留 validationAttempt／validationError 和全部用量。它不会重放超时等未知结果，不复现生产队列恢复行为。报告按阶段列首轮失败和修正次数，不能只用最终完成率描述可靠性。网络重试仍由独立的 `maxRetries` 控制。

两阶段只替换语义正文，程序保留序号、题号、时间、正误、作答可用性和知识点；旧来源继续使用本方法的抽取表示。入模批次及旧文本退让先按原始新来源规划，替换后只检查容量，不恢复已退让文本或改变批次；抽取扩张导致超限时明确失败。回答的 raw-history 为结构化对象数组，仅序列化一次。Memory-only 包含条件，不含支持原文。

三组报告在 `comparisons` 中按明确的 baseline／comparison 及 IE／MR／HC 给出两两配对差值。`paired` 继续保留两组 Memory 的旧差值字段。每种方法的 `stages` 分开统计 extract、memory、answer 和 judge，便于区分构建开销与回答开销。裁判输出 null 会保留不可判定理由并导致运行不完整，不作为正常成功或错误答案悄悄计分。

人工核对时把复合陈述拆成可独立判断的事实行，保留片段和来源身份。填写 `judgment` 为 `supported`、`contradicted` 或 `insufficient`，并记录 `reviewer`、`reason`。保存为新的本地文件后运行：

```powershell
corepack pnpm eval:learner-profile review-report --review PATH/review-scored.json
```

未填行计 pending，按 method／complete 分组；旧文件未记录这些字段时列 legacy-unknown／null，不猜测完成状态。review.json 记录最后完整批次、停止位置和快照版本；失败批次内若有部分更新，不能把最后完整批次视为快照的精确截止点。问答正确不代表所有陈述有据；中途无前缀 Gold 时只核对轨迹。

## 测试

```powershell
corepack pnpm exec vitest run tests/eval/learner-profile
```

共享正式 runner 的改动另跑 `tests/learner-memory/profile-memory.pg.test.ts`，`PG_CONTRACT_URL` 指向专用 PostgreSQL 测试库。用例新建自己的 schema，不将实验指向生产库。模型、规则、数据和提示词应在正式留出评测前冻结，原始回执、错误和历史评分保留。
