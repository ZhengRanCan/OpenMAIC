# F48 Verification

## Required commands

| Layer | Command | Required | Evidence |
| --- | --- | --- | --- |
| L1 static | `DeepTutor: .venv\\Scripts\\python.exe -m compileall -q deeptutor`; `uvx ruff check` + `uvx ruff format --check` (changed files); `uvx mypy deeptutor/api/services/fusion_preclass_context.py`; `OpenMAIC: pnpm exec prettier --check` (F48 changed files) | yes | passed |
| L2 feature | `DeepTutor: .venv\\Scripts\\python.exe -m pytest tests/api/test_fusion_preclass_context.py tests/fusion/test_preclass_contracts.py tests/api/test_fusion_launch.py`; `OpenMAIC: pnpm exec vitest run tests/fusion` | yes | 27 passed; 92 passed, 3 skipped |
| L3 system | `OpenMAIC: pnpm exec tsc --noEmit`; `pnpm build`; `node scripts/check-i18n-keys.mjs` | yes | passed |
| Harness | `node scripts/harness-gate.mjs` | yes | 50 features, 0 errors |

## Manual paths

- [x] Submit clarification as initiator; verify new revision and immutable old session (covered by `tests/fusion/clarify-route.test.ts` and `tests/fusion/generation-session.test.ts`).

## Passing evidence

- Record results under `docs/log/artifacts/F48/`。

## Environment note

Running the system Python directly cannot collect the API tests because the global environment lacks `json_repair`; the repository-managed `DeepTutor/.venv` has the required dependencies and passes all 27 targeted tests.
