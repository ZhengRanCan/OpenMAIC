# F54 verification

## Verification status

- status: `blocked`
- blocked_reason: fresh export `classroom/Linear Functions and Graphs.maic` still lacks the server-owned checkpoint/remediation pair and required Fusion metadata. F56/F57 are passing, but this artifact does not satisfy F54 export/materialization acceptance.
- feature: `F54-formal-fusion-checkpoint-materialization`
- scope: formal pre-class Fusion outline → scene materialization → classroom export

## Current hypothesis

Formal Fusion resolution and outline guidance are observable in the network path, but the exported `.maic` manifest does not contain the server-owned checkpoint/remediation pair. The investigation must locate the first boundary where the pair disappears.

## Required evidence matrix

| Boundary | Evidence | Status |
|---|---|---|
| launch → lesson session | session identifier is created and reused | pending — fresh browser capture required |
| outline request | `lessonSessionId` and formal session cookie are accepted | partial — missing-session probe returned expected 409 |
| formal resolution | `formalFusion.kind === resolved` | PASS in `generation-session.test.ts`; fresh browser capture pending |
| server final outlines | `done.outlines` contains checkpoint/remediation | PASS by formal generation tests; fresh network capture pending |
| SSE client state | appended outlines reach client state | PASS by client upsert regression coverage; browser capture pending |
| scene content | appended outlines receive content generation | blocked by earlier ordinary scene-actions failure; fresh request evidence pending |
| classroom store | final scenes include appended pair and metadata | pending — fresh browser capture required |
| session persistence | generated outlines/catalog retain pair | PASS by `generation-session.test.ts` |
| export manifest | exported manifest includes pair | FAIL — `classroom/Linear Functions and Graphs.maic/manifest.json` has no `fusionCheckpoint` metadata or remediation scene |

## Automated verification to run

```powershell
cd OpenMAIC
pnpm exec vitest run tests/fusion/generation-session.test.ts tests/fusion/scene-catalog.test.ts
pnpm exec vitest run tests/generation/task-engine-outline-route.test.ts
```

Add or update focused tests for the exact failing boundary before marking this feature passing.

## Manual verification path

1. Start DeepTutor and OpenMAIC with local Fusion persistence.
2. Use the requirement `Linear functions and graphs`.
3. Capture only the relevant network response fields and redacted IDs.
4. Search the outline SSE response for:
   - `fusion-checkpoint-scene-`
   - `fusion-remediation-scene-`
   - `"type":"done"`
5. Compare the complete `done.outlines` list with the classroom scene list.
6. Inspect the exported manifest and verify both formal scenes and their metadata.

## Evidence handling

Do not commit:

- `.env.local`;
- tokens, cookies or launch codes;
- complete DeepTutor learner data;
- raw private prompts or model traces;
- unreviewed production classroom exports.

Evidence belongs under:

```text
classroom/review/F54/<test-batch>/
```

## Fresh export review — 2026-09-19

Input: `classroom/Linear Functions and Graphs.maic/manifest.json`.

The export contains 8 scenes: 5 slides, 1 interactive, and 2 quizzes. One quiz is titled `Checkpoint: Slope and Intercepts`, but it has no `fusionCheckpoint` object. No scene contains `checkpointId`, `mappingId`, `mappingRevision`, `lessonKnowledgePointIds`, or `remediationStrategy`, and no remediation scene is present. A title-only quiz is not sufficient evidence of formal Fusion checkpoint materialization.

Result: AC1, AC3, AC4, and AC5 fail for this artifact. AC2 and AC6 cannot be proven from a `.maic` export alone; AC7 is only partially satisfied because the artifact proves final export loss but not the upstream boundary. Detailed evidence and the staged missing-pair investigation plan are stored under `classroom/review/F54/20260919-linear-functions-export/`, including `missing-checkpoint-investigation.md`.

## Known limitations

- This feature does not verify in-class answer handling or post-class writeback.
- A successful outline response alone is insufficient; materialization and export must be checked separately.
- Existing historical classroom records are not evidence for a new formal Fusion generation.
