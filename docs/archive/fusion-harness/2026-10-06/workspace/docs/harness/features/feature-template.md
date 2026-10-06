---
id: Fxx
title: Short feature title
version: v0.1
status: not_started
dependsOn: []
scope: {"code":[],"tests":[],"docs":["docs/progress.md","docs/log/artifacts/Fxx/**"]}
evidence: {"lastVerifiedAt":"","commands":[],"manualSmoke":""}
completionGate: {"version":"v0.1","l3":"not_required","userPath":[],"integrationEvidence":[],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[]}}
---

# Fxx Short feature title

## Goal

What observable learner, teacher or operator outcome does this feature deliver?

## Integration decision

- Integration host:
- Identity and authorization owner:
- Authoritative data owner(s):
- Versioned API/event contract:
- External AI/data sent and purpose:

## Scope

### Allowed changes

- TODO

### Out of scope

- TODO

## Acceptance Criteria

- [ ] TODO: observable, testable result.

## Risks and compatibility

- TODO: data migration, integration, privacy, AI-quality or rollback risks; write `None` when genuinely absent.

## Completion evidence

- Verification evidence: `docs/log/artifacts/Fxx/verification-summary.md`
- Independent review: `docs/log/artifacts/Fxx/subagent-review.md` (required for Fork code changes; otherwise state `not_required` and why)
- Git evidence: for changes under `DeepTutor/` or `OpenMAIC/`, record every changed Fork's `path`, `branch` and pushed commit SHA in `completionGate.gitEvidence` before marking `passing`.
