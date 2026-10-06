# F39 验证计划

## 必须检查

- 人工核对 6 个协议一致性修订点。
- `docs/harness/FUSION/fixtures/canonical-digest-v1.json` JSON parse 通过，Candidate fixture 与 10 的白名单一致。
- Scoped Markdown link/fence check。
- `node scripts/harness-gate.mjs`。

## 禁止事项

- 不调整 FUSION 目录和编号。
- 不修改 03/05/07 迁移路线状态。
- 不修改两个 Fork 或应用运行时代码。

