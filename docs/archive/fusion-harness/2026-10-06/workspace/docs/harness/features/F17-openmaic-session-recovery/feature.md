---
id: F17
title: OpenMAIC Session 恢复
version: v0.1
status: passing
dependsOn: ["F16"]
scope: {"code":["OpenMAIC/app/api/fusion/session/**","OpenMAIC/lib/fusion/session/**","OpenMAIC/lib/fusion/identity/**","OpenMAIC/lib/fusion/adapter/**"],"tests":["OpenMAIC/tests/fusion/session-recovery.test.ts","OpenMAIC/tests/fusion/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F17-openmaic-session-recovery/**","docs/log/artifacts/F17/**","docs/harness/incidents/**"]}
evidence: {"lastVerifiedAt":"2026-07-25T09:40:00+08:00","commands":[{"command":"OpenMAIC session recovery and Fusion tests","result":"passed","summary":"1/1 recovery; Fusion 33/33."}],"manualSmoke":"Cookie is HttpOnly, SameSite=Lax, Secure in production and has 15-minute max age. Server record is authoritative; invalid/expired token returns a non-sensitive restart message and cross-device recovery is not supported by the in-memory MVP store."}
completionGate: {"version":"v0.1","l3":"required","userPath":["学习者刷新 OpenMAIC 页面后，可通过 OpenMAIC 自身 HttpOnly Session Cookie/Token 恢复同一 FusionSessionRecord；浏览器参数不能改变 learnerId 或课堂状态。"],"integrationEvidence":["docs/log/artifacts/F17/verification-summary.md","docs/log/artifacts/F17/independent-review.md"],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"OpenMAIC","branch":"fusion-adapter","commit":"85af7ee8fd36718f7b1b66d1024b7fc667eca6e0"}]}}
---

# F17 OpenMAIC Session 恢复

## 目标

在 F16 的已验证身份基础上，建立 OpenMAIC 自身的短期课堂会话凭据与恢复路径。刷新后服务端从权威 `FusionSessionRecord` 恢复冻结 ProfileSnapshot、LessonKnowledgeMap、SceneCatalog、LessonRuntimeState、降级状态和 revision；浏览器缓存仅作展示辅助。

## 集成决策

- 浏览器只持有 OpenMAIC 自身的 HttpOnly/Secure/SameSite Cookie 或等效 session token；它不是 DeepTutor 凭证，不能调用 DeepTutor。
- 恢复时服务端重新校验会话绑定与访问权限，从 session record 获得 learner 身份；不得接受浏览器 learnerId、delegation token 或运行态覆盖。
- 恢复不延长或暴露委托凭证；会话/凭证过期、撤销或记录不存在时返回安全恢复失败，不伪装个性化课堂。
- 具体 Cookie 属性、TTL、跨设备恢复、登出与删除语义按 F16 已确认的安全方案实施并记录。

## 验收标准

- [x] 刷新能恢复同一 lessonSessionId 的冻结快照与运行态，不重新调用浏览器提供的 learnerId。
- [x] 无效、过期、撤销、跨用户或篡改会话均被拒绝；浏览器 IndexedDB 不覆盖服务端 record。
- [x] 浏览器不获得 delegation token，恢复失败有可理解且不泄密的状态与重新开始路径。
- [x] OpenMAIC 测试、独立审查、Git 证据和 Harness gate 通过。

## 完成证据

- 验证证据：`docs/log/artifacts/F17/verification-summary.md`
- 独立审查：`docs/log/artifacts/F17/independent-review.md`
