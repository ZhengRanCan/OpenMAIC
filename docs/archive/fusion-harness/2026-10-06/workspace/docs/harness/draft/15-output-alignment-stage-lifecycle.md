# Pre-class Fusion Output Alignment 的两阶段生命周期

> 本文记录 FUSION/11 第四项产品语义讨论结果。它是设计讨论记录，不是 Feature 合同、架构 SSOT、schema 规范或实现授权。本文只讨论 Output Alignment 应在 outline generation 与 scene generation 的哪些阶段发生，以及各阶段分别能证明什么；暂不决定具体 evaluator、字段、阈值、Prompt、持久化或用户编辑实现。

## 与此前讨论的关系

此前讨论已形成以下基础：

- `12-context-consumption-and-output-alignment.md` 定义 `Context Consumption` 与 `Output Alignment` 是两个独立产品目标；
- `13-alignment-requirement-levels.md` 定义 TeachingGuidance 的三层产品语义：`Required`、`Recommended`、`Evaluation Focus`；
- `14-guidance-constraint-strength-and-failure-semantics.md` 定义三层 Guidance 的约束强度、coverage 影响和失败语义。

本文进一步回答：

```text
Output Alignment 应该在 scene 生成前判断，还是在 scene 生成后判断？
```

结论不是二选一，而是两阶段：

```text
scene 生成前：Outline Preflight Alignment
  判断 outline 计划是否具备继续生成 scene 的条件。

scene 生成后：Realized Lesson Alignment
  判断最终课程内容是否真正实现了 outline 中的教学目标、知识范围和教学设计要求。
```

## 核心产品决定

Outline alignment 应在 scene 生成前进行一次前置判断，但这次判断的作用是验证课程设计计划是否具备继续生成 scene 的条件，而不是宣称最终课程已经完成 alignment。

Scene 生成后还必须进行一次实现层面的 alignment 确认，因为只有此时才能判断 outline 中的教学目标、知识范围和教学设计要求是否真正体现在实际课程内容中。

Required 约束在生成前必须至少进入 outline 计划，在生成后必须真正落地；Recommended 在生成前必须被考虑，生成后诚实记录是否采用；Evaluation Focus 在生成前进入关注范围，生成后检查是否形成足够证据。

可以概括为：

```text
生成前：
  防止错误 outline 消耗 scene token。

生成后：
  防止正确 outline 被错误 scene 实现。

最终 alignment：
  不能只看计划，也不能只看提示词；
  必须同时考虑 outline 设计与 scene realization。
```

## 为什么不能只在 scene 生成前判断

Scene 生成前只有 outline，通常包括标题、描述、关键点、场景类型、顺序或简要活动意图。这个阶段适合检查课程计划是否已经把 DeepTutor 的必要语义纳入设计，但它不能证明最终课堂内容已经实现这些语义。

例如，outline 可以声明：

```text
先通过图像建立斜率直觉，再进入公式练习。
```

这可以证明 plan-level 设计方向存在，但不能证明后续生成的 scene 真正做到：

- 在独立练习前提供充分示范；
- 正确解释图像与公式之间的关系；
- 避免把斜率和截距混淆；
- 提供适当的比较或迁移活动；
- 没有在具体内容中引入未授权知识范围。

如果只在 scene 生成前判断，就容易把“计划存在”误当成“实现完成”。因此，生成前判断只能产生 preflight 或 planned alignment 结论，不能独立构成最终课程的完整 Output Alignment 证明。

## 为什么不能只在 scene 生成后判断

如果只在 scene 生成后判断，结构性问题会被推迟到成本最高的阶段才发现。若 outline 本身已经缺少 Required 约束，继续生成所有 scene 往往只是把错误计划扩展成更多内容。

典型问题包括：

- 必要学习目标没有进入 outline；
- 前置知识激活缺失；
- 必须遵守的教学顺序已经错误；
- 授权知识范围在 outline 阶段已经越界；
- 明确排除项在 outline 阶段已经被违反；
- outline 计划提前物化了不属于课前的 checkpoint/remediation 控制命令。

这些问题在 outline 阶段通常更容易、更便宜地发现。若等到 scene 全部生成后再发现，会增加 token 消耗、等待时间、恢复复杂度，并使系统更难判断问题来自 outline 计划还是 scene 实现。因此，scene 生成前必须存在一次 outline-level preflight alignment。

## Outline Preflight Alignment：scene 生成前的准入判断

`Outline Preflight Alignment` 的作用是判断当前 outline 计划是否具备继续进入 scene generation 的条件。它不是最终课程对齐证明，而是课程设计计划的准入检查。

该阶段适合判断：

- Required 学习目标是否已进入整体课程计划；
- 授权知识范围是否被计划覆盖；
- 必要前置知识是否被安排在合适位置；
- 明确排除项是否被违反；
- Required 教学顺序或认知递进是否在 outline 中可见；
- Recommended 是否被纳入课程设计考虑；
- Evaluation Focus 是否进入后续设计和判断的关注范围；
- outline 是否仍然是普通 OpenMAIC 课前 outline，而不是课前 checkpoint/remediation 控制计划。

如果生成前已能确定 Required 计划缺失或违反硬边界，系统不应继续按正常 aligned path 生成 scene。此时更准确的状态是：

```text
outline generation succeeded；
outline preflight alignment failed；
scene generation should not proceed as a normal aligned path。
```

后续可以选择重新生成 outline、进入人工修订、保留非正式草稿、显示 alignment issue 或进入显式恢复路径。具体产品处理属于后续 Feature 决策，但不能把 preflight failure 伪装成 Provider failure 或完整 alignment 成功。

## Realized Lesson Alignment：scene 生成后的实现确认

`Realized Lesson Alignment` 的作用是确认最终 scene 内容是否真正实现了 outline 计划和冻结 DeepTutor 上下文中的相关语义。它关注真实产物，而不仅是课程计划。

该阶段适合判断：

- Required 是否在实际 scene 中落地；
- scene 是否忠实实现 outline 中的目标、范围和教学顺序；
- 推荐策略实际采用、部分采用还是未采用；
- Evaluation Focus 是否获得足够内容证据；
- scene 生成过程中是否发生语义漂移；
- 具体内容是否引入未授权知识范围；
- outline 中声明的活动是否在实际 scene 中存在；
- scene 之间是否出现破坏 Required 约束的断裂或倒置。

如果 outline 阶段通过 preflight，但 scene 生成后发现 Required 没有真正实现，则最终 alignment 不能成立。这类问题可能适合局部 scene 重生成、相关片段修订、回退到 outline 重生成，或在严重情况下阻止正式发布。

## 三层 Guidance 在两个阶段的不同职责

| Guidance 层级 | Outline Preflight Alignment | Realized Lesson Alignment |
|---|---|---|
| Required | 必须进入 outline 计划；明显缺失或违反时不应继续正常 scene generation | 必须在实际 scene 中实现；未实现则最终 alignment 有问题 |
| Recommended | 必须被纳入 outline 设计考虑；可决定不采用 | 诚实记录已采用、部分采用或未采用；未采用不自动失败 |
| Evaluation Focus | 必须进入后续设计和判断的关注范围；不要求固定 scene | 检查实际 scene 是否提供相关证据；证据不足通常影响评估完整性或产生 warning |

这表明，三层 Guidance 的约束强度与判断阶段是两个不同维度：

```text
Guidance 层级决定“不满足时有多严重”；
判断阶段决定“当前能证明到什么程度”。
```

因此，不能简单认为 Required 只在生成前判断，也不能认为 Evaluation Focus 只在生成后判断。更准确的是：每一层 Guidance 在两个阶段都可能有不同成熟度的证据。

## planned alignment 与 realized alignment

产品语义上应区分：

```text
Planned alignment
  outline 计划已经体现或安排了相关教学要求。

Realized alignment
  实际生成的 scene 内容真正实现了这些教学要求。
```

Planned alignment 可以作为 scene generation 的准入条件，但不能替代 realized alignment。Realized alignment 是最终课程级 Output Alignment 的必要组成部分，因为最终交付给用户的是完整课堂，而不仅是 outline 计划。

如果未来存在 `outlineCoverage` 或类似 artifact，应避免把 outline 阶段的 planned coverage 误称为最终 coverage。更准确的生命周期是：

```text
outline 阶段：
  产生用于 scene generation 的初步对齐判断。

scene 阶段：
  对初步判断进行确认、降级、修正或标记为过期。

最终：
  以实际 scene realization 为基础形成课程级 alignment 结论。
```

## 对 token 成本和质量的影响

两阶段模型兼顾成本和质量：

- 前置检查可以在最便宜的阶段发现结构性错误，避免把错误 outline 扩展成大量 scene；
- 后置确认可以发现 outline 阶段无法观察的实现偏差，避免正确计划在 scene 生成中被错误实现。

这不是要求把同一套 evaluation 完整执行两次。更合理的产品职责分工是：

```text
生成前：
  重点检查结构、范围、目标、顺序和设计意图是否进入 outline。

生成后：
  重点检查 scene 是否忠实实现 outline，并提供实际内容证据。
```

因此，两阶段模型不是双倍评估，而是分阶段降低风险：前置阶段减少浪费，后置阶段提高最终结果可信度。

## 当前产品边界

本文只确定 Output Alignment 的阶段生命周期，不决定：

- outline preflight 使用哪些字段或 evaluator；
- realized alignment 使用哪些字段或 evaluator；
- preflight failure 是否自动重新生成、进入人工修订或阻止发布；
- scene 生成后发现问题时如何局部修复；
- planned coverage 与 final coverage 的具体 schema；
- outline、scene regeneration、reorder 或用户编辑后的重新判断方式；
- alignment evidence 如何持久化或展示给用户。

这些问题应在后续 semantic model、conceptual JSON、架构更新和独立 Feature 合同中分别确定。
