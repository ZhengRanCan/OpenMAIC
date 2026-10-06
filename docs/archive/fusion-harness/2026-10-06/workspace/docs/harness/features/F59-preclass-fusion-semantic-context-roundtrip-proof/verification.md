# F59 verification

## Verification status

- status: `blocked`
- feature: `F59-preclass-fusion-semantic-context-roundtrip-proof`
- scope: prove OpenMAIC classrooms are generated from DeepTutor returned pre-class teaching context
- F58 status: `blocked`
- F54 status: `blocked`

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

## Why F59 exists

F58 repaired part of the downstream checkpoint/remediation materialization and export traceability problem, but the user's current priority is upstream pre-class Fusion proof:

```text
OpenMAIC generated classroom content must demonstrably use DeepTutor's returned teaching context.
```

A classroom export with checkpoint metadata is not enough. F59 must prove the semantic roundtrip from OpenMAIC to DeepTutor and back into OpenMAIC generation.

## Target chain

```text
Launch / LessonBinding
  -> OpenMAIC semantic request construction
  -> DeepTutor formal pre-class context request
  -> DeepTutor teaching context response
  -> FrozenLessonGenerationContext persistence
  -> outline generation context injection
  -> generated outlines aligned to mapping/guidance
  -> scene content/actions formal context boundary
  -> redacted evidence package
```

## Investigation matrix

| Boundary | Required evidence | Status |
|---|---|---|
| Launch/session binding | redacted lessonSession correlation exists | pending |
| Semantic request construction | stable digest and authorized knowledge scope | pending |
| DeepTutor request | formal provider path called, no browser raw material authority | pending |
| DeepTutor response parsing | mappingId, mappingRevision, knowledgeRefs, guidance revision | pending |
| Context freeze | one FrozenLessonGenerationContext persisted per session | pending |
| Context recovery | repeated stages use same frozen context | pending |
| Outline prompt injection | minimal redacted guidance enters server prompt/context | pending |
| Generated outline alignment | outlines reflect mapping/guidance | pending |
| Content/actions boundary | server canonical context/outline used, browser spoofing rejected | pending |
| Evidence redaction | no sensitive data stored | pending |

## Failure classifications

Use these classifications when creating evidence:

```text
SEMANTIC_REQUEST_MISSING
SEMANTIC_REQUEST_SCOPE_INVALID
DEEPTUTOR_CONTEXT_NOT_REQUESTED
DEEPTUTOR_CONTEXT_INVALID
DEEPTUTOR_CONTEXT_NOT_FROZEN
FROZEN_CONTEXT_RECOVERY_FAILED
OUTLINE_CONTEXT_INJECTION_MISSING
OUTLINE_CONTEXT_ALIGNMENT_MISSING
CONTENT_CONTEXT_BOUNDARY_UNPROVEN
BROWSER_CONTEXT_SPOOF_ACCEPTED
EVIDENCE_REDACTION_FAILED
```

## Required automated tests

Planned focused tests:

1. semantic request digest stability;
2. DeepTutor response parsing and non-ready rejection;
3. frozen context reused for repeated generation;
4. `appendFormalTeachingPrompt()` includes guidance and excludes learner identity/credential refs;
5. generated formal metadata uses mappingId/mappingRevision from frozen context;
6. browser-supplied context/material spoofing is rejected in formal mode;
7. content/actions routes recover server canonical formal context or documented canonical outlines.

## Required manual evidence

Use fresh formal flow:

```text
Linear functions and graphs
```

Record only redacted summaries:

```text
semanticRequestDigest
mappingId/mappingRevision presence
knowledgeRef IDs or hashed IDs
recommendedApproaches summary
FrozenLessonGenerationContext id/digest
outline generation context injection marker
generated outline/context alignment summary
```

Do not record:

```text
tokens
cookies
Launch Codes
learner profiles
raw DeepTutor responses
private prompts
model traces
API keys
```

## Current status

F59 implementation and automated proof are complete, but the feature is `blocked` from passing because this environment did not provide a fresh live formal provider/browser run for `Linear functions and graphs`. Independent read-only review therefore returned `BLOCKED`, not `PASS`. The review used the configured platform subagent and inspected the F59 contract, OpenMAIC diff, and redacted evidence. It specifically confirmed the server-side projection and route wiring, but required a fresh live provider/browser run and route-level model/output trace before PASS. The automated evidence proves the server-owned semantic request, strict provider parsing, frozen-context persistence/recovery, prompt projection, canonical outline boundary, and context-to-outline alignment using redacted synthetic fixtures.

F58 remains blocked because it addresses a downstream materialization/export problem and does not prove the upstream DeepTutor semantic-context roundtrip.

F54 remains blocked until both upstream context proof and downstream materialization/export evidence are available.

## Completion requirements

F59 may be marked `passing` only after:

- semantic roundtrip is proven with redacted evidence;
- focused automated tests pass;
- TypeScript check passes if code changes are made;
- independent read-only review returns `PASS`;
- OpenMAIC changes are committed/pushed if any;
- F58/F54 remain accurately represented and are not silently promoted.
