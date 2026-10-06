# F56 verification

## Verification status

- status: `passing`
- feature: `F56-fusion-outline-reconciliation`
- scope: Fusion server canonical outline + browser effective outline + content compatibility

## Confirmed evidence

The same `scene_5` has been observed in several forms:

```text
scene-outlines-stream:
  type = interactive
  widgetType = simulation
  widgetOutline = present
  teachingObjective/estimatedDuration = present

done.outlines / later browser state:
  type = interactive
  widgetType/widgetOutline = missing

scene-content:
  incomplete interactive config triggers fallback
  effective outline.type = slide
  content = slide-shaped { elements, background }

scene-actions request:
  outline.type = slide
  content = slide-shaped { elements, background }

scene-actions effective server outline:
  type = interactive

scene-actions response:
  interactive + slide-shaped content
  => Failed to build scene
```

The decisive error was:

```text
Failed to build scene: Slope Explorer: Change m and b, Watch the Line
(scene id=scene_5, outline type=interactive, content type=slide-shaped,
fallback reason=none-or-upstream)
```

This proves two separate facts: the original SSE outline was a valid interactive outline, while a later browser/session representation lost fields and triggered a local fallback; then browser-side fallback and Fusion server canonical outline were independently selected and diverged inside the scene-actions route. F56 handles the second fact safely without pretending to fix the first; F57 owns field preservation.

## Implementation evidence

Implemented:

- `OpenMAIC/lib/generation/outline-reconciliation.ts` classifies content shape and reconciles only the explicitly evidenced interactive-to-slide fallback.
- Server-owned Fusion metadata is copied from the server canonical outline; browser metadata cannot replace it.
- Unsupported or unevidenced combinations throw `OUTLINE_CONTENT_TYPE_MISMATCH` and the route returns HTTP 409 with diagnostics.
- `scene-actions` uses the reconciled outline for action context, canonical `allOutlines`, and `buildCompleteScene()`.
- `scene-content` propagates `fallbackReason: content-route-fallback`.
- The browser synchronizes the effective outline into the current stage store before the actions request, including retry/regeneration paths.
- Scope explicitly includes the browser propagation files needed to carry effective outline/fallback evidence; these files do not authorize browser Fusion metadata.

## Automated verification

Executed from `OpenMAIC` with approved process access after the initial Windows sandbox `spawn EPERM`:

```powershell
pnpm exec vitest run tests/generation/fusion-outline-reconciliation.test.ts tests/generation/scene-builder-type-mismatch.test.ts tests/generation/outline-fallback-state-consistency.test.ts tests/fusion/generation-session.test.ts tests/fusion/scene-catalog.test.ts
```

Result:

```text
5 test files passed
26 tests passed
```

Also executed:

```powershell
pnpm exec tsc --noEmit
```

Result: exit code 0.

The focused tests cover safe downgrade, server metadata retention, interactive compatibility, fail-closed mismatch, browser store synchronization, scene-builder mismatch protection, and existing Fusion session/catalog behavior.

## Required boundary evidence

| Boundary | Evidence | Status |
|---|---|---|
| browser/request outline | `content-route-fallback` propagated from scene-content to scene-actions | confirmed |
| Fusion server canonical outline | server-owned type and metadata selected by `resolveFormalFusion` | confirmed |
| content shape | slide-shaped vs interactive-shaped classification | confirmed |
| reconciliation | explicit reason and effective type | confirmed |
| canonical allOutlines | reconciled current scene replaces the matching current-store/server entry | confirmed in route and store path |
| scene builder | compatible outline/content pair or fail-closed mismatch | confirmed |
| Fusion metadata | checkpoint/remediation binding remains server-owned | confirmed by helper test and implementation |
| ordinary generation | no regression in focused fallback/scene-builder suite | confirmed |

## Manual verification

A fresh Fusion session using:

```text
Linear functions and graphs
```

was manually verified. The observed path was:

```text
scene-outlines-stream scene_3 = interactive
later browser outline = slide (interactive fields absent)
content = slide-shaped through fallback
scene-actions reconciliation = safe slide effective outline
final scene generation = successful
```

The fallback was expected and safe: the original stream remained correctly classified as interactive, while the later field-loss boundary remained observable. Fusion server-owned metadata was not replaced. F54 remains blocked pending F57 and fresh checkpoint/remediation/export evidence.

Do not record tokens, cookies, launch codes, complete learner data, raw private prompts, model traces or unreviewed classroom exports.

## Independent review

A final independent read-only review was requested after commit `7573360` and returned `pass`. It confirmed the observed scene_3 path, the structured fallback-evidence fix, server metadata ownership, fail-closed behavior, and the automated verification results. F57 still owns upstream outline field preservation.

## Evidence location

```text
classroom/review/F56/20260919-final/summary.md
```
