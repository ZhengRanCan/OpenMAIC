---
id: F44
title: DeepTutor 真实课前教学决策管线
version: v0.1
status: passing
dependsOn: ["F43"]
scope: {"code":["DeepTutor/**","OpenMAIC/**"],"tests":["DeepTutor/**","OpenMAIC/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F44-deeptutor-real-preclass-decision-pipeline/**","docs/harness/FUSION/03-pre-class-fusion-code-migration-roadmap.md","docs/log/artifacts/F44/**"]}
evidence: {"lastVerifiedAt":"2026-08-06","commands":[{"command":"DeepTutor: .venv\\Scripts\\python.exe -m compileall deeptutor/api/services/fusion_course_scope.py deeptutor/api/services/fusion_preclass_context.py deeptutor/api/routers/fusion_course_scopes.py deeptutor/api/routers/fusion_preclass_context.py deeptutor/api/routers/fusion_launch.py deeptutor/api/main.py","result":"passed"},{"command":"DeepTutor: uvx ruff check <F44 changed Python files/tests>","result":"passed"},{"command":"DeepTutor: .venv\\Scripts\\python.exe -m pytest tests/api/test_fusion_course_scopes.py tests/api/test_fusion_preclass_context.py tests/api/test_fusion_launch.py -q","result":"passed"},{"command":"OpenMAIC: pnpm exec prettier --check <F44 changed TS files/tests>","result":"passed"},{"command":"OpenMAIC: pnpm exec vitest run tests/fusion/launch-route.test.ts tests/fusion/generation-session.test.ts tests/fusion/preclass-context-shadow.test.ts","result":"passed"},{"command":"OpenMAIC: pnpm exec tsc --noEmit","result":"passed"},{"command":"OpenMAIC: pnpm build","result":"passed"},{"command":"v4_flash_worker readonly review","result":"passed"}],"manualSmoke":"Not run: API-level/build gates and independent readonly review passed."}
courseScope: {"status":"decided","roots":"learner-authorized existing book_id only","launch":"bind courseScopeId + immutable revision to learnerId + lessonSessionId","selection":"0 reject; 1 unique; many explicit DeepTutor-authenticated selection","progress":"missing LearningProgress yields insufficient_data and does not block ready","revoke":"blocks new discovery/refresh; frozen-session runtime policy is out of F44 scope"}
dataPolicy: {"sources":["learner-scoped Book manifest","learner-scoped Spine","learner-scoped LearningProgress"],"outbound":["versioned Book/knowledge refs","coarse progress status/signals","teaching strategy codes"],"forbidden":["page or attachment body","quiz answer body","Memory or chat body","token/cookie/secret","model/tool trace or chain-of-thought"],"retention":"CourseScope and LessonBinding retain only learner/lesson/scope/revision/Book root references and lifecycle timestamps","exit":"revoke blocks new discovery/refresh; learner/lesson deletion remains governed by the shared lifecycle contract"}
decisionPolicy: {"mapping":"deterministic exact-or-token semantic resolution inside the immutable bound Book roots; no out-of-scope fallback","projection":"only mapped-course LearningProgress; missing progress emits insufficient_data","guidance":"deterministic allowlisted strategy codes derived from mapped scope and coarse progress","ai":"v1 performs no external AI call; a bounded decision port may be replaced later without changing the wire contract","review":"strict proposal parser plus scope/revision/digest/reference validation before return"}
completionGate: {"version":"v0.1","l3":"required","userPath":["在稳定外部契约内，合法课堂请求能得到最小、可追溯、受 Map 约束的真实课前画像投影与教学指导；证据不足或决策器失败不伪造结果。"],"integrationEvidence":["v4_flash_worker readonly review: pass"],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"DeepTutor","branch":"fusion-adapter","commit":"fb31faad2ece36282ef0774ab89ac03181ff4d3c"},{"path":"OpenMAIC","branch":"fusion-adapter","commit":"9fd359df455ab442d674b17298983c0e88815773"}]}}
---

# F44 DeepTutor 真实课前教学决策管线

## 已确认的 CourseScope 前置

F44 v1 先交付 DeepTutor 的 CourseScope Registry、Launch Scope Binding 与 OpenMAIC 的 server-side scope reference。CourseScope 仅引用当前 learner 有权访问的真实 `book_id`；它以 immutable revision 保存有限 Book 根集合，并在 Launch 时绑定到 `learnerId + lessonSessionId`。

0 个 active scope 拒绝 Formal Fusion Launch，1 个按唯一性选择，多个必须在 DeepTutor 认证启动入口显式选择。OpenMAIC 只消费 Launch 派生的 reference；DeepTutor 以 delegation 与 lesson binding 回查 scope，拒绝请求体改绑或扩大范围。revision 更新不改变已绑定课堂；revoke 只保证禁止新的 Discovery/refresh，已冻结课堂后的运行策略不属于 F44。

F44 仅在绑定 revision 的 Book 根内 Discovery，再做 exact resolution。Book 不要求已有 `LearningProgress`；缺少 progress 必须返回 `insufficient_data`，而不是阻止可信 Context 为 `ready`。

## 目标

实现课前迁移阶段 E：在已稳定并已正式消费的外部契约内，用 DeepTutor 的权威知识、课程相关 learner 投影与受限教学决策替换 synthetic fixture，且不泄露原始 Memory、聊天、工具调用或 Agent 思维过程。

## 验收标准

- [x] DeepTutor CourseScope Registry 与 Launch Scope Binding 使用 learner-authorized Book root，并以 immutable revision 绑定 lesson session。
- [x] DeepTutor 课前 context route 只读 launch-bound Book / Spine / LearningProgress，输出真实且最小化的 Proposal/Resolution，失败时稳定 fail closed。
- [x] OpenMAIC 正式 LessonSemanticRequest 只从 server-side courseScopeRef 构造 authorizedKnowledgeScope，缺失或越界时拒绝旧 Profile/Map 回退。

## 约束

- `LessonKnowledgeMap`、Cognitive Projection 与 Guidance 共同回指同一 request revision/digest，并受授权 scope 与当前 Map 限制。
- 低置信、数据不足、Agent 失败和范围冲突用稳定结构化状态表达；不猜测、不静默回退无关默认值。
- 实际数据源、最小字段、授权、保留、退出机制、知识映射策略与确定性审查层以本文 front matter 的 `dataPolicy` / `decisionPolicy` 为准；F44 v1 不调用外部 AI。
- 不改变课中/课后协议或自动更新长期画像。


