# F41 验证计划

- 使用匿名 synthetic 请求验证 Route 返回单一、严格解析且同 digest 的 Proposal。
- 验证 delegation、lesson、audience/scope、expiry、大小、schema、引用与 digest 负向路径均拒绝。
- 验证输出明确携带 synthetic/development 来源且不包含 learner 原始数据、Token、Memory、思维过程或内部异常。
- 运行受影响 DeepTutor 测试、独立审查、Git 闭环与 `node scripts/harness-gate.mjs`。

