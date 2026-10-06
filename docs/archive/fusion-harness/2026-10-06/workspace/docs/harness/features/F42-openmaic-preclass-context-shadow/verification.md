# F42 验证计划

- 验证服务器构造请求、调用新 Provider、写入新版本 Session 对象与关联 digest/revision。
- 验证正式课堂在开关关闭时输出不变；shadow 结果不影响旧生成、不会混合新旧对象。
- 验证浏览器 learner/schema/provider 覆盖、跨 digest/revision、未知 schema 和 Provider 失败路径被拒绝或显式记录。
- 运行 OpenMAIC 目标测试、类型/构建、独立审查、Git 闭环与 Harness gate。

