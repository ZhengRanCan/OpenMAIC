# Pre-class Fusion TeachingGuidance 的约束强度与失败语义

> 本文记录 FUSION/11 第三项产品语义讨论结果。它是设计讨论记录，不是 Feature 合同、架构 SSOT、schema 规范或实现授权。本文只讨论 `TeachingGuidance` 在 outline shaping 中的约束强度、coverage 影响和失败语义，暂不决定具体 evaluator、字段、阈值、Prompt、持久化或用户编辑实现。

## 与前两项讨论的关系

此前的讨论分别确定了两件事：

- `12-context-consumption-and-output-alignment.md` 定义两个独立产品目标：`Context Consumption` 与 `Output Alignment`；
- `13-alignment-requirement-levels.md` 将 DeepTutor 教学指导分为 `Required`、`Recommended` 和 `Evaluation Focus` 三层。

本文不重新定义这三层，而是进一步回答：

```text
三层指导对 outline 有多强的约束力？
没有满足时分别意味着什么？
哪些情况影响核心 coverage？
哪些情况阻止正式 alignment 成功？
哪些情况只需要记录 warning 或未评估状态？
```

因此，三份记录形成连续关系：

```text
12：需要证明什么？
13：TeachingGuidance 分成哪三层？
14：三层分别约束什么，失败时如何处理？
```

## 先区分三个层次

讨论 Guidance 约束力时，不能把以下三件事混成同一个判断：

```text
指导本身的规范强度
  它是 Required、Recommended 还是 Evaluation Focus。

生成结果是否满足指导
  outline 是否体现该要求、采用该策略或提供足够关注证据。

系统如何处理结果
  接受、标记部分对齐、记录 warning、要求重新生成，还是阻止正式发布。
```

例如，`Required` 未满足首先意味着“存在 alignment 问题”，但不必然意味着系统完全没有生成出任何 outline。系统可以保留一个可查看的草稿，同时拒绝把它标记为已经满足 Fusion 教学约束的正式结果。反过来，某项 `Recommended` 未采用通常不意味着整份 outline 失败，但也不能被伪装成已经采用。

产品上应至少区分：

```text
Generation failure
  没有得到可用 outline，或结果违反了不能安全接受的边界。

Alignment failure
  得到了 outline，但它没有满足必要的教学约束。

Accepted with warning / incomplete evaluation
  核心约束满足，但存在可接受的推荐未采用、关注项未充分判断或其他非阻断问题。
```

## Required design constraint：正式对齐的必要条件

`Required design constraint` 表示某项教学要求对于本次课程的语义成立具有必要性。最终 outline 必须体现这些要求；如果没有满足，产品上就存在 alignment 问题，不能仅因为 outline 格式合法、课堂仍可展示或生成接口成功返回，就宣称完整对齐。

Required 可以约束：

- 必须覆盖的学习目标或目标之间的必要关系；
- 必须处理的前置知识；
- 必须遵守的教学顺序或认知递进；
- 本课程不可省略的教学设计要求；
- 必须处理的授权知识范围；
- 必须避免的明确排除项。

Required 只约束教学语义，不允许 DeepTutor 指定 OpenMAIC 的具体实现。它不能变成：

```text
必须创建某个 sceneId；
必须调用某个 route；
必须使用某个 React 组件；
必须执行某个播放器命令；
必须插入课前 checkpoint/remediation；
必须改变 RuntimeState。
```

同一个 Required 约束可以由不同的合法 outline 结构体现，只要这些结构都满足其教学语义。

### Required 未满足的产品含义

Required 未满足至少意味着三件事：

1. 核心 Output Alignment 不能成立；
2. 核心 coverage 必须体现必要约束存在缺口；
3. 结果不能以“完整对齐课纲”名义直接接受。

是否保留该 outline 作为草稿、进入人工修订、要求重新生成或阻止正式发布，是恢复和发布策略；这些策略不能削弱“Required 未满足即存在 alignment 问题”的语义。

某些 Required 违反应当更接近硬失败，尤其是：

- 违反明确知识范围；
- 引入未授权或伪造的权威知识引用；
- 违反明确排除项；
- 生成与课程目标直接冲突的教学方向；
- 必要约束之间无法调和；
- 生成了课前不应承担的运行时控制命令。

这类情况不只是 coverage 不完整，而是结果可能不可安全接受，应进入失败、重新生成或显式恢复路径。

### Required 未满足不等于 Provider failure

如果 Required 未满足，系统不应把问题伪装成 DeepTutor 服务失败、Provider 不可用、上下文冻结失败或网络错误。更准确的产品语义是：

```text
DeepTutor context 已成功进入生成过程，
但生成的 outline 未满足必要的教学约束。
```

这与 Provider failure 的恢复方式不同。Provider failure 可能适合技术重试；Context failure 可能需要重新建立语义上下文；Alignment failure 则更可能需要重新生成 outline、调整设计或人工修订。

## Recommended approach：必须考虑，但允许取舍

`Recommended approach` 表示 DeepTutor 根据当前课程和学习者相关语义提出了有帮助或较优的教学策略，但该策略不是本次课程语义成立的不可省略条件。OpenMAIC 在设计 outline 时必须把它纳入考虑，但可以基于时长、受众、课堂能力、其他 Required 约束、内容组织或生成条件决定不采用。

Recommended 的语义包含两个同时成立的要求：

```text
不能无视；
可以不采用。
```

如果最终没有采用，系统不能把该策略报告为已采用，也不能通过关键词重复制造虚假的 alignment 证据。例如，DeepTutor 推荐 `worked-example-first`，outline 可以因为时长或其他课程取舍不采用完整 worked example；这本身不自动构成整份 outline 的 alignment failure。但如果没有真正先示范再练习，结果不能被标记为“已应用 worked-example-first”。

Recommended 的未采用状态是一个真实、可接受但需要诚实记录的产品结果。它可能需要记录未采用、部分采用、取舍原因、非阻断 warning 或后续质量审阅，但不能被抹平为成功。

### 未采用与未考虑的区别

需要区分：

```text
没有采用 Recommended
  允许的课程取舍。

没有考虑 Recommended
  可能说明 Context Consumption 不充分。
```

前者不自动导致 Output Alignment failure；后者可能说明 DeepTutor guidance 没有真正成为课程设计输入，因此不能轻易宣称已发生有意义的 context consumption。

### Recommended 何时属于 Required

策略名称本身不决定规范强度。`worked-example-first`、`retrieval-practice`、`transfer-challenge` 等策略在不同课程中可能属于不同层级。

如果某个策略在当前课程中是不可省略的，它必须以 Required 身份表达，而不能只作为 Recommended，以便在未实现时逃避 alignment 问题。层级由当前冻结课前语义对本课程的规范性决定，而不是由策略名称固定决定。

## Evaluation Focus：必须关注，但不规定固定形式

`Evaluation Focus` 表示课程设计和后续 alignment 判断必须关注某个问题，但不要求通过固定的 scene、活动、组件、文本或模板来实现。

它可以关注：

- 某个预期误解是否被处理；
- 学习目标是否在课程递进中持续得到关注；
- 前置关系是否在必要位置被考虑；
- 知识范围是否存在无依据扩展风险；
- 课程是否给学习者提供观察、比较、解释、检索或迁移的机会。

Evaluation Focus 的含义是：

```text
请不要漏看这个问题。
```

而不是：

```text
必须生成某个固定结构。
```

一个 Evaluation Focus 可能通过示例、解释、比较、练习、顺序设计或其他合理方式得到关注。没有预先规定的固定形式，不应自动判定 alignment failure。

但 Evaluation Focus 也不是可以完全忽略的备注。如果相关问题没有充分证据，产品结果应保持诚实，例如表示未充分评估、关注证据不足或存在 warning，而不能因为没有固定 scene 就直接声称该问题已被处理。

如果关注过程中发现了实际的 Required violation，则应按更高强度的 Required 问题处理。例如，某项 Evaluation Focus 只是提醒系统关注前置概念是否被误解，但最终发现 outline 明确违反了一个不可省略的教学约束，那么问题不再只是 Evaluation Focus 未充分关注，而是 Required alignment failure。

## 三层对 coverage 的不同影响

三类指导不应被压缩成一个不透明的 coverage 百分比。产品语义上至少要区分：

```text
Required coverage
  必要教学约束是否得到满足。

Recommended adoption
  推荐策略是否被采用、部分采用或未采用。

Evaluation attention
  评估关注点是否被纳入课程设计和后续判断。
```

| Guidance 层级 | 对核心 alignment 的影响 | 对 coverage 的影响 | 通常的产品处理 |
|---|---|---|---|
| Required | 未满足即存在 alignment 问题 | 产生必要覆盖缺口，不能宣称完整对齐 | 通常阻止“已对齐”结果；可重新生成、人工修订或保留为非正式草稿 |
| Recommended | 未采用不自动构成 failure | 记录已采用、部分采用或未采用，但不等同于核心覆盖缺口 | 通常可接受；必要时记录 warning 或取舍原因 |
| Evaluation Focus | 不规定固定输出形式 | 影响关注程度和评估完整性，不直接等于内容覆盖 | 未充分判断时标记未评估或 warning；发现严重问题时转化为更高层约束处理 |

核心结论是：

```text
Required 影响是否满足正式对齐的最低条件；
Recommended 影响策略采纳记录；
Evaluation Focus 影响 alignment 判断是否充分关注了指定问题。
```

如果只保留一个整体 coverage 结果，Recommended 未采用可能被误报为核心 failure，而 Evaluation Focus 没有固定 scene 可能被误报为“没有覆盖”。产品语义必须保留这三种结果的区别。

## 哪些情况影响 coverage、生成成功和 warning

在暂不讨论具体 evaluator 的前提下，可以先形成以下产品级边界：

### 不能宣称完整 alignment 的情况

- Required design constraint 明确未满足；
- 必要学习目标没有被体现；
- 必须遵守的教学顺序被违反；
- 明确排除项被违反；
- 知识范围越权或伪造权威引用；
- 生成结果与冻结教学语义发生实质冲突。

这些情况至少会造成 Required coverage 缺口，并阻止结果被标记为完整 alignment 成功。

### 通常可接受但应记录的情况

- Recommended approach 未采用，但存在合理课程取舍；
- Recommended approach 只部分采用；
- Evaluation Focus 没有固定形式，但存在其他合理的关注方式；
- Evaluation Focus 暂时无法充分判断，但尚未发现 Required violation；
- 课程与通用结构相近，但没有证据表明这与冻结上下文发生冲突。

这些情况通常不应导致整个生成失败，但应保留未采用、部分采用、未评估或 warning 的真实语义。

### 更接近硬失败的情况

以下问题不仅是 coverage 不完整，也可能使结果不可安全接受：

- outline 使用未授权知识范围；
- outline 伪造 DeepTutor 没有提供的权威引用；
- outline 产生课前不应生成的 checkpoint/remediation 控制命令；
- Required 约束之间出现无法调和的冲突；
- 结果无法确定属于当前 Frozen Context。

这些情况应进入失败、重新生成或显式恢复路径，而不应只记录成普通 warning。

## 与 Context Consumption 的关系

三层约束描述的是 Output Alignment 的要求强度，不改变 Context Consumption 的独立定义。生成过程必须消费冻结的 DeepTutor 教学语义，才能说明 Required、Recommended 和 Evaluation Focus 在本次 outline 生成中拥有明确的语义来源。

但 Context Consumption 成功并不等于：

- Required 已经满足；
- Recommended 已经采用；
- Evaluation Focus 已经获得充分证据。

相反，某个 outline 即使偶然满足某项 Required，也不能在没有 Context Consumption 证据时把该结果归因于 DeepTutor。

## 当前产品边界

本记录确定的是三层 Guidance 的约束强度、coverage 影响和失败语义，不决定：

- 具体 schema 或状态字段；
- DeepTutor 如何产生和分类三层要求；
- OpenMAIC 如何将三层要求投影到 outline generation；
- alignment 由确定性规则、人工审阅、模型评估还是分层方法判断；
- Required 未满足时究竟阻止发布、重新生成、显示警告还是保留草稿；
- Recommended 未采用时是否要求用户确认；
- Evaluation Focus 的具体证据形式；
- outline、scene regeneration、reorder 或用户编辑后的重新判断方式。

这些问题需要在后续产品语义讨论、架构更新和独立 Feature 合同中分别确定，不能由本记录中的三层定义隐式替代。
