# F59 — Pre-class Fusion semantic context roundtrip proof

## 状态

- `blocked`
- version: `v0.1`
- relatedTo: `F58`, `F54`
- dependsOn: `F46`, `F47`, `F48`, `F49`, `F53`, `F56`, `F57`

## Harness registry metadata

```yaml
scope:
  repository: OpenMAIC
  branch: fusion-adapter
  paths:
    - lib/fusion/preclass-contracts.ts
    - lib/fusion/adapter/preclass-context-provider.ts
    - lib/fusion/generation-session.ts
    - app/api/generate/scene-outlines-stream/route.ts
    - app/api/generate/scene-content/route.ts
    - app/api/generate/scene-actions/route.ts
    - lib/prompts
    - lib/generation
    - tests/fusion
    - tests/generation

evidence:
  directory: classroom/review/F59
  required:
    - semantic request audit
    - DeepTutor context response audit with sensitive data redacted
    - FrozenLessonGenerationContext persistence/recovery audit
    - generation prompt/context-consumption audit
    - generated classroom/context traceability audit
    - focused automated tests

completionGate:
  knownUnverified: true
  humanReviewRequired: true
  gitEvidence:
    repositories:
      - path: OpenMAIC
        branch: fusion-adapter
        commit: 33b01a2628f7d62031187221e8015f03ee4a894a
```

## 目的

证明正式课前 Fusion 中，OpenMAIC 生成的课堂确实使用了 DeepTutor 返回的教学上下文，而不是普通 prompt、浏览器材料或伪造的 checkpoint metadata。

本 Feature 将工作重心从 F58 的下游 checkpoint/remediation materialization/export 修复，调整到上游语义闭环：

```text
OpenMAIC semantic request
  -> DeepTutor pre-class teaching context
  -> FrozenLessonGenerationContext
  -> OpenMAIC outline/content generation
  -> generated classroom evidence linked to the DeepTutor context
```

F59 不以“manifest 里有没有 checkpoint 字段”作为主证明。manifest/export 只能作为最终 traceability 辅助证据。主证明必须来自 DeepTutor context 被正式获取、冻结、消费，并影响 OpenMAIC 课堂生成。

## 背景

F58 修复了一部分正式 checkpoint/remediation pair 在 OpenMAIC 下游链路中丢失的问题，但它偏向：

```text
generatedOutlines -> scene builder -> store -> export
```

这不能充分回答当前产品问题：

```text
OpenMAIC 生成的课堂是否真的使用了 DeepTutor 返回的课前教学上下文？
```

因此 F58 被暂时 blocked，F59 成为新的 active Feature。

## 用户路径

1. 测试用户通过正式 Fusion Launch Code 进入 OpenMAIC。
2. OpenMAIC 根据 lesson/session 信息构造 teaching semantic request。
3. OpenMAIC 将该 semantic request 发送给 DeepTutor。
4. DeepTutor 返回授权、版本化、可审计的 pre-class teaching context。
5. OpenMAIC 将该 context 冻结为 `FrozenLessonGenerationContext`。
6. OpenMAIC 使用该 frozen context 生成 outline、checkpoint/remediation intent 和 scene content。
7. 生成结果可以脱敏证明其知识点、mapping revision 和 teaching guidance 来自 DeepTutor context。
8. 浏览器和导出只承载 traceability，不拥有或伪造 Fusion 语义来源。

## 领域边界

### DeepTutor owns

- learner/profile/knowledge state;
- pre-class teaching context proposal;
- mapping ID and mapping revision;
- recommended teaching guidance;
- authorized knowledge scope;
- context/source revision information.

### OpenMAIC server owns

- semantic request construction;
- authorization boundary for calling DeepTutor;
- `FrozenLessonGenerationContext` persistence;
- prompt/context consumption for outline and content generation;
- scene identity and classroom generation;
- redacted evidence projection.

### Browser does not own

- DeepTutor context;
- mapping ID or mapping revision;
- lesson knowledge scope;
- checkpoint/remediation binding;
- semantic request digest.

Browser may only carry generation progress, content payloads, and redacted traceability evidence returned by server-owned paths.

## Acceptance Criteria

### AC1 — Semantic request is constructed from authorized lesson/session state

OpenMAIC must construct a deterministic, auditable semantic request containing at least:

```text
semanticRequestId
semanticRequestRevision
semanticRequestDigest
normalizedTopic
normalizedLearningObjectives
authorizedKnowledgeScope
lessonSessionId correlation, redacted in evidence
```

Raw learner identity, credentials, Launch Codes, cookies, private prompts, or provider traces must not enter evidence.

### AC2 — DeepTutor response is parsed as formal teaching context

The DeepTutor response must be validated through the formal pre-class contract and include:

```text
lessonKnowledgeMap.mappingId
lessonKnowledgeMap.mappingRevision
lessonKnowledgeMap.knowledgeRefs
teachingGuidance.guidanceRevision
teachingGuidance.recommendedApproaches
sourceRevisions
resolutionStatus
semanticRequestDigest
```

Non-ready responses must fail closed or follow the explicit clarification path. They must not silently fall back to ordinary classroom generation while pretending to be formal Fusion.

### AC3 — FrozenLessonGenerationContext is the server-side SSOT

OpenMAIC must freeze exactly one formal context for a session and persist it server-side. Subsequent generation stages must recover and use the same frozen context. Browser-provided raw materials or metadata cannot replace it.

### AC4 — Outline generation consumes the frozen DeepTutor context

The outline generation prompt/context must include a minimal, redacted projection of the frozen teaching guidance sufficient to influence generation, for example:

```text
normalizedTopic
recommendedApproaches
mapped checkpoint requirement
knowledgeRefs or lessonKnowledgePointIds
mapping revision reference where safe
```

Evidence must prove the context was injected into the server generation path without exposing private learner data or raw DeepTutor payloads.

### AC5 — Generated outlines carry traceable context-derived intent

Generated outlines must demonstrate that the lesson was shaped by DeepTutor context, not only by the user's generic topic. Acceptable proof includes redacted summaries showing:

```text
outline key points overlap authorized knowledgeRefs;
checkpoint/remediation intent references mapped knowledge;
remediation strategy follows recommendedApproaches;
formal metadata uses the same mappingId/mappingRevision as FrozenLessonGenerationContext.
```

### AC6 — Scene content generation does not discard formal context

`scene-content` and `scene-actions` routes must recover the same formal session/context for formal lessons. If they use a context projection, it must be server-owned. If they intentionally only rely on server canonical outlines, that boundary must be documented and tested.

### AC7 — Traceability evidence is redacted and reproducible

Evidence under `classroom/review/F59/<batch>/` must include machine-readable and human-readable summaries of:

```text
semantic request digest
DeepTutor context digest or redacted context summary
mappingId/mappingRevision presence
FrozenLessonGenerationContext persistence/recovery
outline generation context injection
resulting generated outline/context alignment
```

No evidence may contain tokens, cookies, Launch Codes, learner profiles, raw DeepTutor responses, private prompts, API keys, or model traces.

### AC8 — Downstream F58/F54 concerns remain separated

F59 may record whether checkpoint/remediation metadata appears downstream, but it must not claim F58 or F54 passing. F58 remains blocked until downstream materialization/export evidence passes independently.

## Investigation and implementation scope

Primary files to inspect and potentially modify:

```text
OpenMAIC/lib/fusion/preclass-contracts.ts
OpenMAIC/lib/fusion/adapter/preclass-context-provider.ts
OpenMAIC/lib/fusion/generation-session.ts
OpenMAIC/app/api/generate/scene-outlines-stream/route.ts
OpenMAIC/app/api/generate/scene-content/route.ts
OpenMAIC/app/api/generate/scene-actions/route.ts
OpenMAIC/lib/prompts/**
OpenMAIC/lib/generation/**
OpenMAIC/tests/fusion/**
OpenMAIC/tests/generation/**
```

Do not modify DeepTutor unless inspection proves OpenMAIC cannot obtain the required context from the existing DeepTutor contract.

## Exclusions

F59 does not attempt to complete:

- full F58 materialization ledger lifecycle;
- final `.maic` export repair;
- in-class dynamic adjustment;
- post-class writeback;
- learner profile mutation;
- UI redesign.

## Verification Requirements

### Static review

Trace and document:

1. how OpenMAIC constructs semantic request;
2. how DeepTutor context is requested and parsed;
3. where `FrozenLessonGenerationContext` is persisted;
4. how outline/content generation consumes or intentionally derives from that context;
5. what evidence links generated classroom artifacts to the context.

### Automated tests

Add focused tests for:

- semantic request construction and digest stability;
- DeepTutor response parsing and rejection of non-ready/invalid context;
- frozen context reuse across repeated generation attempts;
- outline prompt/context injection containing teaching guidance but not learner identity;
- generated formal metadata matching mappingId/mappingRevision from frozen context;
- browser-supplied context spoofing rejection.

### Manual / integration evidence

Run a fresh formal pre-class flow using:

```text
Linear functions and graphs
```

Record only redacted evidence sufficient to prove context roundtrip and classroom alignment.

### Independent review

Before marking `passing`, commission independent read-only review limited to:

- F59 feature/verification docs;
- relevant code diff;
- redacted evidence;
- test results.

A `FAIL` or `BLOCKED` review keeps F59 active or blocked.

### Git

If OpenMAIC code changes are made, commit and push to:

```text
OpenMAIC/fusion-adapter
```

Record the final commit SHA in verification.
