# Pre-class Fusion outline shaping and lesson-level coverage — initial concept note

> This is an initial design note, not a Feature contract and not the current architecture SSOT. It records the direction for the second piece of work after F60 and must not be treated as an implementation authorization. A later architecture update must settle the ownership, lifecycle, validation strength, and compatibility rules before a new Feature contract is created.

## Problem

The current pre-class path proves that `FrozenLessonGenerationContext` can reach the generation prompt and that formal metadata can be associated with it. That is weaker than the intended product result. The desired result is that DeepTutor's teaching guidance and knowledge mapping shape the ordinary OpenMAIC outline as a whole, rather than appearing only as prompt text or being materialized through a pre-class checkpoint/remediation pair.

The design should therefore prove two different facts without conflating them:

1. **Input consumption:** the server-side outline generator received the validated, frozen DeepTutor semantic projection.
2. **Output influence:** the resulting outline has a defensible lesson-level relationship to the topic, learning objectives, authorized knowledge mapping, and recommended teaching approaches.

The second fact must not require every slide or interactive scene to carry a full Frozen Context or a strict knowledge-graph node binding.

## Proposed target flow

```text
LessonSemanticRequest
  -> DeepTutor PreClassTeachingContextProposal
  -> FrozenLessonGenerationContext
  -> FormalTeachingDesignBrief (safe generation projection)
  -> ordinary OpenMAIC outline generation
  -> server-side outline quality/alignment evaluation
  -> server-owned OutlineCoverage
  -> scene content/actions generation and optional regeneration
```

The pre-class path should continue to generate ordinary OpenMAIC scene types. It should not create a mandatory checkpoint/remediation pair. Checkpoint attempts, diagnosis, remediation directives, and runtime path changes belong to the in-class Fusion handoff.

## Proposed generation projection

Do not pass the complete frozen object or raw DeepTutor response to the model. Build an explicit `FormalTeachingDesignBrief` containing only the minimum generation-facing semantics, such as:

```text
contextId
semanticRequestDigest
normalizedTopic
normalizedLearningObjectives[]
mappingId
mappingRevision
authorizedKnowledgeRefIds[]
guidanceRevision
recommendedApproaches[]
generation constraints
```

The brief should translate policy labels into usable design requirements. For example, `worked-example-first` should ask for a worked example before independent practice; `retrieval-practice` should require an actual retrieval activity; `transfer-challenge` should shape a later novel application. Knowledge reference IDs remain lineage/audit identifiers unless DeepTutor provides separately authorized teaching summaries; an ID alone is not sufficient instructional content.

The brief must explicitly prohibit learner identity, raw progress, credentials, raw provider payloads, browser-owned context, invented knowledge references, UI commands, and automatic in-class checkpoint/remediation scenes.

## Proposed lesson-level `outlineCoverage`

Persist an OpenMAIC server-owned, versioned coverage artifact alongside the canonical outline rather than adding Frozen Context fields to every scene:

```text
outlineCoverage
  contextId
  semanticRequestDigest
  mappingId
  mappingRevision
  guidanceRevision
  coveredKnowledgeRefIds[]
  coveredLearningObjectives[]
  appliedApproaches[]
  outlineRevision
  evaluationStatus
  evaluatedAt
```

The exact schema, hash profile, and owner remain to be decided in the architecture update. `coveredKnowledgeRefIds` must be a subset of the authorized refs from the frozen context. `outlineRevision` must change when the outline is regenerated, while `contextId`, request digest, mapping revision, and guidance revision remain stable as long as the same frozen context is reused.

The model may propose coverage hints, but the server must own the final coverage artifact. At minimum, server-side evaluation should check that the outline's titles, descriptions, key points, objectives, and scene types provide evidence for the claimed objectives and approaches. A successful JSON parse alone must not count as proof of alignment. If reliable semantic evaluation is not yet available, the result should be explicitly marked partial or unevaluated rather than overstated as teaching effectiveness.

## Regeneration and reorder compatibility

The frozen context is the semantic root, not a frozen copy of the outline. Outline regeneration, scene-content regeneration, and authorized reorder should reuse the same context and create a new outline or scene revision. They must not accept browser-supplied mapping, knowledge scope, digest, or guidance as authority.

A regenerated outline should recompute `outlineCoverage`. A scene-content-only regeneration should retain lesson-level coverage unless the content change triggers a documented alignment warning or a later re-evaluation. Reorder should normally change presentation order, not the semantic lineage; any dependency rules belong to the server-side outline mutation contract and should be designed separately.

This concept intentionally does not decide whether user edits are auto-accepted, reviewed, or submitted through a dedicated mutation API. That decision belongs in the architecture update because it affects OpenMAIC's native editing model and the authoritative outline revision lifecycle.

## Possible later Feature decomposition

After the architecture documents are updated, the second work may need more than one Feature:

1. **Generation brief and outline shaping:** define and implement the safe projection and structured guidance consumption.
2. **Outline coverage and alignment evidence:** define the server-owned artifact, evaluation rules, regeneration semantics, and redacted evidence.
3. **Optional regeneration/edit compatibility:** if the architecture requires a dedicated server mutation/revision path for outline reorder or user edits, handle that separately instead of expanding the first two Features implicitly.

These are possibilities, not approved Feature IDs or scope.

## Open questions for the architecture update

- Is `FormalTeachingDesignBrief` an internal OpenMAIC projection or a cross-boundary domain object?
- Which fields in `outlineCoverage` are integrity metadata, and which are model/evaluation claims?
- Who evaluates coverage: deterministic OpenMAIC rules, DeepTutor, a separate evaluator, or a layered approach?
- What minimum evidence makes `appliedApproaches` credible without claiming educational effectiveness?
- How should incomplete or unevaluated coverage affect generation, user messaging, and ordinary-classroom recovery?
- How are outline regeneration, scene regeneration, reorder, and user edits versioned against one frozen context?
- How are historical sessions with checkpoint/remediation pairs distinguished from new pre-class sessions after F60?
- Which details belong in the pre-class protocol, and which remain OpenMAIC-internal generation metadata?

## Explicit non-goals

This note does not authorize:

- automatic checkpoint/remediation creation in pre-class generation;
- scene-level knowledge-reference binding for every ordinary scene;
- claims that outline coverage proves learning effectiveness;
- changes to DeepTutor's internal Proposal generation algorithm;
- changes to the in-class checkpoint/diagnosis/remediation protocol;
- a new Feature contract before the architecture SSOT is updated and reviewed.
