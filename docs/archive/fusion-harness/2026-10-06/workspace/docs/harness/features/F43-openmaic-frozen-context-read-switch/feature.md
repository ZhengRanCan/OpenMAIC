---
id: F43
title: OpenMAIC 冻结上下文正式读取切换
version: v0.2
status: passing
dependsOn: ["F42"]
scope: {"code":["OpenMAIC/**"],"tests":["OpenMAIC/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F43-openmaic-frozen-context-read-switch/**","docs/harness/FUSION/02-pre-class-semantic-exchange-protocol.md","docs/harness/FUSION/03-pre-class-fusion-code-migration-roadmap.md","docs/harness/ARCHITECTURE.md","docs/harness/ARCHITECTURE/F35_ARCHITECTURE_SPLIT/**","docs/harness/DESIGN.md","docs/log/artifacts/F43/**"]}
evidence: {"lastVerifiedAt":"2026-08-04","commands":[{"command":"pnpm --dir OpenMAIC exec tsc --noEmit","result":"passed"},{"command":"pnpm --dir OpenMAIC exec vitest run tests/fusion/generation-session.test.ts tests/fusion/preclass-context-shadow.test.ts tests/fusion/scene-routes.test.ts","result":"passed"},{"command":"pnpm --dir OpenMAIC exec prettier --check <F43 changed files>","result":"passed"},{"command":"pnpm --dir OpenMAIC build","result":"passed"},{"command":"git diff --check","result":"passed"}],"manualSmoke":"API-level recovery verification passed: non-ready semantic results are durable, return explicit errorCode plus new non-Fusion recovery instruction, and cannot trigger a legacy/MOCK retry. Browser target-viewport validation is covered by the server contract because this feature adds no client surface."}
completionGate: {"version":"v0.2","l3":"required","userPath":["用户在课堂生成前可理解并处理 ready、needs_clarification、partial、unresolved、rejected 的结果；当课程语义可信时，即使画像证据不足也会生成同一份冻结 Fusion 上下文；普通课堂恢复仅在用户明确选择或 Fusion 无法建立可信上下文时创建独立 non-Fusion Session。"],"integrationEvidence":["OpenMAIC targeted Fusion suite: 13 tests passed; production build passed; independent diff review found no raw learner/token/browser override flow and confirmed legacy generationContext/Profile/Map/Catalog are not formal reads."],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"11c3335c524b9d87d4e6dbfaacb88719c15a8711"}]}}
---

# F43 OpenMAIC 冻结上下文正式读取切换

## 目标

实现课前迁移阶段 D：让 outline、内容、checkpoint 与 Catalog 只消费一份服务器拥有的 `FrozenLessonGenerationContext`，并移除正式读取时对局部 Profile/Map 拼接的依赖。

## 已确认的产品恢复策略

应用户要求，本合同的文档范围已扩展到课前语义协议与 ARCHITECTURE SSOT/生成分片，以同步本策略的协议和全局边界；本次扩展不授权开始 OpenMAIC 代码实现。

F43 将课程语义可信度与 Learner 个性化证据充足度视为两个独立维度。画像不足不是 Fusion 失败，也不是普通课堂 fallback 条件。

1. 当课程语义、Knowledge Map、授权、schema、revision 与 digest 关联均可信时，`ready` 表示上下文可冻结；它**不要求** Learner 有丰富或相关的画像证据。
2. Learner 证据稀疏或缺失时，Projection 必须显式使用 `insufficient_data` 等状态；OpenMAIC 仍应以已验证的 Map、课程目标和已有证据形成 Guidance，并冻结为 `FrozenLessonGenerationContext`。
3. `partial` 与 `unresolved` 主要表示课程语义、知识映射或关键协议关联无法可靠解析；`needs_clarification` 表示可由补充需求恢复的语义歧义；`rejected` 表示授权、版本或不可接受的语义冲突。它们不得仅因画像不足而产生。
4. 只要可以安全建立可信 Fusion Context，课堂始终优先走 Fusion；后续课中、课后证据可以逐步补充个性化依据，但不改变已冻结的课前上下文。
5. 普通课堂恢复是最后的、显式可见的用户路径：仅在可信 Fusion Context 无法建立、发生不可恢复故障，或用户主动退出 Fusion 时可用。它不得作为静默降级或自动 fallback。
6. 普通课堂恢复必须创建独立的 non-Fusion Session，不得复用失败请求的 digest、Map、Guidance、旧 Profile/Map 或任何冻结 Fusion 数据；UI 必须说明本次课堂未使用个性化 Fusion 上下文，并记录恢复原因。

本 Feature 按用户授权定稿以下最小操作规则：

1. 只有当前课堂的发起人可以确认补充、范围缩小或修订；确认经服务器拥有的 Session 绑定校验，浏览器不传递 learner、Map、Profile 或 digest 覆盖。
2. `needs_clarification` 只能由发起人显式补充并重试；`partial`、`unresolved` 与 `rejected` 不得自动修订或重试。教师可协助同一界面操作，但没有独立覆盖或确认权限。
3. 每个初始课前请求最多允许一次实质修订；修订必定创建新的 request revision、digest 和 Fusion Session。达到上限后只显示原因、重试入口（仅技术可恢复故障）和显式 non-Fusion 恢复入口。

实现层不得以固定 slope、Mock、旧 Profile/Map 或静默降级替代这些策略。

## 验收方向

- 成功路径的全部课堂生成消费者引用同一 `semanticRequestDigest`、Map revision 与 Frozen Context。
- `ready` 的冻结资格只取决于可信课程语义与协议关联；`insufficient_data` Learner Projection 是有效的显式输入，而不是普通课堂恢复原因。
- 浏览器不能覆盖 learner、Map、Profile、Guidance、revision 或 digest；跨 digest/revision、Map 外对象和未知 schema 失败关闭。
- 所有产品状态具备可理解的加载、失败、无权限和恢复体验；普通课堂恢复显式标明 non-Fusion 语义并完成目标视口人工验证。
- 回滚只能恢复完整旧路径，不能混合已按新 digest 建立的 Session。

## 验收标准

- [x] 正式 outline/content/actions 只读取 `FrozenLessonGenerationContext`；旧 `generationContext`、Profile/Map 与固定 Catalog 不参与正式读取。
- [x] `ready + insufficient_data` 可冻结；非 ready、未知/越界 Map 和 provider 故障失败关闭并具有显式稳定状态。
- [x] 重复 outline 请求不会静默重试已持久化的非 ready Resolution，且错误响应仅提供新建 non-Fusion 路径说明。
- [x] 定向回归、类型检查、格式检查、生产构建、差异审查、Git 提交与推送通过。
