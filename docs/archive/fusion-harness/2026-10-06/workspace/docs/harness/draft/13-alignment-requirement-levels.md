# Pre-class Fusion Output Alignment 的三层教学要求

> 本文记录 FUSION/11 第二项产品语义讨论结果。它是设计讨论记录，不是 Feature 合同、架构 SSOT、schema 规范或实现授权。本文只确定 DeepTutor 教学指导在 Output Alignment 中的不同约束强度，不决定具体字段、Prompt、评估器、阈值或持久化方式。

## 核心决定

最终 outline 必须满足 DeepTutor 提供的必需教学约束。对于推荐性教学策略，OpenMAIC 必须在课程设计时予以考虑，但未采用某项推荐本身不自动构成 alignment failure；不过，系统不能把未采用的策略假装成已经采用。对于 evaluation focus，课程设计和后续 alignment 判断必须对相应问题保持关注，但不要求以某种固定的 scene、组件、活动或其他实现形式出现。

因此，DeepTutor 的课前教学指导在产品语义上分为三层：

```text
Required
  必须满足的教学约束。

Recommended
  应被纳入课程设计考虑的推荐策略；可以不采用，但必须诚实保留未采用事实。

Evaluation Focus
  课程设计和后续 alignment 判断需要关注的问题；不规定固定生成形式。
```

这三层不是同义词，也不能在生成过程中被当作同样强度的命令。它们分别对应三种不同的产品责任：必须做到、应当考虑但允许取舍、必须关注但不规定实现形式。

## Required：必须满足的教学约束

`Required` 表示 DeepTutor 判断某项教学要求对于本次课程的语义成立具有必要性。最终 outline 必须体现这些要求；如果没有满足，产品上应当认为存在 alignment 问题，而不能仅因为课程仍然可展示或生成格式合法就宣称完整对齐。

Required 约束可以涉及：

- 必须覆盖的学习目标或目标之间的必要关系；
- 必须处理的授权知识范围；
- 必须先激活的前置知识；
- 必须遵守的教学顺序或递进关系；
- 必须避免的明确排除项；
- 对当前课程不可省略的教学设计要求。

Required 并不意味着 DeepTutor 可以指定 OpenMAIC 的具体 UI 或运行时行为。它约束的是课程设计语义，而不是要求生成某个固定 `sceneId`、route、组件、播放器动作或课中 checkpoint/remediation。相同的 Required 约束可以由不同的合法 outline 结构体现，只要它们都满足教学语义。

Required 未被满足时，问题是课程设计与冻结上下文之间的 alignment 问题，不应被重新描述成普通的 Provider 故障，也不应通过把该要求降级为推荐项来隐藏。是否阻止正式发布、要求重新生成或允许带警告继续，需要后续产品流程另行决定；但“未满足 Required 即存在 alignment 问题”是本层不可改变的语义。

## Recommended：应考虑但允许取舍的教学策略

`Recommended` 表示 DeepTutor 根据当前课程和学习者相关语义提出了较优或有帮助的教学策略，但该策略不是本次课程语义成立的不可省略条件。OpenMAIC 在设计 outline 时必须将其纳入考虑，但可以基于时长、受众、课堂能力、其他 Required 约束、内容组织或生成条件决定不采用。

Recommended 的产品要求包含两个相互关联的部分：

1. 生成过程不能无视推荐策略；它应当把推荐纳入课程设计取舍；
2. 如果最终没有采用，系统不能把该策略报告为已采用，也不能通过关键词重复制造虚假的 alignment 证据。

例如，DeepTutor 推荐 `worked-example-first`，OpenMAIC 可以在课程设计中考虑先示范再练习。如果由于课程时长或其他 Required 约束最终没有采用完整 worked example，这本身不自动使整个 outline alignment failure。但结果不能被标记为“已应用 worked-example-first”；它应当诚实反映该推荐未采用或仅部分采用。

因此，Recommended 的未采用状态是一个真实的产品结果，而不是异常，也不必然是失败。它可能需要记录原因、显示提示或进入后续质量审阅，但不能被抹平为成功。Recommended 的存在也不能削弱 Required 的强度：一个 Required 约束不能因为被表述成“推荐策略”而变成可有可无。

## Evaluation Focus：必须关注但不规定固定生成形式

`Evaluation Focus` 表示某个问题应当进入课程设计思考和后续 alignment 判断，但它不规定必须生成某一种固定课程结构、scene 类型、组件、活动或文本表达。

Evaluation Focus 的作用是把注意力集中到某个教学风险或判断维度，例如：

- 是否真正处理了某个预期误解；
- 学习目标是否在课程递进中持续得到关注；
- 前置关系是否在必要位置被考虑；
- 某个知识范围是否存在无依据扩展风险；
- 课程是否给学习者提供了观察、比较、解释或迁移的机会。

它要求课程设计和 alignment 判断对这些问题保持敏感，但允许多种合法表达方式。Evaluation Focus 不应被机械翻译为“必须出现某个 scene”或“必须使用某个固定教学模板”。一个问题可能通过示例、解释、比较、练习、顺序设计或其他合理方式得到关注，不能因为没有采用预先设定的单一形式就自动判定失败。

Evaluation Focus 也不能被理解成完全可忽略的备注。它不是 Required，但仍然是本次课程生成和后续判断的关注范围。若相关问题完全没有被考虑，系统应至少能够在 alignment 判断中识别这一事实，而不是因为没有固定形式就直接声称该问题已经得到处理。

## 三层之间的关系

三层的语义可以概括为：

| 层级 | 对课程设计的要求 | 未满足或未采用的含义 | 能否声称已采用 |
|---|---|---|---|
| Required | 必须满足教学约束 | 构成 alignment 问题 | 只有确实满足时可以 |
| Recommended | 必须纳入考虑，但允许取舍 | 未采用可接受，但不能隐瞒 | 只有实际体现时可以 |
| Evaluation Focus | 必须关注该问题，但不规定形式 | 不因缺少固定形式自动失败；完全忽略应能被识别 | 不能用“关注”替代“已满足 Required” |

可以用三句更简短的话表达：

```text
Required：不满足就是 alignment 问题。
Recommended：未采用可以接受，但不能假装已经采用。
Evaluation Focus：必须关注，但不是固定生成要求。
```

## 对 Output Alignment 产品判定的影响

Output Alignment 不应被简化为一个不透明的整体成功或失败。至少需要能够区分：

- Required 是否得到满足；
- Recommended 是否被采用、部分采用或未采用；
- Evaluation Focus 是否被纳入课程设计和 alignment 判断的关注范围。

这不意味着当前就要确定具体状态字段或阈值。产品语义上，完整 alignment 的最低前提是 Required 没有未解决的违反；Recommended 的未采用可以共存于一个仍然可接受的 outline 中；Evaluation Focus 的判断应当反映“关注程度和证据”，而不是被强行转换成固定 scene 要求。

如果某个 Recommended 同时也是本课程不可省略的 Required 条件，必须以 Required 身份处理，而不能仅保留为 Recommended。也就是说，层级由该要求在当前课程中的规范性决定，而不是由策略名称决定。`worked-example-first`、`retrieval-practice` 或其他策略本身并不天然属于某一层；具体层级取决于当前冻结课前语义是否将其声明为必须满足、应当考虑，或需要重点评估的问题。

## 与 Context Consumption 的关系

这三层描述的是 Output Alignment 的要求强度，不改变 Context Consumption 的独立定义。生成过程必须消费冻结的 DeepTutor 教学语义，才能说明 Required、Recommended 和 Evaluation Focus 在本次 outline 生成中有明确的语义来源。

但 Context Consumption 成功并不等于 Required 已满足，也不等于 Recommended 已采用，更不等于 Evaluation Focus 已获得充分证据。相反，某个 outline 即使偶然满足某项 Required，也不能在没有 Context Consumption 证据时把该结果归因于 DeepTutor。

## 与 FUSION/11 后续设计的边界

本决定只确定教学要求的产品层级，不决定：

- 三层要求的具体 schema；
- DeepTutor 如何产生或分类这些要求；
- OpenMAIC 如何将它们投影到 outline generation；
- alignment 由确定性规则、人工审阅、模型评估还是分层方式判断；
- 未满足 Required 时是阻止发布、重新生成、显示警告还是进入恢复路径；
- Recommended 未采用时是否要求用户确认；
- Evaluation Focus 的具体证据形式；
- outline、scene regeneration、reorder 或用户编辑后的重新判断方式。

这些问题应在后续产品语义讨论、架构更新和独立 Feature 合同中分别确定，不能由本记录中的三层定义隐式替代。
