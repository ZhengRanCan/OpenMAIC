# Pre-class Fusion 产品语义：Context Consumption 与 Output Alignment

> 本文只记录 FUSION/11 第一项讨论的产品语义，不是 Feature 合同、架构 SSOT、schema 规范或实现授权。它暂不决定 Prompt 形状、评估器、数据库、状态字段、覆盖阈值或用户编辑策略。

## 讨论范围

课前 outline shaping 的核心不是证明“DeepTutor 的响应被成功传输”，而是分别讨论两个独立的产品目标：

```text
Context Consumption
  DeepTutor 的课前教学语义确实进入并参与了 OpenMAIC 的 outline generation。

Output Alignment
  最终 outline，必要时结合 scene 的局部证据，确实体现了这些课前教学语义。
```

二者不能被合并成单一的 `personalized`、`DeepTutor-aligned` 或“个性化生成成功”结论。它们分别回答两个不同的问题：第一，DeepTutor 的语义有没有真正参与生成；第二，生成结果有没有表现出相应的课程设计方向。

## Context Consumption 的产品定义

**Context consumption** 指 outline-generation 过程实际使用了由 DeepTutor `PreClassTeachingContextProposal` 提供、并已经经过验证和冻结的课前教学语义。这里的语义可以包括当前课程目标、授权知识范围、前置关系、与本课程相关的学习者投影、教学重点、顺序考虑、评估关注点和明确排除项。

Context consumption 强于“收到”或“保存” Proposal。以下事实单独成立时，都不足以证明发生了 consumption：

- OpenMAIC 收到了 Proposal；
- Proposal 被保存进 lesson session；
- Proposal 出现在日志或元数据中；
- Proposal 被序列化，或被附加到 outline prompt；
- 生成接口成功返回了一个合法 outline。

Prompt 可以是承载上下文的一种方式，但“Proposal 出现在 Prompt 中”不是产品定义，也不是充分证据。产品要求是：DeepTutor 的语义成为 outline-design task 的有意义组成部分，而不是装饰性文字、未使用的附件，或被通用 outline 模板静默覆盖的附加指令。

Context consumption 也不表示 OpenMAIC 必须盲目服从 DeepTutor 的每一项建议。DeepTutor 提供的是面向学习者的教学语义；OpenMAIC 仍然负责在自身支持的课程能力、受众、时长、安全约束和普通课堂模型内，把这些语义转化为 outline 设计。被消费的是教学语义，而不是 UI 命令、scene 命令、route、播放器操作、checkpoint/remediation 命令或 RuntimeState 修改。

Context consumption 要求生成过程真正考虑冻结上下文，但不要求每一次上下文都必须导致肉眼可见的 outline 差异。如果冻结上下文与通用课程结构一致，最终结果可能接近默认 outline；只要生成过程确实把上下文作为课程设计输入，而不是只接收它，就仍可能满足 consumption。该目标是输入 lineage 和生成参与性的产品主张，不是模型内部推理正确、所有建议都被采用或教学结果有效的主张。

## Output Alignment 的产品定义

**Output alignment** 指最终生成的 outline，以及必要时由其 scene 提供的局部证据，在可观察的课程设计中体现了冻结 DeepTutor 上下文中的相关语义。这里的“体现”不是逐字复制，也不是检查若干关键词是否出现，而是观察课程结构、知识范围、目标安排、教学顺序、活动、示例和递进方式是否与相关语义一致。

Output alignment 至少涉及三类产品含义：

### Learning-objective alignment

Outline 应当朝向请求中的学习结果组织，并在目标所要求的情况下提供相应的解释、练习、应用、比较、检索或其他学习活动。仅仅把目标原句重复在标题或摘要中，不足以证明目标被体现。

如果目标要求学习者“解释”，只有定义展示而没有解释活动，alignment 很弱；如果目标要求“比较”，课程设计应当提供比较对象、比较维度或比较任务；如果目标要求迁移到新情境，单纯重复原例题不能充分体现该目标。这里判断的是课程设计是否朝向目标，不是学习者是否已经达成目标。

### Knowledge-scope alignment

课程应当处理经过授权且与当前上下文相关的知识范围，尊重前置关系和明确排除项，不应把 unresolved 或未授权引用伪装成权威知识。该目标关注课程讲了什么、没有无依据扩展到什么，以及知识范围和关系是否与当前语义保持一致。

Knowledge-scope alignment 不等于知识内容事实正确。它是范围和 lineage 的产品主张，不保证每一个解释都正确，也不等于 DeepTutor 的知识映射已经被证明无误。

### Teaching-design alignment

Outline 的顺序、递进、活动、示例或 assessment-oriented moments，应当体现相关教学设计要求。例如，`worked-example-first` 应当表现为在独立练习前存在有意义的示范；`retrieval-practice` 应当表现为要求学习者主动提取知识的活动；前置知识激活要求应当在依赖该知识的目标之前得到体现。教学策略不需要原样作为标签出现在输出中，关键词重复本身也不足以证明 alignment。

## Outline 与 scene 的产品关系

Output alignment 的主要判断对象是整体 lesson outline，而不是每个单独 scene。许多重要的教学性质只有在整体结构中才有意义，例如：

- 前置知识是否在目标知识之前被激活；
- 示范是否发生在独立练习之前；
- 多个学习目标是否得到合理分布；
- 课程是否由基础逐步递进到迁移；
- 知识范围是否在整节课中保持闭合。

Scene 内容和 scene 结构可以作为局部证据，用于说明某个目标、知识点或教学策略在具体课程位置得到体现。但当前产品语义不要求每个普通 scene 携带完整 `FrozenLessonGenerationContext`，也不要求每个 scene 都绑定严格的知识图谱节点。Scene 是支持整体 outline 判断的证据来源，不是跨系统语义根。

## 两个目标的关系

两个目标形成四种产品状态：

| Context consumption | Output alignment | 产品解释 |
|---|---|---|
| 未建立 | 未建立或无法归因 | 不能声称 DeepTutor 参与了 outline generation。 |
| 已建立 | 未建立 | 上下文确实到达并参与了生成，但结果没有充分体现相关语义。 |
| 未建立 | 表面上存在 | 结果可能来自通用模板或偶然相似，不能归因于 DeepTutor。 |
| 已建立 | 已建立 | 有可追踪证据表明本课纲消费并体现了相关 DeepTutor 课前教学语义。 |

这种区分不是严格的科学反事实因果证明。它不声称“没有 DeepTutor 时 outline 必然不同”，而是要求分别能够说明：生成过程使用了冻结语义，生成结果也通过了针对这些语义的独立对齐判断。

两个目标的失败含义也不同。Context-consumption failure 是语义没有真正参与生成，或无法证明其 lineage 到达生成阶段；Output-alignment failure 是上下文虽然可用并可能已经被消费，但生成结果没有充分体现相关课程设计要求。任何一项都不应被另一项隐藏。

## 产品边界与非主张

即使两个目标都成立，也只能说明：

```text
本次 outline 在可追踪意义上消费并体现了 DeepTutor 的课前教学语义。
```

不能因此声称：

- DeepTutor 的知识判断或教学建议一定正确；
- 课程一定具有教学效果；
- 学习者一定达成了学习目标；
- learner mastery 已经发生改变；
- 生成内容不存在事实错误或教学缺陷；
- 每个 scene 都与某个知识图谱节点建立了严格绑定；
- 课前已经执行 checkpoint、diagnosis、remediation 或动态课堂路径变化。

当前文本也不决定 DeepTutor 建议中哪些属于必须体现的要求、哪些属于可选推荐、哪些只作为生成后评估关注点。这个问题需要单独讨论，之后才能把 Output Alignment 转化为具体的成功、部分成功和失败语义。
