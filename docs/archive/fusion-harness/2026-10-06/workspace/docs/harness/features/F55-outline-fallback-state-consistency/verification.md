# F55 verification

## Verification status

- status: `passed`
- feature: `F55-outline-fallback-state-consistency`
- scope: single-scene outline normalization → content/actions generation → classroom state

## Implementation

The browser generation pipeline now treats the server-returned `effectiveOutline` as the canonical scene outline. When its type or normalized configuration differs from the requested/global outline, `synchronizeEffectiveOutline()` replaces the matching entry in the stage store's global `outlines` list before scene-actions generation. Every scene-content request reads the current store outline collection, including pre-warmed parallel requests; retry also re-reads the current collection. Both scene-content retry/failure state and scene-actions receive the synchronized outline collection.

This prevents the previously observed split:

```text
request outline:       scene_4, type=slide
allOutlines[scene_4]:  scene_4, type=interactive
content:               slide-shaped
```

The scene-actions diagnostic now classifies content with `{ elements }` as `slide-shaped` and content with `{ html }` as `interactive-shaped` without recording sensitive model or learner data.

## Automated verification

Command:

```powershell
cd OpenMAIC
pnpm exec vitest run tests/generation/outline-fallback-state-consistency.test.ts tests/generation/scene-builder-type-mismatch.test.ts tests/fusion/generation-session.test.ts tests/fusion/scene-catalog.test.ts tests/generation/task-engine-outline-route.test.ts
```

Result:

```text
5 test files passed
28 tests passed
```

Coverage includes:

- interactive outline without configuration is synchronized to slide;
- global outline list is updated with the same effective outline;
- unchanged interactive outline does not cause a rewrite;
- interactive/slide content mismatch remains rejected by scene builder;
- Fusion generation-session and scene-catalog tests pass;
- outline streaming/task-engine regression tests pass;
- scene-actions diagnostics classify slide-shaped content.

## Confirmed root-cause evidence

The captured `scene-actions` payload contained two versions of the same scene:

```text
request outline:       scene_4, type=slide
allOutlines[scene_4]:  scene_4, type=interactive
content:               slide-shaped { elements, background }
```

The same classroom's outline stream contained `scene_4` as `interactive`. This established a state-consistency defect: a local effective fallback was not reflected in the global outline list.

## Root-cause closure

| Boundary | Evidence | Status |
|---|---|---|
| outline stream | original scene type/config | confirmed: scene_4 interactive |
| normalization | effective outline returned by scene-content | implemented and synchronized |
| session/global outlines | canonical type after fallback | implemented: stage store `setOutlines` |
| scene-content request | request produces effective outline | covered by client response handling |
| scene-actions request | receives effective outline plus synchronized `allOutlines` | implemented |
| classroom store | generated scene uses the same effective type | guarded by synchronized actions/build path |
| F54 scenes | checkpoint/remediation metadata preserved | Fusion generation-session and scene-catalog tests passed |

## Model error boundary

DeepSeek Flash may produce malformed or semantically unsuitable structured output. That remains a model/provider issue unless OpenMAIC fails to validate or consistently normalize the result. F55 does not claim to solve model quality; it prevents model-induced type drift from splitting application state.

## Manual verification

Required manual path remains a new Fusion session using:

```text
Linear functions and graphs
```

The existing captured payload supplied the decisive defect evidence. A fresh-session browser run is still required before F54 can be reactivated for export verification; no tokens, cookies, launch codes, complete learner data, raw private prompts, model traces, or unreviewed classroom exports are recorded here.

## Evidence handling

Evidence belongs under:

```text
classroom/review/F55/<test-batch>/
```

## Independent review

Independent read-only review completed. The first review failed on stale outline snapshots, same-type normalization, diagnostics, and test coverage; those findings were addressed by using current store outlines for all content requests, comparing full normalized outlines, adding fallback-reason diagnostics, and adding the same-type normalization regression test. The final automated suite passed 5 files and 28 tests. Fresh browser Fusion verification remains a prerequisite for F54 reactivation, not a blocker for this F55 code-level state-consistency fix.
