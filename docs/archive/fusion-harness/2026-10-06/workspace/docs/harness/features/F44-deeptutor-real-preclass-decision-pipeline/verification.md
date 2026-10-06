# F44 验证记录

2026-08-05T09:03:37.539Z：

- DeepTutor 实现：
  - 新增 CourseScope Registry，只持久化 learner / scope / revision / book_id 引用和 lesson binding 元数据。
  - Launch Code 现在绑定 immutable CourseScope revision；exchange 时创建 lesson binding，并继续按 audience / lesson / scope / expiry 校验 delegation。
  - `POST /api/v1/fusion/pre-class/context` 从 delegation 恢复 learner 和 lesson binding，只读 launch-bound learner Book / Spine / LearningProgress。
  - 缺少 LearningProgress 返回 `ready + insufficient_data`；无语义匹配返回 `unresolved + knowledge_scope_unresolved`；内部失败返回稳定 `decision_pipeline_unavailable`，不泄露异常正文。
  - 输出不包含 Book 正文、quiz answer、Memory、聊天正文、token/cookie/secret 或模型思维过程。
- OpenMAIC 实现：
  - Launch exchange 校验并保存 DeepTutor 返回的 `courseScopeId/courseScopeRevision` 为 server-side `courseScopeRef`。
  - 正式 `LessonSemanticRequest` 的 `authorizedKnowledgeScope.scopeId` 只来自 immutable `courseScopeRef`；缺失时 fail closed。
- 验证命令：
  - `DeepTutor: .venv\\Scripts\\python.exe -m compileall deeptutor/api/services/fusion_course_scope.py deeptutor/api/services/fusion_preclass_context.py deeptutor/api/routers/fusion_course_scopes.py deeptutor/api/routers/fusion_preclass_context.py deeptutor/api/routers/fusion_launch.py deeptutor/api/main.py`：通过。
  - `DeepTutor: uvx ruff check deeptutor/api/main.py deeptutor/api/routers/fusion_test_app.py deeptutor/api/services/fusion_delegation.py deeptutor/api/services/fusion_course_scope.py deeptutor/api/services/fusion_preclass_context.py deeptutor/api/routers/fusion_course_scopes.py deeptutor/api/routers/fusion_preclass_context.py deeptutor/api/routers/fusion_launch.py tests/api/test_fusion_course_scopes.py tests/api/test_fusion_preclass_context.py tests/api/test_fusion_launch.py`：通过。
  - `DeepTutor: .venv\\Scripts\\python.exe -m pytest tests/api/test_fusion_course_scopes.py tests/api/test_fusion_preclass_context.py tests/api/test_fusion_launch.py -q`：15 项通过。
  - `OpenMAIC: pnpm exec prettier --check app/api/fusion/launch/route.ts lib/fusion/adapter/preclass-context-provider.ts lib/fusion/identity/delegation-store.ts lib/fusion/session-store/types.ts tests/fusion/generation-session.test.ts tests/fusion/launch-route.test.ts tests/fusion/preclass-context-shadow.test.ts`：通过。
  - `OpenMAIC: pnpm exec vitest run tests/fusion/launch-route.test.ts tests/fusion/generation-session.test.ts tests/fusion/preclass-context-shadow.test.ts`：12 项通过。
  - `OpenMAIC: pnpm exec tsc --noEmit`：通过。
  - `OpenMAIC: pnpm build`：通过；仅输出既有 Next.js middleware/proxy deprecation warning。
- 独立复核：
  - 已尝试启动两次只读复核代理（`f44_readonly_review`、`f44_small_review`），均连续超时并被中断。
  - 用户确认复核代理可用后重新启动 `f44_v4_review_retry`，返回 403 quota insufficient（用户额度不足），未产生审核结论。
  - 2026-08-06 重新通过 `f44_review_launcher/v4_flash_worker` 完成只读复核，结论为 `pass`：合同 scope 覆盖改动，CourseScope/Launch binding/真实课前决策管线/数据最小化/失败关闭要求满足，验证证据足以支持 passing，未发现新阻塞。
- Git：
  - DeepTutor：`fusion-adapter` commit `fb31faad2ece36282ef0774ab89ac03181ff4d3c`（`feat(fusion): add real preclass decision pipeline`），已推送 `origin/fusion-adapter`。
  - OpenMAIC：`fusion-adapter` commit `9fd359df455ab442d674b17298983c0e88815773`（`feat(fusion): bind formal context to course scope`），已推送 `origin/fusion-adapter`。

