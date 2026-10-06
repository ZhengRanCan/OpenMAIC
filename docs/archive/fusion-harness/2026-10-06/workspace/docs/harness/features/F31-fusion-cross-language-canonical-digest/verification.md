# F31 验证计划

## 验证范围

- 检查规范是否完整覆盖 F29 审查列出的跨语言差异来源。
- 使用独立 Node.js 与 Python 小程序读取同一 fixture，重算 canonical bytes 与 SHA-256。
- 检查正常样例在输入对象字段顺序变化后 digest 不变。
- 检查 Unicode NFC、时间、小数和缺失/null 规则具有对应测试向量或拒绝样例。
- 检查 FUSION `01–07`、OpenMAIC 与 DeepTutor 未被修改。

## 禁止事项

- 不启动服务、数据库、浏览器、模型或 Worker。
- 不读取真实用户、课堂、Token、Secret、数据库或材料正文。
- 不修改两个 Fork、架构 SSOT 或既有 FUSION 文档。

## 通过前检查

- [ ] JSON fixture 可解析，ID 唯一。
- [ ] Node.js 与 Python 重算结果一致。
- [ ] Markdown code fence 平衡。
- [ ] `node scripts/harness-gate.mjs` 返回 0 errors。
