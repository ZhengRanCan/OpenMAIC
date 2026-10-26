/** Model-facing protocol. Runtime enforcement remains in outputSchema/validateTransition. */
export const OUTPUT_PROTOCOL = `# JSON 更新协议（memory.v2）
只输出一个合法 JSON 对象。完成整理时：
{"status":"ready","sections":[{"section":"learning_experiences","pieceIds":["new:1"]}],"pieces":[{"id":"new:1","text":"具体记忆正文","formation":"synthesis","supports":["e1"]}],"retired":[],"decisions":[{"source":"e1","action":"adopt","pieceIds":["new:1"],"reason":"采用理由"}]}

- sections：只列受影响分区，pieceIds 是该分区更新后的完整片段列表。未列分区保持原样。
- pieces：只定义新增或改写片段。旧片段沿用输入 ID；新增片段用 new:1、new:2 等。沿用未改片段只在 sections 中引用 ID。共享片段改写时列出所有使用它的分区。
- formation：declaration 表示来源为明确声明，confirmed_experience 表示来源为已确认经历，其他整理用 synthesis。保持来源性质。
- supports：使用输入给出的 e（本批）或 s（已有依据）别名。程序据此绑定各来源原始条件、引用和版本；不要返回 conditions 字段。正文仍保留影响理解的提示和适用范围。
- retired：旧片段退出某分区时交代去向，格式为 {"id":"旧ID","section":"原分区","action":"merge|budget_remove|correct|withdraw","replacements":[],"reason":"原因"}。合并须列替代片段；单纯改写原 ID 不需 retirement。
- decisions：每个本批 e 恰好一次。adopt 为实际采用，指向由该来源支持的片段；already_represented 为已有内容已表达，指向已有片段；not_adopt 为不保存，pieceIds 为空；defer 为暂缓，pieceIds 为空且保留待处理状态。
允许四分区不变、pieces/retired 为空。restricted 片段已被限制可信使用，需依仍有效来源修正或移出。
无法在预算内完成时返回 {"status":"capacity_exceeded","reason":"原因"}。以上内容只说明字段，不是本次预期答案。`;
