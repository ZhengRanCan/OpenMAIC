# Architecture — 待决事项

> 集中记录尚未定稿的产品、协议、身份、存储、迁移和生命周期问题。

> 💡 **上下文锚点**：
>
> - 系统职责：[01-system-responsibilities-and-domain-ownership.md](01-system-responsibilities-and-domain-ownership.md)。
> - 完整性与生命周期：[07-integrity-reliability-security-and-lifecycle.md](07-integrity-reliability-security-and-lifecycle.md)。
> - 实现成熟度：[08-implementation-maturity-and-migration-status.md](08-implementation-maturity-and-migration-status.md)。

<!-- ARCHITECTURE-SPLIT: body-start -->

## 9. 待决事项

以下事项尚无足够结论，不得由实现者根据示例自行补齐：

| 待决项 | 已确认边界 |
| --- | --- |
| 课前澄清/范围修订 | 已确认：`insufficient_data` 不阻止 `ready` 冻结；`partial`/`unresolved` 表示语义、映射或关键协议不可靠；普通课堂是独立且显式的 non-Fusion 恢复。只有课堂发起人可经服务器 Session 绑定确认一次实质修订；教师仅可协助，不能独立覆盖；`partial`/`unresolved`/`rejected` 不自动重试 |
| `sourceMaterialRefs` 正文访问 | 当前只交换授权引用、digest 和用途；正文授权、传输、大小、保留和退出机制待决 |
| 四类 confidence 的 wire/hash 映射 | mapping、diagnosis、observation、aggregation 语义保持分离；Candidate 字段和 digest profile 待决 |
| DeepTutor CandidateInboxStore 物理后端 | 必须选择单一权威、支持事务/唯一约束/lease/恢复的后端；SQLite、PocketBase 或其他选型待决 |
| Planned API 形状 | HTTP/A2A 路径、最终 schema、错误码、payload 上限和版本协商由实现 Feature 定稿 |
| 生产身份与 Secret | Launch TTL、token 形态、轮换、撤销、Workload Identity、Secret Manager/KMS 和多实例恢复待部署 Feature 定稿 |
| 知识映射与画像策略 | namespace/scopeId 命名、映射算法、低置信阈值、多对多、Profile 数据源优先级和 warning 规则待决 |
| 数据保留与隐私删除 | 原始答案、事实、Receipt、审计、Binding、派生 Mastery/Memory 的保留期和删除 SLA 待决 |
| 课中/课后迁移路线 | `FUSION/05`、`FUSION/07` 尚未人工审核；不得把其实现路径或技术决策视为已批准 |
| 跨设备课堂恢复和补偿 API | 已提交事件、未知投递结果、已接受 Candidate 的补偿/删除及跨设备恢复策略待决 |

禁止的跨边界模式始终成立：浏览器直连 DeepTutor；信任浏览器 learner/Map/运行态；共享内部数据库或文件；DeepTutor 返回 UI 命令；单题错误直接改长期 mastery；生产自动回退 Mock；Outbox 保存失败却声称已排队；使用新 mapping revision 重解释历史事实。
