# F18 验证计划

## 必需命令（实施时执行）

- 在 DeepTutor 运行真实 Fusion Profile/Event/Update API 的授权、最小化、映射、幂等测试。
- 在 OpenMAIC 运行真实 Provider、冻结快照和分能力降级测试。
- 在两 Fork 运行范围内质量检查与 `git diff --check`，再运行 Harness gate。

## 人工验证路径

- [ ] 用 F16 allowlist 下隔离的合成集成测试身份启动课堂，核对生成前 ProfileSnapshot 与 MappingSnapshot 已冻结且无原始证据泄露。
- [ ] 分别关闭 profile、diagnosis、update 能力，确认降级互不扩大且生产没有 Mock 回退。
- [ ] 审阅浏览器网络，确认只调用 OpenMAIC，不直接调用 DeepTutor。
- [ ] 核对测试身份数据的 allowlist、隔离、保留期与清理结果；确认没有读取任何真实学生资料。
