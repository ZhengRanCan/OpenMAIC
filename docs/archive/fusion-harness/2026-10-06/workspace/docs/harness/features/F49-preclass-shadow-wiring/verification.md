# F49 Verification

## Required commands

| Layer | Command | Required | Evidence |
| --- | --- | --- | --- |
| L1 static | `OpenMAIC: pnpm exec prettier --check lib/fusion/adapter/preclass-context-provider.ts lib/fusion/generation-session.ts tests/fusion/preclass-context-shadow.test.ts tests/fusion/generation-session.test.ts` | yes | passed |
| L2 feature | `OpenMAIC: pnpm exec vitest run tests/fusion/preclass-context-shadow.test.ts tests/fusion/launch-route.test.ts` | yes | 11 passed |
| L3 system | `OpenMAIC: pnpm exec tsc --noEmit`; `pnpm build`; `node scripts/check-i18n-keys.mjs` | yes | passed |
| Harness | `node scripts/harness-gate.mjs` | yes | 50 features, 0 errors |

## Manual paths

- [x] Enable shadow flag, launch/freeze, inspect redacted record, verify formal output is unchanged (API-level coverage in `tests/fusion/preclass-context-shadow.test.ts`; provider failure and flag-off paths included).

## Passing evidence

- Record results under `docs/log/artifacts/F49/`。

## 2026-08-16 remediation

- 修复 Shadow 存储边界：`preClassContextShadow` 不再保存完整 semantic request、proposal、resolution 或 frozen context，仅保留 request correlation、topic/knowledgeScope/errorType 分类和 provider error code。
- 统一初始冻结与 clarification revision 2 的 Shadow 接线；两条路径均为 best-effort、non-blocking。
- 定向测试：27 passed；Fusion 全量：92 passed、3 skipped；tsc、build、i18n 检查通过。
- OpenMAIC commit `400e06e2d1283aa7cf3f0c147d797add4cdad8a7` 已推送 `origin/fusion-adapter`，工作树干净。

## Review note

Previous independent review returned `fail`; remediation is complete. The fresh current-platform independent readonly review returned `pass`.
