---
id: F60
title: Pre-class Fusion remove automatic checkpoint/remediation materialization
version: v0.1
status: blocked
dependsOn: [F46, F47, F48, F49, F53, F56, F57]
scope: {"code":["OpenMAIC/app/api/generate/scene-outlines-stream/route.ts","OpenMAIC/lib/fusion/generation-session.ts","OpenMAIC/lib/fusion/adapter/preclass-context-provider.ts","OpenMAIC/lib/fusion/scene-catalog.ts","OpenMAIC/lib/fusion/materialization.ts"],"tests":["OpenMAIC/tests/fusion/**","OpenMAIC/tests/generation/**"],"docs":["docs/harness/ARCHITECTURE.md","docs/harness/ARCHITECTURE/F35_ARCHITECTURE_SPLIT/**","docs/harness/FUSION/02-pre-class-semantic-exchange-protocol.md","docs/harness/FUSION/03-pre-class-fusion-code-migration-roadmap.md","docs/harness/FUSION/04-in-class-semantic-exchange-protocol.md","docs/progress.md","docs/harness/features/F60-preclass-fusion-remove-checkpoint-remediation/**","docs/harness/features/feature-index.json"]}
evidence: {"lastVerifiedAt":"","commands":[],"manualSmoke":""}
completionGate: {"version":"v0.1","l3":"not_required","userPath":[],"integrationEvidence":[],"knownUnverified":["implementation and compatibility verification not yet run"],"humanReviewRequired":["independent read-only review before passing"],"gitEvidence":{"repositories":[]}}
---

# F60 — Remove automatic checkpoint/remediation materialization from pre-class Fusion

> 2026-10-06：用户决定冻结跨应用 Fusion 路线，转向 OpenMAIC 原生增强；本 Feature 因产品路线调整标为 `blocked`，不是通过验收或技术修复完成。原合同、未完成验收与验证要求保留，详见 [freeze.md](freeze.md)。

## Goal

Formal pre-class Fusion must generate an ordinary OpenMAIC lesson outline shaped by the existing pre-class semantic context, without automatically appending a server-created checkpoint/remediation pair. Checkpoints, attempts, diagnosis, remediation directives, and runtime path changes remain an in-class Fusion responsibility. This feature changes the pre-class boundary; it does not remove the in-class protocol or historical read-only compatibility.

The target pre-class path is:

```text
OpenMAIC semantic request
  -> DeepTutor PreClassTeachingContextProposal
  -> FrozenLessonGenerationContext
  -> OpenMAIC ordinary outline generation
  -> ordinary scene/content generation
```

The following path is explicitly removed from new pre-class generation:

```text
FrozenLessonGenerationContext
  -> completeFormalLessonOutlines()
  -> automatic checkpoint scene
  -> automatic remediation scene
```

## Integration decision

- **Integration host:** OpenMAIC server-side formal Fusion generation session and outline-stream route.
- **Identity and authorization owner:** OpenMAIC lesson session plus the existing server-to-server DeepTutor delegation boundary; this feature does not change Launch Code or credential semantics.
- **Authoritative data owners:** DeepTutor remains authoritative for the pre-class teaching proposal and semantic mapping; OpenMAIC remains authoritative for ordinary lesson outlines, scenes, runtime checkpoint facts, and in-class directives.
- **Versioned API/event contract:** Keep the existing pre-class semantic contract and `FrozenLessonGenerationContext` unchanged unless an additive compatibility field is required. In-class `CheckpointAttempt`, `LearningDiagnosis`, `TeachingIntent`, and `SceneDirective` remain governed by the in-class protocol.
- **External AI/data sent:** No new cross-application data. Existing pre-class semantic request and validated teaching context continue to be used; no raw learner profile, raw provider response, credential, or browser-owned material is added.

## Scope

### Allowed changes

- Remove the call that automatically completes a new formal pre-class outline with checkpoint/remediation scenes.
- Ensure a new formal pre-class outline can be persisted and recovered with only ordinary OpenMAIC scene types and the server-owned frozen semantic session context.
- Retain or isolate checkpoint/remediation helper code needed by historical read-only recovery or the future in-class Fusion path; do not silently delete shared runtime capabilities.
- Remove any new-session pre-class requirement that a checkpoint/remediation pair must exist solely for the semantic-context proof.
- Preserve the existing DeepTutor request, strict proposal parsing, frozen-context creation/recovery, browser trust boundary, and ordinary non-Fusion path.
- Add explicit compatibility handling so historical sessions that already contain a formal pair remain readable under their original contract, while new sessions do not receive an automatic pair.
- Update the canonical architecture and pre-class/in-class Fusion documentation to state that pre-class creates ordinary lesson scenes and in-class Fusion owns checkpoint attempts, diagnosis, remediation directives, and dynamic path changes. Regenerate and check architecture fragments through the controlled architecture script.
- Add focused automated tests for absence of automatic pair creation, ordinary-scene persistence/recovery, historical pair compatibility, and preservation of the in-class boundary.

### Out of scope

- Designing or implementing the separate feature that makes DeepTutor guidance shape the entire outline and adds lesson-level `outlineCoverage`; only the initial idea note is recorded separately for now.
- Adding scene-level Frozen Context or knowledge-reference binding to every slide, interactive, quiz, or PBL scene.
- Implementing outline reorder, outline regeneration, scene-content regeneration, or user-edit mutation APIs. These must continue to work from the same frozen context when separately implemented, but are not redesigned here.
- Changing DeepTutor's `PreClassTeachingContextProposal` generation algorithm or transport contract.
- Redesigning the in-class Fusion protocol, checkpoint attempt issuance, diagnosis, Planner, remediation directives, or runtime state.
- Repairing F54/F58 export/materialization acceptance or claiming either feature is passing.
- Destructively migrating historical sessions or removing all checkpoint/remediation modules from the repository.

## Acceptance Criteria

- [ ] A new formal pre-class outline does not invoke automatic checkpoint/remediation completion and contains no server-created `fusion-checkpoint-scene-*` or `fusion-remediation-scene-*` pair solely because formal pre-class Fusion resolved.
- [ ] The same new formal path still constructs, validates, freezes, recovers, and consumes `FrozenLessonGenerationContext`; removing the pair does not remove DeepTutor semantic context.
- [ ] Ordinary generated outlines preserve their existing supported scene types and fields, and ordinary non-Fusion classroom generation is unchanged.
- [ ] New formal pre-class outline persistence and recovery succeeds without requiring checkpoint/remediation metadata or a formal pair in the Scene Catalog.
- [ ] Historical sessions that already contain a pair either recover through their documented legacy/read-only path or fail with an explicit compatibility status; they are not silently rewritten or assigned a new pair.
- [ ] In-class Fusion remains the documented owner of `CheckpointAttempt`, checkpoint evidence, diagnosis, remediation directives, and runtime path changes; this feature does not make pre-class generation responsible for those operations.
- [ ] Browser-submitted checkpoint, remediation, mapping, semantic digest, or context fields cannot reintroduce a pair or override the frozen semantic context.
- [ ] Focused tests, TypeScript checks, architecture split checks, and the applicable harness validation are recorded with no known unverified implementation result before the feature can pass.
- [ ] An independent read-only review confirms that the removal is limited to the pre-class materialization path and does not regress the in-class boundary.

## Risks and compatibility

- Shared helper functions may currently serve both pre-class materialization and in-class/historical recovery. The implementation must follow the call graph and isolate the new-session pre-class path rather than deleting code by name.
- Existing downstream code may assume that every formal outline contains a checkpoint/remediation pair. Such assumptions must become explicit compatibility branches or be removed from the new pre-class path; a missing pair must not be treated as a failed DeepTutor context.
- Historical formal sessions may contain server-generated pair IDs and metadata. They must remain read-only or explicitly versioned; this feature must not rewrite their semantic history.
- F58 and F54 remain blocked. Removing the pre-class pair is a deliberate scope correction, not evidence that downstream export/materialization is complete.
- The architecture currently describes `outline`, `content`, `checkpoint`, and Catalog as consumers of the frozen context. This feature must clarify that checkpoint runtime objects are consumed/created in the in-class handoff, while pre-class ordinary outline generation still consumes the frozen semantic context.
- Rollback is additive at the session/contract level: reverting the OpenMAIC route and helper-call changes restores the prior pre-class pair behavior for newly generated sessions, while historical data remains untouched.

## Completion evidence

- Verification evidence: `docs/harness/features/F60-preclass-fusion-remove-checkpoint-remediation/verification.md`
- Independent review: `docs/harness/features/F60-preclass-fusion-remove-checkpoint-remediation/subagent-review.md` (required before passing)
- Git evidence: if OpenMAIC code is changed, record the pushed `fusion-adapter` commit SHA in `completionGate.gitEvidence`; root architecture and harness documents are not OpenMAIC commits.
