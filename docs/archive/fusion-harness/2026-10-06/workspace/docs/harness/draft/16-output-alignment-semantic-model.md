# Pre-class Fusion Output Alignment 语义模型

> 本文记录 FUSION/11 第五项产品语义讨论结果。它承接 `12-context-consumption-and-output-alignment.md`、`13-alignment-requirement-levels.md`、`14-guidance-constraint-strength-and-failure-semantics.md` 和 `15-output-alignment-stage-lifecycle.md`。
>
> 本文采用“语义架构图”的组织方式：先确定版本主体，再确定同一条 lineage 上的两个证据阶段，再确定三类评估维度；随后为每个具体评估对象形成局部 Assessment Item，并区分 Judgment、Evidence 与 Limitation；最后由服务器聚合多个局部 Judgment，形成 Summary / Overall Assessment。本文是概念模型，不是 Feature 合同、架构 SSOT、最终 schema 或实现授权。对象名和状态名用于确认产品含义；具体 JSON 字段、枚举、版本化方式、数据库结构、评估器和 API 形状需要后续单独确定。

## 一、语义根与版本主体：Alignment 针对什么对象

Output Alignment 不是对抽象课程名称的永久属性，也不是对“这门课是否个性化”的笼统判断。它必须针对一个明确的版本主体：

```text
某一个 FrozenLessonGenerationContext
  下的某一个 outline revision
  以及该 outline revision 所生成的 lesson realization。
```

这形成一条不可混淆的语义 lineage：

```text
FrozenLessonGenerationContext
        ↓
Outline Revision
        ↓
Lesson Realization / Scene Revision
        ↓
Output Alignment Assessment
```

其中：

- `FrozenLessonGenerationContext` 是课前教学语义根，确定本次课程使用的冻结上下文；
- `Outline Revision` 是某次课纲生成或修改后的课程设计版本；
- `Lesson Realization` 是该 outline 进一步生成的 scene、内容和活动实现；
- `Output Alignment Assessment` 是针对上述版本关系形成的服务器侧判断。

同一个 Frozen Context 可以产生多个 outline revision；每个 outline revision 都必须拥有自己的对齐判断。一个 outline revision 也可能经过多次 scene regeneration，形成不同的 realization revision；旧 realization 的判断不能自动沿用到新 realization。若 context、outline 或 realization 发生影响语义的变化，旧判断应被视为不再适用于当前版本，而不是继续附着在新版本上。

这意味着 Alignment 必须能够追溯到至少三类事实：

```text
Context lineage
  这份课程属于哪个 Frozen Context、请求语义和教学指导版本。

Outline plan
  该 revision 计划如何组织目标、知识范围和教学设计。

Lesson realization
  实际 scene 和内容如何实现该 outline plan。
```

## 二、同一条 lineage 的两个证据阶段

Output Alignment 不是只在一个时间点判断。它在同一条 lineage 上具有两个证据阶段：

```text
Outline Preflight Alignment
  针对 outline plan 的计划层判断。

Realized Lesson Alignment
  针对 scene / content realization 的实现层确认。
```

两者不是两个互不相关的 alignment 对象，而是同一个课程设计 lineage 的不同证据成熟度。

### 1. Outline Preflight Alignment

Preflight 回答：

> 这份 outline 计划是否具备继续生成 scene 的条件？

它主要判断：

- Required 是否已进入 outline 计划；
- outline 是否朝向请求中的学习目标；
- 知识范围是否处于授权和相关范围内；
- 必要的前置关系、顺序和排除项是否在计划中可见；
- Recommended 是否在 outline 中形成明确的计划采用、部分采用或不采用安排；
- Evaluation Focus 是否在 outline 中预留了相应的关注、活动或证据机会；
- outline 是否仍然是普通课前课程设计，而不是课前 checkpoint/remediation 控制计划。

Preflight 通过只表示计划具备继续生成 scene 的条件，不能独立证明最终 scene 已经实现了教学要求。

### 2. Realized Lesson Alignment

Realized alignment 回答：

> 最终生成的 scene 和内容，是否真正实现了这份 outline 以及冻结上下文要求的课程设计？

它主要判断：

- Required 是否在实际 scene 中落地；
- scene 是否忠实实现 outline 的目标、范围、顺序和活动计划；
- Recommended 实际采用、部分采用还是未采用；
- Evaluation Focus 是否形成足够的内容证据；
- scene generation 是否发生语义漂移；
- 实际内容是否引入未授权知识范围或新的教学冲突。

如果 preflight 通过而 realized 未通过，说明计划本身具备生成条件，但 scene generation 发生了实现偏差。不能用 preflight 结果覆盖 realized 问题。

### 3. 两阶段的产品职责

```text
生成前：
  防止错误 outline 消耗 scene token。

生成后：
  防止正确 outline 被错误 scene 实现。

最终 alignment：
  不能只看计划，也不能只看 Prompt；
  必须同时考虑 outline 设计与 scene realization。
```

这不是要求把同一套评估完整执行两次。前置阶段主要检查结构、范围、目标、顺序和设计意图是否进入 outline；后置阶段主要检查 scene 是否忠实实现 outline，并提供实际内容证据。

## 三、三大评估维度

Output Alignment 至少包含三个互相关联、但不能互相替代的评估维度：

```text
Objective Alignment
  课程设计是否朝向本次请求的学习目标。

Knowledge-Scope Alignment
  课程是否处理当前授权且相关的知识范围，并尊重关系与排除项。

Guidance Alignment
  课程是否满足必要 Guidance、实际采纳推荐策略，并对 Evaluation Focus 形成可观察证据。
```

目标决定“希望学习者完成什么”；知识范围决定“课程围绕哪些内容和关系展开”；TeachingGuidance 决定“针对当前课程和学习者，课程设计必须满足、应当考虑或需要重点关注什么”。一个目标可能需要多个知识点支撑，一个教学策略也可能服务多个目标，因此不能只检查标题关键词或某个 knowledge reference 是否出现。

### 1. Objective Alignment

Objective Alignment 关注学习结果方向是否进入课程设计，并区分：

- 目标是否被保留在 outline 计划中；
- 目标是否有相应的解释、练习、比较、应用、检索或迁移设计；
- 目标与相关知识范围之间是否存在可解释关系；
- scene realization 是否真正实现了 outline 对目标的计划。

它不证明学习者已经达成目标，也不证明目标本身设计得足够好；它只判断课程产物是否朝向请求中的学习结果。

### 2. Knowledge-Scope Alignment

Knowledge-Scope Alignment 关注课程讲了什么、没有无依据扩展到什么，以及知识关系是否保持在当前语义范围内，包括：

- 相关知识范围是否进入课程设计；
- 必要前置关系是否被考虑；
- unresolved 或未授权引用是否没有被冒充为权威内容；
- 明确排除项是否被遵守；
- scene realization 是否引入 outline 没有计划且不属于授权范围的内容。

它不等于知识事实正确性。课程可以在正确范围内包含事实错误，也可以在事实正确的情况下超出授权范围。范围对齐、知识正确性和教学有效性是不同的质量问题。

### 3. Guidance Alignment

Guidance Alignment 关注 TeachingGuidance 的三层约束：

- `Required` 是否被纳入 outline 计划并在最终 scene 中实现；
- `Recommended` 是否在 outline 中形成可观察的计划采用方式，以及最终课程实际采用、部分采用还是未采用；
- `Evaluation Focus` 是否在 outline / realization 中形成与该关注点相关的可观察证据，以及这些证据是否暴露出问题。

Guidance Alignment 不能缩减为 `appliedApproaches` 列表。推荐策略可能部分采用；Evaluation Focus 可能没有固定 scene，而是通过若干内容或活动形成证据；Required 也可能在 outline 中被提到却没有在 scene 中真正实现。

三大评估维度只回答“**评什么**”。它们不会直接规定一条判断记录应如何表达。后续语义层级统一为：

```text
Assessment Dimension
  Objective / Knowledge Scope / Guidance
        ↓
Assessment Item
  某一个具体目标、范围要求或 Guidance 项
        ↓
Local Assessment Record
  Judgment + Evidence + Limitation
        ↓
Server Aggregation
  Summary / Overall Assessment
```

因此，第三节定义评估对象空间；第四至第六节定义局部判断记录；第七节才处理多个局部结果如何形成课程级结论。

## 四、局部 Assessment Item 的信息结构

第三节回答的是“**评什么**”：Objective、Knowledge Scope 和 Guidance 是三类评估维度。第四节进一步回答的是“**对每一个具体被评对象，一条局部判断记录由什么组成**”。这两者不是同一层级，而是前后衔接的两层语义。

概念上，三大评估维度都会产生若干具体的 `Assessment Item`：

```text
Objective Alignment
  → 某一个 learning objective 的 assessment item

Knowledge-Scope Alignment
  → 某一个知识范围、前置关系、排除项或范围风险的 assessment item

Guidance Alignment
  → 某一个 Required / Recommended / Evaluation Focus 的 assessment item
```

每一个局部 `Assessment Item` 至少应区分三种性质的信息：

```text
A. Judgment（判断）
   系统针对该具体 item 形成的语义结论。

B. Evidence（证据）
   支持该 Judgment 的、可定位到 outline 或 scene 的课程证据。

C. Limitation（限制）
   说明该 Judgment 不能证明什么，或当前证据为什么不足。
```

三者承担不同职责，不能互相替代。例如：

```text
Assessment Item：Required guidance
  “独立练习前必须先有 worked example。”

Judgment：Satisfied
Evidence：outline 中先规划示范活动；scene 3 实现完整示范；scene 4 才进入独立练习。
Limitation：只证明课程设计满足该顺序要求，不证明学生因此已经学会。
```

如果只有 Evidence 而没有 Judgment，只能知道课程某处存在相关内容，却无法知道这些证据支持的是“满足”“违反”“证据不足”还是其他结论。反过来，如果只有 Judgment 而没有 Evidence，alignment 就容易退化成模型或评估器的自我声明。Limitation 则负责约束解释边界，防止把课程设计对齐扩大成学习成效、事实正确性或教学有效性的证明。

因此，局部判断的基本关系是：

```text
Assessment Dimension
      ↓
Assessment Item
      ├─ Judgment
      ├─ Evidence
      └─ Limitation
```

`Summary` 不属于单个局部 Assessment Item 的并列组成部分。它应当由服务器在多个局部 Judgment 形成后进行聚合，并在第七节中作为课程级结果单独定义。

Evidence 只能支持课程设计对齐的判断，不能被解释为：

- 学习者已经学习或掌握；
- 知识事实已经被验证；
- 教学策略已经证明有效；
- DeepTutor 的知识映射一定正确。

## 五、Judgment 的基本状态语义

第四节确定了每个 Assessment Item 都需要一个 `Judgment`。本节回答的是：**Judgment 可以表达哪些基本结论**。这些状态不是新的评估维度，而是局部 Judgment 的结果语义。

对于具有“必须满足 / 是否满足”性质的 item，例如 Objective、Knowledge-Scope 中的必要要求，以及 Required Guidance，概念模型至少要区分：

```text
Satisfied
  已有足够证据表明该要求得到满足。

Violated
  有足够证据表明结果违反了该要求。

Unproven
  已经尝试判断，但当前证据不足以证明满足，也不足以确认明确违反。

Not applicable
  该要求不适用于当前课程、阶段或判断对象。
```

`Unproven` 不是 `Violated` 的同义词，也不是成功。它表示系统已经进行了判断，但当前课程产物或证据不足以支持更强结论。尤其在 preflight 阶段，某些依赖具体 scene 内容的要求可能只能暂时处于 `Unproven`，等待 realized evidence。

为了表达判断生命周期，还需要在概念上区分：

```text
Not assessed
  当前阶段尚未对该 item 执行判断。

Stale
  该 Judgment 曾经对旧版本有效，但相关 context、outline 或 realization revision 已发生变化，因此不能继续作为当前版本的有效结论。
```

三者的区别是：

```text
Not assessed
  = 尚未判断。

Unproven
  = 已经判断，但证据不足。

Stale
  = 曾经判断，但当前版本已经使旧判断失效。
```

它们不能混为普通失败，也不能被服务器自动解释成同一种整体结果。

## 六、Guidance Alignment 的专属 Judgment 语义

Guidance Alignment 属于第三节定义的三大评估维度之一，但它内部的 `Required`、`Recommended` 和 `Evaluation Focus` 具有不同规范强度，因此不能强迫所有 Guidance Item 共用同一套 Judgment vocabulary。

### 1. Required

Required 问的是“该必要教学要求是否得到满足”，因此可以使用第五节中的满足性状态：

```text
Satisfied
  该 Required 得到满足。

Violated
  有明确证据表明 Required 被违反，构成实质 alignment 问题。

Unproven
  已经尝试判断，但当前证据不足以证明 Required 已满足；不能宣称完整对齐，但也不能等同于明确违反。

Not applicable
  当前课程、阶段或判断对象不适用该 Required，不能被当作漏掉。
```

Preflight 中，Required 至少需要进入 outline 计划；若已经明确缺失或冲突，可以判定 `Violated`，或由后续产品流程决定是否阻止正常进入 scene generation。若必须等待 scene 内容才能确认，则可以暂时为 `Unproven`，由 realized alignment 继续判断。

Realized 阶段，Required 必须在实际课程中落地。若最终仍为 `Unproven`，课程不能宣称充分 alignment；是否阻止发布属于后续产品流程。

### 2. Recommended

Recommended 与 Required 不同。它不问“是否违反”，而是关注推荐策略在最终课程中的**采纳程度**。因此 realized 阶段的 Judgment 更适合表达为：

```text
Adopted
  推荐策略得到实质体现。

Partially adopted
  只实现了部分策略语义。

Not adopted
  最终课程没有采用该推荐；这是允许的非阻断结果。

Unproven
  已经尝试判断实际采纳程度，但当前 outline / scene 证据不足以确认采用或未采用。
```

`Not adopted` 不能编码为 `Violated`，因为 Recommended 不是 Required；但也不能被伪装成 `Adopted`。

是否“在生成决策中被考虑过”属于 Context Consumption 侧的问题，而不是 Output Alignment 的 realized adoption status。因此，`Not considered` 不再作为 Output Alignment 的主要结果状态。Preflight 若需要确认 Recommended 是否进入设计考虑，应引用对应的 Context Consumption evidence 或生成设计记录；Output Alignment 主要负责判断最终课程是否采用、部分采用或未采用该策略。

### 3. Evaluation Focus

Evaluation Focus 也不是固定生成要求。它关注的是：**当前课程是否提供了与该关注点相关的可观察证据，以及这些证据是否暴露出问题**。

因此，它更适合表达为证据导向的 Judgment：

```text
Evidence found
  当前课程存在与该关注点相关的可观察证据，可支持进一步判断。

Insufficient evidence
  已经尝试判断，但当前课程证据不足以形成更强结论。

Concern found
  当前课程证据显示存在值得报告的问题。

Not assessed
  当前阶段尚未对该关注点执行判断。
```

“该关注点是否进入设计或评估关注范围”更接近 Consumption / assessment scheduling 语义，不宜与 realized evidence status 混成同一个枚举。若 Evaluation Focus 的证据进一步揭示了某个 Required 被明确违反，则应产生对应的 Required Judgment，而不是让 `Concern found` 自己承担 Required violation 的语义。

因此，Guidance Alignment 的三类局部 Judgment 应理解为：

```text
Required
  → 是否满足必要要求。

Recommended
  → 最终课程实际采纳到什么程度。

Evaluation Focus
  → 当前课程是否提供相关证据，以及是否发现需要报告的问题。
```

## 七、服务器聚合：从局部判断到整体结论

整体课程级 Alignment 不能简单由局部项平均，也不能用单一 coverage 百分比替代规范判断。服务器聚合必须保留三层 Guidance 的不同逻辑。

### Required 支配核心对齐

任何适用的 Required 被明确判定为 `Violated`，整体课程不能是完整 alignment。一个局部必要约束的失败不能被其他目标的高覆盖率抵消。

Required 为 `Unproven` 时，整体不能宣称证据充分，但是否直接标记为 failure 要结合阶段和产品发布策略。Preflight 中可能合理地等待 realized evidence；最终 realized 中持续 `Unproven` 会限制整体结论强度。

### Recommended 不直接阻止整体对齐

Recommended 的 `Not adopted` 或 `Partially adopted` 不自动使整体 alignment 失败。它们影响推荐策略采纳摘要和 warning，而不是 Required completeness。

是否“被考虑过”属于 Context Consumption 的独立语义，不由 Output Alignment 的 Recommended adoption status 代替。如果课程最终未采用某个 Recommended，Output Alignment 只应如实记录 `Not adopted` 或其他采纳状态；若要判断该推荐是否曾进入生成决策，应回到 Context Consumption evidence，而不是从输出结果反推。

### Evaluation Focus 限制判断完整性

Evaluation Focus 未评估或证据不足，不自动等于整体 alignment failure，因为它不规定固定生成形式，也可能需要更完整的 scene 才能判断。但它会限制整体结论完整性，并可能形成 warning 或 incomplete evaluation。

如果 Evaluation Focus 识别出明确 Required violation，整体结论按 Required 规则处理。

### 概念上的整体结果

整体结果至少应能表达：

```text
Aligned
  适用 Required 已满足，且没有阻止完整结论的未决问题。

Aligned with warnings
  Required 没有明确违反，但存在 Recommended 未采用、Evaluation Focus 证据不足或其他非阻断限制。

Partially aligned
  部分重要语义得到体现，但存在未解决问题，不能宣称完整对齐。

Not aligned
  至少一个适用 Required 被明确违反，或存在不可接受的实质冲突。

Unevaluated / insufficiently evaluated
  当前证据不足以形成可靠整体结论。
```

这些名称是概念状态，不是最终 schema 枚举。尤其需要在后续决定 `Partially aligned` 与 `Unevaluated` 的界线，以及 `Unproven Required` 在 preflight 和 realized 阶段分别如何影响整体状态。

## 八、核心规则

```text
1. Alignment 针对具体版本主体，不是抽象课程属性。
2. Preflight 与 Realized 属于同一条 alignment lineage，但证据成熟度不同。
3. Objective、Knowledge Scope、Guidance 三个维度不能互相替代。
4. Required 支配核心对齐：明确违反不能被其他 coverage 抵消。
5. Recommended 未采用不自动失败；是否曾被考虑属于 Context Consumption，不从 Output Alignment 反推。
6. Evaluation Focus 要求关注和证据，但不规定固定生成形式。
7. 每个局部 Assessment Item 由 Judgment、Evidence、Limitation 构成；Summary 属于服务器聚合层。
8. Output Alignment 不证明学生掌握、知识事实正确或教学效果。
9. Preflight 通过不代表最终 scene 已对齐；Realized 结果可以推翻计划层判断。
10. 服务器聚合整体结论，不允许浏览器或模型自行宣称整体 alignment。
```

## 九、可以进入下一步候选 JSON 的内容

下一份 `17-output-alignment-conceptual-json.md` 可以表达：

```text
Assessment subject
  context lineage、outline revision、realization revision 和阶段。

Overall assessment / summary
  由服务器聚合多个局部 Judgment 得到的当前阶段整体结论、阻断问题、warning 和限制。

Objective assessment items
  每个目标对应的 Judgment、可定位 Evidence 和 Limitation。

Knowledge-scope assessment items
  针对授权范围、前置关系、排除项和范围风险形成的局部 Judgment、Evidence 和 Limitation。

Guidance assessment items
  Required、Recommended、Evaluation Focus 各自使用相应 Judgment 语义，并关联 Evidence 与 Limitation。

Evidence references
  指向 outline 或 scene 的服务器侧可定位证据；Evidence 支持局部 Judgment，但不单独构成 Summary。

Warnings and limitations
  局部或整体层面的非阻断问题、评估限制和不能由 alignment 证明的内容。

Derived outlineCoverage
  从完整 assessment 派生的 lesson-level 摘要。
```

## 十、暂时不能被 JSON 承诺的内容

不能因为内容进入 JSON 就声称：

- 学习者已经掌握目标；
- 教学策略一定有效；
- DeepTutor 的知识映射一定正确；
- 每个 scene 都与权威知识图谱节点严格绑定；
- 生成内容在事实和教学上没有缺陷；
- 模型内部推理正确或完整；
- Prompt 中出现 guidance，所以 output 一定受其影响；
- 目标关键词出现，所以目标已经被有效教学；
- Recommended 未采用却仍被记为已应用；
- Evaluation Focus 没有充分证据却被记为已覆盖；
- Preflight 通过，所以最终 scene 必然对齐。

## 十一、当前产品边界

本文暂不决定：

- 最终 JSON schema、字段名和枚举值；
- evaluator 的实现、模型、规则、人工流程或分层方式；
- evidence 如何生成和存储；
- `outlineCoverage` 的最终字段和读取方式；
- Required 未满足时是阻止发布、重新生成、保留草稿还是允许带警告继续；
- Recommended 未采用时是否要求用户确认；
- Evaluation Focus 的评估阈值；
- scene regeneration、outline regeneration、reorder 和 user edit 如何使判断失效或重新计算。

下一步可以在不改变本文产品语义的前提下，编写候选 JSON 文档，并采用方案二：

```text
OutlineAlignmentAssessment
  完整的服务器侧判断对象。

outlineCoverage
  从完整 assessment 派生的 lesson-level 摘要，不是独立真相来源。
```
