# status

## 当前工作方向

- 用户于 2026-10-06 冻结跨应用 Fusion 路线，选择 OpenMAIC 原生增强，并要求新开发线先同步官方最新 `main`。
- F60 — `blocked`: product-route freeze; implementation and acceptance remain unverified. See `docs/harness/features/F60-preclass-fusion-remove-checkpoint-remediation/freeze.md`.
- 当前没有 active Feature；归档和 Git 基线同步不代表新的原生功能或旧改进迁移已完成。

## 设计草案

- `docs/harness/draft/11-pre-class-outline-shaping-and-coverage-concept.md` 与 draft 12–19 保留为旧路线讨论记录和可复用设计参考，不直接成为原生路线合同。
- `docs/harness/draft/20-fusion-freeze-and-native-openmaic-branch-plan.md` 记录归档、保留/不迁入清单及新基线方案；用户已将基线调整为官方最新 `7230053af019b89c83d22dcab0a94f38fe193856`。

## 已完成的前置 feature

- F56 — `passing`: Fusion server/browser outline reconciliation with server-owned metadata preserved.
- F57 — `passing`: outline field preservation across stream and session state.

## 已完成的前置 feature

- F55 — `passing`: single-scene outline fallback state consistency.

## 暂停 feature

- F54 — `blocked`: fresh `Linear Functions and Graphs.maic` export still lacks server-owned checkpoint/remediation metadata and remediation scene; F56/F57 are passing, but export/materialization evidence fails.
- F58 — `blocked`: downstream checkpoint/remediation materialization/export repair is useful but does not prove the upstream DeepTutor -> OpenMAIC pre-class semantic context roundtrip; see `docs/harness/features/F58-preclass-fusion-checkpoint-materialization-recovery/block.md`.
- F59 — `blocked`: server-side semantic roundtrip implementation and automated proof complete; fresh live `Linear functions and graphs` provider/browser evidence is unavailable and independent review is blocked.


## 已完成

- F45 — `passing`: pre-class legacy routes retired.
- F46 — `passing`: formal Scene Catalog binding to frozen context complete.
- F47 — `passing`: formal Fusion source material authorization boundary enforced.
- F48 — `passing`: pre-class clarification revision flow complete.
- F49 — `passing`: pre-class context shadow wiring complete.
- F50 — `passing`: F02 demo runtime retired; formal Fusion, ordinary classroom, and LAN Demo preserved.
- F51 — `passing`: 课前澄清中文文案、可访问状态和失败/键盘交互已修复。
- F52 — `passing`: Fusion 失败后显式 ordinary recovery 已接通并隔离失败上下文。
- F53 — `passing`: 正式 Fusion 课程材料兼容性提示已接通；浏览器材料会引导普通课堂，正式 Fusion 材料边界保持 fail-closed。

## 排队 feature

- F59 remains blocked pending fresh live provider/browser evidence and independent review.
- 原 outline-shaping/coverage 和 Context Consumption 方案尚未成为 Feature；后续原生路线需要重新确定范围与合同，不继续以 F60 实施为前提。

## 当前边界与风险

- F60 must remove only new pre-class automatic pair materialization; historical pair sessions and in-class runtime remain separate compatibility surfaces.
- The separate outline-shaping/coverage concept must not be implemented under F60 without a new contract and architecture update.
- Historical sessions remain read-only or explicitly expired.
- F02 retirement must not affect formal Fusion, ordinary classrooms, or F21 LAN Demo.
- F47 rejects browser-owned source bodies while ordinary classroom material handling remains unchanged.
- F49 shadow is diagnostic only: feature flag off removes the shadow call, and shadow failure never blocks or alters formal generation.
- F59 evidence must not contain tokens, cookies, Launch Codes, learner profiles, raw DeepTutor responses, private prompts, model traces, or API keys.
- F59 must not claim F58/F54 passing; export/materialization evidence remains separate.

## 下一步

- 保全两个 Fork 的归档分支与根 harness 快照，建立同步官方最新代码的 OpenMAIC `native-learning` 分支。
- 根据最新官方代码重新核对 Windows 支持、课堂排序、普通生成回退和 LAN 功能是否需要迁入；迁入行为独立验证，不在上游同步中直接混入。
- 完成原生路线设计与独立合同后再开始功能实现；历史 Fusion gate 和新路线验收分开。
