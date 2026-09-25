# Sidebar

侧栏：macOS 27 贴边样式——不再悬浮、不加阴影，彩色图标回归。

**你需要提供**：`sections: [{title?, items: [{id, label, icon?, color?, badge?}]}]`、`selected`/`defaultSelected`、`onSelect(id)`。`color` 取 `var(--system-*)`（默认 `accent`）。

行高 `sidebar-row`（28px），选中行 `selection-fill` 胶囊背景。分组标题 11px semibold `label-secondary`。放在 Window 的 `sidebar` 属性里时，交通灯自动放在侧栏顶部。
