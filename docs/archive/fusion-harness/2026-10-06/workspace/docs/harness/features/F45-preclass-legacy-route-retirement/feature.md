---
id: F45
title: 课前旧 Profile/Map 路径退役
version: v0.1
status: passing
dependsOn: ["F44"]
scope: {"code":["OpenMAIC/**","DeepTutor/**"],"tests":["OpenMAIC/**","DeepTutor/**"],"docs":["docs/progress.md","docs/harness/features/feature-index.json","docs/harness/features/F45-preclass-legacy-route-retirement/**","docs/harness/FUSION/03-pre-class-fusion-code-migration-roadmap.md","docs/log/artifacts/F45/**"]}
evidence: {"lastVerifiedAt":"2026-08-09T00:00:00+08:00","commands":[{"command":"DeepTutor: python -m compileall F45 changed modules","result":"passed"},{"command":"DeepTutor: uvx ruff check F45 changed files/tests","result":"passed"},{"command":"DeepTutor: targeted Fusion pytest","result":"passed"},{"command":"OpenMAIC: prettier check F45 changed files","result":"passed"},{"command":"OpenMAIC: vitest, tsc and build","result":"passed"},{"command":"node scripts/harness-gate.mjs","result":"passed"}],"manualSmoke":"自动化路由、兼容、编译、类型、测试、构建和 Harness gate 验证已完成。"}
dataPolicy: {"sources":["server-owned FrozenLessonGenerationContext","历史 v1 Fusion Session 的只读字段"],"outbound":["semantic request、proposal、resolution、frozen context 的版本化引用"],"forbidden":["浏览器 learner/profile/map 覆盖","token、cookie、secret","旧 Profile/Map 与新 digest 混合","固定 slope 作为正式语义来源"],"retention":"新 Session 不捕获旧 Profile/Map/Catalog 快照；历史字段仅按旧 schema 只读恢复或显式失效","exit":"旧 GET Route、固定 slope Provider/Catalog 和旧正式消费者退役"}
decisionPolicy: {"legacy":"旧 Profile/Map Route 正式流量确认归零后才删除或限制","compatibility":"历史 Session 不静默升级，不跨 schema/digest 拼接；缺失 legacy Map 时使用冻结语义 Map","rollback":"回滚仅恢复完整已验证旧版本，不将新 digest Session 降级拼接旧数据","fallback":"普通课堂与 F02 Demo 维持独立，不作为 Fusion 失败的隐式回退"}
completionGate: {"version":"v0.1","l3":"required","userPath":["正式课前流程只保留一份可追溯的语义根和冻结上下文；旧 Profile/Map 路由没有正式消费者，兼容窗口、回滚演练和历史 Session 策略已验证。"],"integrationEvidence":["DeepTutor 8c66eb33deb8be3bfde6e9464744d20b41bf032d","OpenMAIC d4f42747726eb5912719b359cb2daf185c6a8498","v4_flash_worker readonly review: pass"],"knownUnverified":[],"humanReviewRequired":[],"gitEvidence":{"repositories":[{"path":"DeepTutor","branch":"fusion-adapter","commit":"8c66eb33deb8be3bfde6e9464744d20b41bf032d"},{"path":"OpenMAIC","branch":"fusion-adapter","commit":"d4f42747726eb5912719b359cb2daf185c6a8498"}]}}
---

# F45 课前旧 Profile/Map 路径退役

## 目标

完成课前迁移阶段 F：在新正式语义上下文路径稳定、可观察且可回滚后，停止旧 Profile/Map GET 以及固定 slope Provider/Catalog 的正式语义职责，并按已验证兼容策略退役不再有正式消费者的实现。

## 集成决策

- 集成宿主：OpenMAIC 课前生成链路；DeepTutor 课前上下文服务。
- 身份与授权归属：DeepTutor 负责 learner 授权与 CourseScope；OpenMAIC 仅使用服务端绑定的课堂身份和冻结上下文。
- 权威数据归属：服务端拥有的 `FrozenLessonGenerationContext`；历史 Fusion Session 的 legacy 字段只作旧 schema 只读数据。
- 版本化 API/事件契约：F44/F45 课前 semantic request、proposal、resolution 与 frozen context 的版本化引用，禁止跨 schema/digest 拼接。
- 外部 AI/数据发送：本 Feature 不新增外部 AI 调用；只发送完成课前语义决策所需的最小版本化引用，不发送 token、cookie、secret 或原始 Profile/Map。

## 范围

### 允许改动

- 删除或限制 DeepTutor 旧 `/profile`、`/knowledge-map` 路由及固定 slope Provider/Map/Catalog 实现。
- 让 OpenMAIC 正式课前生成只读取 `FrozenLessonGenerationContext`，并保留历史 Session legacy 字段的只读恢复或显式失效处理。
- 更新本 Feature 合同、验证记录、进度面板和索引，并保留两个 Fork 的提交、推送和独立复核证据。

### 不在范围内

- 不改变 F44 的 CourseScope、Launch Binding 或真实课前决策管线。
- 不修改课中/课后协议，不自动更新长期画像。
- 不把普通课堂或 F02 Demo 作为 Fusion 失败的隐式回退路径。
- 不重建、压缩或重排 `feature-index.json` 的既有记录。

## 验收标准

- [x] 旧 `GET /profile`、`GET /knowledge-map` 与固定 slope Profile/Map/Catalog 的正式消费为零，且对应实现已按精确目标删除或限制。
- [x] 历史 Session 仅按旧 schema 只读恢复或显式失效；新旧 schema/digest 不混用，且不静默升级。
- [x] 两个 Fork 分别完成测试、构建、独立只读复核、提交和推送，工作树保持干净。
- [x] 普通课堂与 F02 Demo 保持独立，不被伪装成 Fusion 失败回退路径。

## 风险与兼容性

- 旧 Route 删除前必须确认正式调用归零，并完成兼容窗口和回滚演练。
- 历史 Session 缺少 legacy Map 时只能使用该 Session 已冻结的语义 Map；不得把新 digest 与旧字段拼接。
- 回滚只能恢复完整且已验证的旧版本，不得将新 digest Session 降级为旧 Profile/Map 组合。
- 删除仅针对已确认的精确目标；普通课堂和 F02 Demo 继续独立运行。

## 完成证据

- 验证记录：见本目录的 `verification.md` 及 `evidence` front matter。
- 独立复核：`v4_flash_worker` 对本 Feature 合同、改动范围和验证证据完成只读复核，结论为 `pass`。
- Git 证据：`completionGate.gitEvidence` 已记录 DeepTutor 与 OpenMAIC 的 `fusion-adapter` 分支提交 SHA；两 Fork 均已推送且工作树干净。
