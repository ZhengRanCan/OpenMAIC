---
id: F16
title: 真实启动码与服务端委托
version: v0.1
status: passing
dependsOn: ["F15"]
scope: {"code":["DeepTutor/deeptutor/api/main.py","DeepTutor/deeptutor/api/routers/fusion_launch.py","DeepTutor/deeptutor/api/services/fusion_delegation.py","OpenMAIC/app/api/fusion/launch/route.ts","OpenMAIC/lib/fusion/identity/**","OpenMAIC/lib/fusion/adapter/**"],"tests":["DeepTutor/tests/api/test_fusion_launch.py","OpenMAIC/tests/fusion/launch-route.test.ts","OpenMAIC/tests/fusion/**"],"docs":["docs/progress.md","docs/harness/CONSTRAINTS.md","docs/harness/features/feature-index.json","docs/harness/features/F16-launch-code-and-server-delegation/**","docs/log/artifacts/F16/**","docs/harness/incidents/**"]}
evidence: {"lastVerifiedAt":"2026-07-25T09:35:00+08:00","commands":[{"command":"conda activate skill; python -m pytest tests/api/test_fusion_launch.py","result":"passed","summary":"7/7: allowlist, production auth-disabled rejection, one-time use, revocation, expiry, audience, scope and session binding."},{"command":"OpenMAIC launch route and Fusion tests","result":"passed","summary":"launch route 2/2; Fusion 32/32."},{"command":"git diff --check (both Forks)","result":"passed","summary":"No whitespace errors."}],"manualSmoke":"Security policy confirmed: explicit test-user allowlist, 5-minute one-time code, revocation, 15-minute four-scope delegation, production auth-disabled/Mock rejection, and server-only credential handling."}
completionGate: {"version":"v0.1","l3":"required","userPath":["已认证 DeepTutor 用户可获得一次性 Launch Code；OpenMAIC 服务端交换受限委托凭证并从中派生 learnerId，浏览器不获得 DeepTutor Token。"],"integrationEvidence":["docs/log/artifacts/F16/pre-passing-security-review.md","docs/log/artifacts/F16/verification-summary.md","docs/log/artifacts/F16/independent-review.md"],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"DeepTutor","branch":"fusion-adapter","commit":"7ad8a59605ce144456d4f2a9812a4b1934fbefde"},{"path":"OpenMAIC","branch":"fusion-adapter","commit":"14e16630e899e23c3a12cb613123c4d89175e6ed"}]}}
---

# F16 真实启动码与服务端委托

## 目标

实现 Integrated MVP 的身份入口：DeepTutor 为已认证用户签发一次性 `classroomLaunchCode`，OpenMAIC 服务端将其交换为绑定课堂会话的短期委托凭证，并只从已验证凭证中派生 `learnerId`。浏览器只传递启动码，绝不持有 DeepTutor Cookie、dt_token、长期 Bearer Token 或委托凭证。

## 集成决策

- DeepTutor 是用户身份与 learnerId 的唯一权威来源；浏览器参数、localStorage 和 IndexedDB 不得成为 learnerId 依据。
- Launch Code 必须一次性、短期、可拒绝重放；具体 TTL、签名、撤销与 endpoint 错误码须在实现前写入 evidence 并获人工确认。
- 委托凭证只保存于 OpenMAIC 服务端安全凭证区，至少含 audience、scope、expiration、tokenId，并尽量绑定 lessonSessionId。
- MVP 最小 scope 是 `profile:read`、`diagnosis:request`、`classroom-event:write`、`profile-update:submit`；认证失败不得降级到全局共享 API Key 或更高权限凭证。
- Development Only Mock 身份与真实流程严格分离；生产启用 Mock 视为配置错误。

## 范围

### 允许改动

- DeepTutor 端 Launch Code 签发/交换、OpenMAIC 服务端 launch route、委托凭证安全封装、最小 scope 校验和两端测试。
- 验证一次性消费、过期、重放、错误 audience/scope、lessonSession 绑定、浏览器 payload 最小化及安全日志。

### 不在范围内

- 浏览器直接调用 DeepTutor、共享 Cookie/全局 API Key、真实 Profile/Event/Update Provider、Session 恢复、生产 Outbox 或长期画像聚合。

## 验收标准

- [x] 已认证测试用户可获得一次性启动码；OpenMAIC 服务端成功交换受限凭证并派生可信 learnerId。
- [x] 启动码过期、重复、篡改、错误 audience/scope 或未授权用户均被拒绝，且不产生课堂会话。
- [x] 浏览器请求/响应、日志、导出和 RuntimeState 均不含 DeepTutor 委托凭证或可调用 Token。
- [x] Mock 身份不能用于生产配置，认证失败不回退到更高权限凭证。
- [x] 两端测试、独立审查、提交/推送 Git 证据和 Harness gate 通过。

## 完成证据

- 验证证据：`docs/log/artifacts/F16/verification-summary.md`
- 独立审查：`docs/log/artifacts/F16/independent-review.md`
