# PullDownButton

下拉菜单按钮：标题固定、点开后是一组操作（NSPopUpButton 的 pull-down 形态），如「新建 ▾」「更多 ▾」。与 `PopUpButton` 的区别：PopUpButton 表示「当前选中哪一项」并显示选中值，PullDownButton 只是把多个操作收进一个按钮。

**你需要提供**：`label` 和/或 `icon`（只有图标时必须给 `aria-label`）、`items`（`Menu` 的菜单项，可带子菜单）、`onSelect(value)`；可选 `variant`、`size`、`align: 'end'`（菜单右对齐，放在工具栏右侧时使用）。

- 键盘：按钮上 ↑↓ / Enter / 空格打开，菜单内操作同 `Menu`，选中或 Esc 后焦点回到按钮。
- 按钮加载态：任意 `Button` 设 `loading` 时显示转圈并暂时禁用、`aria-busy`，文字改成进行时（「正在上传」）。
