# MentionPicker

@成员选择浮层：在输入框里敲「@」后弹出，边输入边筛选。一般不用单独使用——给 `Composer` 传 `mentions` 即可自动接好。

**你需要提供**：`members: [{name, subtitle?, pinyin?, avatar?, status?}]`（`subtitle` 放部门或职位，`pinyin` 让「zs」「zhang」也能匹配）、`query`、`activeIndex`、`onActiveChange`、`onSelect(member)`；`includeAll: false` 可去掉第一行「所有人」。

- 最多列 8 人；匹配的部分加粗；高亮行 `menu-highlight` + `on-accent`。
- 在 `Composer` 里：↑↓ 移动，Enter 或 Tab 选中，Esc 关闭；选中后插入「@名字 」并继续输入。
