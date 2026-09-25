# PathControl

路径栏（NSPathControl）：显示当前项目所在的位置，每一级都能点回去，放在 Finder 式窗口底部或详情面板顶部。

**你需要提供**：`items: [{id, label, icon?, color?}]`（从根到当前，最后一项是当前位置，加粗且 `aria-current`）、`onSelect(id)`；可选 `maxItems`（默认 5，超出时中间几级收进「…」下拉菜单）。

- 层级之间用 › 分隔；文件夹图标可以着 `system-blue`，文件用 `label-secondary`。
