# Fxx Verification

## Required commands

| Layer | Command | Required | Evidence |
| --- | --- | --- | --- |
| L1 static | `TODO` | yes | command output or CI link |
| L2 feature | `TODO` | yes | command output or CI link |
| L3 system | `TODO` | no — make required when `completionGate.l3` is `required` | build/runtime record |
| Harness | `node scripts/harness-gate.mjs` | yes before `passing` | command output |

## Manual paths

- [ ] TODO: state the learner, teacher or integration path to verify, or write `Not required` with a reason.

## Passing evidence

- Record command dates and results in `docs/log/artifacts/Fxx/verification-summary.md`.
- Record the independent review in `docs/log/artifacts/Fxx/subagent-review.md` when Fork code changed.
- Keep `knownUnverified` and `humanReviewRequired` empty before marking this feature `passing`.
- For changes under `DeepTutor/` or `OpenMAIC/`, confirm the recorded Fork commits are pushed and the worktrees are clean before running the Harness gate.
