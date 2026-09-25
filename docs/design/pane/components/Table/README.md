# Table

表格：macOS 的列表视图（NSTableView / 大纲视图）。表头可排序，行可多选，支持树形展开，隔行底色 `row-alt`。

**你需要提供**：`columns: [{key, title, width?, align?, sortable?, sortValue?, render?, secondary?, mono?}]`（不设 `width` 的列平分剩余宽度；`secondary` 列用 `label-secondary`；`mono` 用等宽字体，适合编号）、`rows: [{id, …, children?}]`（带 `children` 的行变成可展开的树节点）、`aria-label`；可选 `selection`/`defaultSelection`/`onSelectionChange`、`multiple`（默认 true）、`sort`/`defaultSort`/`onSortChange`（默认在组件内排序，服务端排序时传 `sortRows: false`）、`defaultExpanded`、`onOpen(row)`（双击或 Enter）、`density: 'compact'`、`alternating: false`、`maxHeight`。

- 选中行：表格有焦点时 `menu-highlight` 底 + `on-accent` 字，失焦后变成 `selection-fill`，和 Finder 一致；连续选中的行合并成一块。`active` 可强制显示有焦点的样式（演示用）。
- 鼠标：单击选中，⌘ 单击加选 / 取消，⇧ 单击连续选择，双击打开。
- 键盘：Tab 进入表格，↑↓ 移动，⇧↑↓ 扩展选择，Home/End，⌘A 全选，→ 展开、← 折叠或跳到上一级，Enter 打开。
- 数字列右对齐；空值显示「--」；树的缩进每级 16px，展开三角旋转 90°。
