# Pre-class Fusion Output Alignment 概念性 JSON

> 本文记录 FUSION/11 第六项产品语义讨论结果，承接 `12-context-consumption-and-output-alignment.md` 至 `16-output-alignment-semantic-model.md`。
>
> 本文的任务不是重新定义 Output Alignment，而是把 `16` 已确认的语义层级表达成一组可读、可检查的候选 JSON。本文不是 Feature 合同、架构 SSOT、最终 API schema、数据库 schema、跨边界 DTO 或实现授权。字段名、枚举值、版本策略、持久化方式和 evaluator 实现仍需后续单独决定。

## 一、文档定位：17 只负责“表达”，不重新发明语义

`16` 已经确定了 Output Alignment 的核心语义链：

```text
Assessment Subject
    ↓
Assessment Dimensions
    ↓
Assessment Items
    ├── Judgment
    ├── Evidence
    └── Limitation
    ↓
Server Aggregation
    ↓
Overall Assessment / Summary

完整 Assessment
    ↓ derive
Derived View
    ↓
Outline Coverage
```

因此，`17` 只检查一个问题：

> 上述对象、关系和状态，能否在一个不自相矛盾的概念性 JSON 中同时表达？

如果 JSON 无法自然表达这些关系，应回到 `16` 修正产品语义，而不是继续增加字段掩盖概念问题。

本文件继续遵守以下边界：

- `Context Consumption` 与 `Output Alignment` 仍是两个独立目标；
- 一份 Assessment 只描述一个证据阶段：`preflight` 或 `realized`；
- `Objective`、`Knowledge Scope`、`Guidance` 是三大 Assessment Dimensions；
- 每个局部 Assessment Item 由 `Judgment + Evidence + Limitation` 构成；
- `Summary / Overall Assessment` 属于服务器聚合层，不属于单个局部 Item；
- `outlineCoverage` 是派生视图，不是完整 Assessment 内部的第二套事实。

## 二、五个核心概念在 JSON 中各自承担什么职责

### 1. Assessment Subject

`Assessment Subject` 回答：

> 这一次 Alignment 判断针对哪一个具体、可版本化的课程产物？

它至少需要绑定：

```text
FrozenLessonGenerationContext
Outline Revision
Lesson Realization Revision（realized 阶段）
Assessment Stage
```

它不回答“判断结果是什么”，只限定本次判断的版本主体。

### 2. Assessment Dimensions

`Assessment Dimensions` 回答：

> 对同一个 Subject，需要从哪些互不替代的角度进行判断？

当前固定为：

```text
Objective Alignment
Knowledge-Scope Alignment
Guidance Alignment
```

Dimension 只是评估分类轴，不直接等于某个通过/失败结果。每个 Dimension 下还需要形成一个或多个具体 Assessment Item。

### 3. Server Aggregation

`Server Aggregation` 回答：

> 多个局部 Judgment 如何形成当前阶段的课程级整体结论？

它发生在局部判断之后，必须遵守 `16` 已定义的规范强度。例如：

- Required 的明确 `Violated` 不能被其他局部高覆盖率抵消；
- Recommended 的 `Not adopted` 不自动导致整体失败；
- Evaluation Focus 的证据不足会限制结论完整性，但通常不直接等同于 Required failure。

整体结果必须由服务器根据 authoritative local judgments 聚合，不能由浏览器或生成模型自行声明。

### 4. Derived View

`Derived View` 是从完整 Assessment 派生出的简化读取视图。

它具有两个重要约束：

```text
Derived View 不产生新的权威事实；
Derived View 不能反向覆盖 Source Assessment。
```

当源 Assessment 变化、失效或重新计算时，派生视图应重新生成，而不是独立保持一套可能冲突的状态。

### 5. Outline Coverage

`Outline Coverage` 是当前定义的一个具体 Derived View。

它面向 lesson-level 快速读取，例如摘要：

- 哪些 Objective 已有课程设计证据；
- 哪些知识范围得到表示；
- 哪些 Recommended approach 最终被采用。

它不是 coverage 百分比，也不是完整 Alignment Assessment。它不能替代 `Violated`、`Unproven`、Evidence、Limitation、Blocking Issue 等详细语义。

## 三、完整概念对象关系

概念上，完整结构应理解为：

```text
OutlineAlignmentAssessment
│
├── Assessment Subject
│      ├── Frozen Context
│      ├── Outline Revision
│      ├── Realization Revision
│      └── Stage
│
├── Assessment Dimensions
│      │
│      ├── Objective Alignment
│      │      └── Assessment Items
│      │             ├── Target
│      │             ├── Judgment
│      │             ├── Evidence
│      │             └── Limitation
│      │
│      ├── Knowledge-Scope Alignment
│      │      └── Assessment Items
│      │             ├── Target
│      │             ├── Judgment
│      │             ├── Evidence
│      │             └── Limitation
│      │
│      └── Guidance Alignment
│             ├── Required Items
│             ├── Recommended Items
│             └── Evaluation Focus Items
│                    ↓
│             每个 Item 均由
│             Judgment + Evidence + Limitation 构成
│
└── Server Aggregation
       ├── Overall Result
       ├── Blocking Issues
       ├── Warnings
       └── Overall Limitations

OutlineAlignmentAssessment
       ↓ derive
OutlineCoverage
```

这张关系图是本文所有候选 JSON 的语义基准。

## 四、顶层候选 JSON 骨架

一份 Assessment 只表示一个阶段的判断快照：

```json
{
  "assessmentId": "assessment-...",
  "subject": {
    "contextId": "context-...",
    "semanticRequestDigest": "digest-...",
    "outlineRevision": "outline-rev-...",
    "realizationRevision": null,
    "stage": "preflight"
  },
  "dimensions": {
    "objective": {
      "items": []
    },
    "knowledgeScope": {
      "items": []
    },
    "guidance": {
      "requiredItems": [],
      "recommendedItems": [],
      "evaluationFocusItems": []
    }
  },
  "aggregation": {
    "overallResult": "aligned",
    "blockingIssues": [],
    "warnings": [],
    "limitations": []
  },
  "evidence": []
}
```

这个骨架表达四个层次：

```text
subject
  判断谁。

dimensions / items
  具体判断什么。

aggregation
  多个局部 Judgment 如何形成整体结论。

evidence
  局部 Judgment 引用的可定位课程证据。
```

`outlineCoverage` 不内嵌在这个权威 Assessment 中，而是单独由它派生。

## 五、Assessment Subject 与阶段表达

候选表达：

```json
{
  "subject": {
    "contextId": "context-123",
    "semanticRequestDigest": "digest-abc",
    "outlineRevision": "outline-rev-7",
    "realizationRevision": null,
    "stage": "preflight"
  }
}
```

字段的概念含义：

```text
contextId
  指向服务器拥有的 FrozenLessonGenerationContext。

semanticRequestDigest
  绑定该冻结上下文所依据的规范化课程语义。

outlineRevision
  标识当前被判断的课纲版本。

realizationRevision
  realized 阶段标识具体 scene/content realization；preflight 阶段为空。

stage
  表明这是一份 preflight 还是 realized Assessment。
```

`stage` 只出现在 Assessment 级，不在每个局部 Item 中重复。

原因是：

```text
一份 Assessment = 一个阶段的一次判断快照。
```

因此不会出现：

```text
assessment.stage = realized
item.stage = preflight
```

这种语义冲突。

### Preflight 与 Realized 的关系

Preflight 与 Realized 应产生两份 Assessment：

```text
Assessment A
  subject = Context C + Outline O
  stage = preflight

Assessment B
  subject = Context C + Outline O + Realization R
  stage = realized
```

它们属于同一 context + outline lineage，但不需要强塞进同一个 JSON 的 `stages.preflight / stages.realized` 中。

因此可以自然表达：

```text
Preflight：Required R1 = Satisfied
Realized： Required R1 = Violated
```

Realized 结果不会被旧的 Preflight 结果覆盖。

## 六、局部 Assessment Item 的统一结构

三大 Dimension 的具体判断都应遵循同一条局部记录范式：

```text
Assessment Item
  Target
  Judgment
  Evidence references
  Limitations
  Reason（可选）
```

候选基础形式：

```json
{
  "itemId": "item-...",
  "target": {
    "type": "...",
    "id": "..."
  },
  "judgment": {
    "status": "...",
    "reasonCode": null
  },
  "evidenceRefs": [],
  "limitations": []
}
```

这里：

```text
target
  说明这条判断针对哪个具体 objective、knowledge requirement 或 guidance item。

judgment
  说明服务器对该 target 得出的语义结论。

evidenceRefs
  指向支持该 Judgment 的课程位置。

limitations
  约束该 Judgment 的解释边界。

reasonCode
  解释为什么得到当前状态，而不是重复状态本身。
```

例如不应出现：

```text
status = not_adopted
reasonCode = recommended_not_adopted
```

因为这只是重复同一个事实。

更合理的是：

```text
status = not_adopted
reasonCode = duration_constraint
```

即：

```text
status = 发生了什么；
reasonCode = 为什么发生。
```

## 七、Objective Alignment 的候选表达

Objective Dimension 可以包含多个 Objective Item：

```json
{
  "objective": {
    "items": [
      {
        "itemId": "objective-item-1",
        "target": {
          "type": "learning_objective",
          "id": "objective-1"
        },
        "judgment": {
          "status": "satisfied",
          "reasonCode": null
        },
        "evidenceRefs": [
          "evidence-12",
          "evidence-18"
        ],
        "limitations": [
          {
            "reasonCode": "does_not_establish_learner_achievement"
          }
        ]
      }
    ]
  }
}
```

Objective Item 关注课程设计是否朝向该学习目标，并有相应内容、活动或练习支持。

概念上至少需要表达：

```text
Satisfied
  有足够课程设计证据支持该 Objective 已进入并得到实现。

Unproven
  已经尝试判断，但证据不足以确认该 Objective 已得到充分课程设计支持。

Not applicable
  该目标对当前阶段或判断对象不适用。

Not assessed
  尚未执行判断。

Stale
  旧版本判断已不再适用于当前 Subject。
```

`Violated` 是否作为 Objective 的最终正式 vocabulary 暂不在本文冻结。Objective 与规范性 Required 并不完全相同；如果后续需要区分“目标缺失 / 目标未充分支持 / 明确冲突”，应在后续 schema 决策中处理，而不是在本候选 JSON 中提前固化。

无论状态名如何最终确定，Objective Judgment 都不能解释为 learner 已经掌握目标。

## 八、Knowledge-Scope Alignment 的候选表达

Knowledge Scope 不应继续被压缩成一个单一大对象：

```text
knowledgeScopeAssessment.status
```

因为它同时涉及多种不同语义：

```text
Required Knowledge
  当前课程必须实际处理的知识。

Supporting Knowledge
  前置、关系解释或辅助教学所需/允许使用的知识。

Authorized Scope
  当前课程可以合法使用的知识边界。

Exclusion / Scope Constraint
  明确禁止或需要避免的范围扩展。
```

因此 Knowledge-Scope Dimension 更适合形成多个 Assessment Item。例如：

```json
{
  "knowledgeScope": {
    "items": [
      {
        "itemId": "knowledge-item-1",
        "target": {
          "type": "required_knowledge",
          "id": "knowledge-ref-1"
        },
        "judgment": {
          "status": "satisfied",
          "reasonCode": null
        },
        "evidenceRefs": ["evidence-20"],
        "limitations": []
      },
      {
        "itemId": "knowledge-item-2",
        "target": {
          "type": "scope_boundary",
          "id": "authorized-scope-1"
        },
        "judgment": {
          "status": "satisfied",
          "reasonCode": null
        },
        "evidenceRefs": ["evidence-21"],
        "limitations": []
      },
      {
        "itemId": "knowledge-item-3",
        "target": {
          "type": "exclusion",
          "id": "exclusion-1"
        },
        "judgment": {
          "status": "satisfied",
          "reasonCode": null
        },
        "evidenceRefs": [],
        "limitations": []
      }
    ]
  }
}
```

这里不要求最终实现必须采用这些 `type` 名称；它们只是验证一个语义事实：

> “必须处理的知识”“允许的知识边界”“支持性知识”“排除项”不能被一个 `authorizedRefs / representedRefs` 列表混成同一种义务。

Knowledge-Scope Alignment 仍然只判断范围与关系，不承诺：

```text
knowledgeCorrect = true
```

因为知识范围对齐不等于知识事实正确性。

## 九、Guidance Alignment 的候选表达

Guidance Dimension 内部保留三种规范强度：

```text
Required
Recommended
Evaluation Focus
```

三者都属于局部 Assessment Item，但 Judgment vocabulary 不相同。

### 1. Required Items

```json
{
  "requiredItems": [
    {
      "itemId": "required-item-1",
      "target": {
        "type": "required_guidance",
        "id": "guidance-required-1"
      },
      "judgment": {
        "status": "satisfied",
        "reasonCode": null
      },
      "evidenceRefs": ["evidence-30"],
      "limitations": []
    }
  ]
}
```

概念状态：

```text
Satisfied
Violated
Unproven
Not applicable
Not assessed
Stale
```

其中：

```text
Violated
  是核心 alignment 问题。

Unproven
  不能宣称该 Required 已充分满足，但也不能伪装成明确 violation。
```

### 2. Recommended Items

Recommended 判断的是最终课程中的采纳程度，而不是生成过程中“有没有考虑过”。

候选表达：

```json
{
  "recommendedItems": [
    {
      "itemId": "recommended-item-1",
      "target": {
        "type": "recommended_guidance",
        "id": "guidance-recommended-1"
      },
      "judgment": {
        "status": "not_adopted",
        "reasonCode": "duration_constraint"
      },
      "evidenceRefs": [],
      "limitations": []
    }
  ]
}
```

概念状态：

```text
Adopted
Partially adopted
Not adopted
Unproven
Not assessed
Stale
```

`Not considered` 不作为 Output Alignment 的主要状态。

原因是：

```text
是否在生成决策中被考虑
  = Context Consumption 问题。

最终课程是否采用
  = Output Alignment 问题。
```

不能在 `17` 中重新把两个已经拆开的产品目标混回同一个状态枚举。

### 3. Evaluation Focus Items

Evaluation Focus 不规定固定教学动作，因此它关注的是当前课程是否提供相关证据，以及是否暴露出 concern。

候选表达：

```json
{
  "evaluationFocusItems": [
    {
      "itemId": "focus-item-1",
      "target": {
        "type": "evaluation_focus",
        "id": "focus-1"
      },
      "judgment": {
        "status": "evidence_found",
        "reasonCode": null
      },
      "evidenceRefs": ["evidence-41"],
      "limitations": []
    },
    {
      "itemId": "focus-item-2",
      "target": {
        "type": "evaluation_focus",
        "id": "focus-2"
      },
      "judgment": {
        "status": "insufficient_evidence",
        "reasonCode": "insufficient_scene_evidence"
      },
      "evidenceRefs": [],
      "limitations": []
    }
  ]
}
```

概念上可以表达：

```text
Evidence found
Insufficient evidence
Concern found
Not assessed
Stale
```

“是否进入设计关注范围”不与 realized evidence status 混在同一个枚举中。如果后续 Evaluation Focus 发现某个实际 Required violation，应产生对应的 Required Judgment，再由服务器聚合处理。

## 十、Evidence 的候选表达

Evidence 是服务器能够定位的课程证据，不是模型生成的一段“证明文字”。

候选表达：

```json
{
  "evidence": [
    {
      "evidenceId": "evidence-30",
      "kind": "scene",
      "outlineRevision": "outline-rev-7",
      "realizationRevision": "realization-rev-2",
      "location": {
        "sceneId": "scene-4",
        "field": "keyPoints"
      }
    }
  ]
}
```

Evidence 本身不再维护：

```json
{
  "supports": ["objective-1", "guidance-required-1"]
}
```

因为同一个目标在不同 Assessment、不同阶段可能拥有不同 Judgment。更稳妥的关系是：

```text
Assessment Item
  → evidenceRefs
  → Evidence
```

由 Item 单向引用 Evidence，避免双向引用产生不一致。

Evidence 只能回答：

> 哪个课程位置支持当前 Judgment？

它不能证明：

- learner 已经掌握；
- 内容事实已经验证；
- 教学策略已经有效；
- DeepTutor 判断一定正确。

## 十一、Server Aggregation 的候选表达

服务器聚合层只使用 authoritative local judgments 形成当前 Assessment 的整体课程级结论。

候选表达：

```json
{
  "aggregation": {
    "overallResult": "aligned",
    "blockingIssues": [],
    "warnings": [
      {
        "sourceItemId": "recommended-item-1",
        "reasonCode": "recommended_not_adopted"
      }
    ],
    "limitations": []
  }
}
```

这里：

```text
overallResult
  当前阶段的课程级 alignment 结论。

blockingIssues
  使课程不能被视为完整 aligned 的局部问题引用。

warnings
  非阻断的取舍或需要注意的信息。

limitations
  限制整体结论强度或解释边界的信息。
```

聚合规则继续遵守 `16`：

```text
Required = Violated
  → 不能得到完整 aligned。

Required = Unproven
  → 不能宣称证据充分；具体 overall 状态仍需结合阶段。

Recommended = Not adopted
  → 非阻断，不自动导致 failure。

Evaluation Focus = Insufficient evidence
  → 通常形成 limitation / warning，而不是自动 Required failure。
```

当前 overall vocabulary 仍沿用 `16` 的概念讨论，不在本文件冻结最终枚举：

```text
Aligned
Aligned with warnings
Partially aligned
Not aligned
Unevaluated / insufficiently evaluated
```

如果后续决定进一步简化为更少的 overall states，应修改聚合 vocabulary，而不是改变三大 Dimension 或局部 Item 结构。

## 十二、Derived View：Outline Coverage

`outlineCoverage` 不再内嵌进 `OutlineAlignmentAssessment`。

概念关系是：

```text
OutlineAlignmentAssessment
       ↓ derive
OutlineCoverage
```

候选派生视图：

```json
{
  "outlineCoverage": {
    "sourceAssessmentId": "assessment-123",
    "coveredObjectiveIds": [
      "objective-1"
    ],
    "representedKnowledgeRefIds": [
      "knowledge-ref-1"
    ],
    "adoptedRecommendedApproachIds": [
      "guidance-recommended-2"
    ],
    "limitations": []
  }
}
```

它只提供下游快速读取摘要。

它不能独立维护：

```text
overall alignment status；
Required violation；
Required unproven；
Evaluation Focus concern；
权威 evidence；
独立 lifecycle state。
```

这些事实仍以 `OutlineAlignmentAssessment` 为权威来源。

如果 Coverage 与 Source Assessment 不一致，应重新派生 Coverage，而不是选择更乐观的一方。

## 十三、完整候选 JSON 示例

下面示例只展示一份 realized Assessment；Preflight 应产生另一份独立 Assessment。

```json
{
  "assessmentId": "assessment-realized-42",
  "subject": {
    "contextId": "context-123",
    "semanticRequestDigest": "digest-abc",
    "outlineRevision": "outline-rev-7",
    "realizationRevision": "realization-rev-2",
    "stage": "realized"
  },
  "dimensions": {
    "objective": {
      "items": [
        {
          "itemId": "objective-item-1",
          "target": {
            "type": "learning_objective",
            "id": "objective-1"
          },
          "judgment": {
            "status": "satisfied",
            "reasonCode": null
          },
          "evidenceRefs": ["evidence-1"],
          "limitations": [
            {
              "reasonCode": "does_not_establish_learner_achievement"
            }
          ]
        }
      ]
    },
    "knowledgeScope": {
      "items": [
        {
          "itemId": "knowledge-item-1",
          "target": {
            "type": "required_knowledge",
            "id": "knowledge-ref-1"
          },
          "judgment": {
            "status": "satisfied",
            "reasonCode": null
          },
          "evidenceRefs": ["evidence-2"],
          "limitations": []
        }
      ]
    },
    "guidance": {
      "requiredItems": [
        {
          "itemId": "required-item-1",
          "target": {
            "type": "required_guidance",
            "id": "guidance-required-1"
          },
          "judgment": {
            "status": "satisfied",
            "reasonCode": null
          },
          "evidenceRefs": ["evidence-3"],
          "limitations": []
        }
      ],
      "recommendedItems": [
        {
          "itemId": "recommended-item-1",
          "target": {
            "type": "recommended_guidance",
            "id": "guidance-recommended-1"
          },
          "judgment": {
            "status": "not_adopted",
            "reasonCode": "duration_constraint"
          },
          "evidenceRefs": [],
          "limitations": []
        }
      ],
      "evaluationFocusItems": [
        {
          "itemId": "focus-item-1",
          "target": {
            "type": "evaluation_focus",
            "id": "focus-1"
          },
          "judgment": {
            "status": "evidence_found",
            "reasonCode": null
          },
          "evidenceRefs": ["evidence-4"],
          "limitations": []
        }
      ]
    }
  },
  "aggregation": {
    "overallResult": "aligned_with_warnings",
    "blockingIssues": [],
    "warnings": [
      {
        "sourceItemId": "recommended-item-1",
        "reasonCode": "recommended_not_adopted"
      }
    ],
    "limitations": []
  },
  "evidence": [
    {
      "evidenceId": "evidence-1",
      "kind": "scene",
      "outlineRevision": "outline-rev-7",
      "realizationRevision": "realization-rev-2",
      "location": {
        "sceneId": "scene-2",
        "field": "keyPoints"
      }
    },
    {
      "evidenceId": "evidence-2",
      "kind": "scene",
      "outlineRevision": "outline-rev-7",
      "realizationRevision": "realization-rev-2",
      "location": {
        "sceneId": "scene-3",
        "field": "content"
      }
    },
    {
      "evidenceId": "evidence-3",
      "kind": "scene",
      "outlineRevision": "outline-rev-7",
      "realizationRevision": "realization-rev-2",
      "location": {
        "sceneId": "scene-4",
        "field": "activity"
      }
    },
    {
      "evidenceId": "evidence-4",
      "kind": "scene",
      "outlineRevision": "outline-rev-7",
      "realizationRevision": "realization-rev-2",
      "location": {
        "sceneId": "scene-5",
        "field": "keyPoints"
      }
    }
  ]
}
```

由该 Assessment 可以另外派生：

```json
{
  "outlineCoverage": {
    "sourceAssessmentId": "assessment-realized-42",
    "coveredObjectiveIds": ["objective-1"],
    "representedKnowledgeRefIds": ["knowledge-ref-1"],
    "adoptedRecommendedApproachIds": [],
    "limitations": []
  }
}
```

两段 JSON 的语义地位不同：

```text
OutlineAlignmentAssessment
  = 权威判断对象。

OutlineCoverage
  = 派生读取视图。
```

## 十四、本文明确删除或不再采用的旧设计

相较初版，本文件明确不再采用以下设计：

### 1. 不在每个局部 Item 重复 `phase`

阶段属于整个 Assessment。

### 2. 不把 Preflight 与 Realized 强塞进同一个 `stages` 对象

两阶段分别形成 Assessment，通过相同 lineage 关联。

### 3. 不把 `not_considered` 作为 Recommended 的主要 Output Alignment 状态

“是否被考虑”属于 Context Consumption；Output Alignment 判断最终采纳程度。

### 4. 不让 Evidence 反向维护 `supports[]`

Assessment Item 单向引用 Evidence。

### 5. 不用一个 `knowledgeScopeAssessment.status` 承担所有知识范围语义

Knowledge Scope 由多个具体 Assessment Item 表达。

### 6. 不把 `outlineCoverage` 内嵌成完整 Assessment 的并列权威部分

它是 Source Assessment 的 Derived View。

### 7. 不把 Summary 当作局部 Assessment Item 的组成部分

局部 Item 只有 Judgment、Evidence 与 Limitation；Summary 属于 Server Aggregation。

## 十五、仍需后续决定的问题

本文仍不决定：

- 最终字段名和正式枚举；
- Objective 是否最终使用 `Violated`，还是使用更适合目标表达的 `Missing / Unsupported` 等 vocabulary；
- Knowledge Scope 的 target taxonomy 最终如何命名；
- `Unproven Required` 在 preflight 和 realized 阶段分别映射到哪一种 overall result；
- `Aligned with warnings / Partially aligned / Unevaluated` 是否继续保留，还是进一步简化整体状态；
- Evidence 的最终定位粒度、版本策略和持久化生命周期；
- `OutlineAlignmentAssessment` 是否只作为 OpenMAIC 内部 artifact，还是有受控的跨边界读取形态；
- `outlineCoverage` 是只在 realized 后生成，还是允许 preflight provisional view；
- Required failure 是否阻止发布、触发 regeneration 或保留草稿；
- user edit、outline regeneration、scene regeneration 和 reorder 如何触发 Assessment 失效和重新评估。

这些问题属于后续架构 SSOT 与 Feature 合同，不应通过继续给候选 JSON 增加字段提前决定。

## 十六、17 的最终语义结论

本文最终确认的不是某一套固定 JSON schema，而是以下对象关系：

```text
Assessment Subject
  确定判断谁。

Assessment Dimensions
  确定从哪些互不替代的角度判断。

Assessment Items
  把每个具体 Objective、Knowledge Scope 要求或 Guidance 项变成局部判断单元。

Judgment + Evidence + Limitation
  构成每个局部 Assessment Item 的完整语义记录。

Server Aggregation
  把 authoritative local judgments 聚合为当前阶段的课程级 Overall Assessment。

Derived View
  从完整 Assessment 派生简化读取结果。

Outline Coverage
  是当前定义的一个 lesson-level Derived View，不是第二个权威事实源。
```

这套关系必须保持不变；未来最终 schema 可以更换字段名、嵌套方式或持久化形态，但不能重新混淆这些语义层级。
