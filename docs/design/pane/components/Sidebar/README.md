# Sidebar

侧栏：macOS 27 贴边样式——不再悬浮、不加阴影，彩色图标回归。

**你需要提供**：`sections: [{title?, items: [{id, label, icon?, color?, badge?}]}]`、`selected`/`defaultSelected`、`onSelect(id)`。`color` 取 `var(--system-*)`（默认 `accent`）。

行高 `sidebar-row`（28px），选中行 `selection-fill` 胶囊背景。分组标题 11px semibold `label-secondary`。放在 Window 的 `sidebar` 属性里时，交通灯自动放在侧栏顶部。

键盘：整个侧栏只占一个 Tab 位置（当前选中项），↑↓ 移动并选中，Home/End 到首尾，跨分组连续移动。

分组折叠与嵌套：分组设 `collapsible: true` 后标题可点，悬停时右侧出现折叠箭头（`defaultCollapsed` 传分组标题或 `id`）；条目带 `children` 时出现展开三角，每级缩进 14px（`defaultExpanded` 传条目 `id`）。键盘 → 展开、← 折叠。

`iconStyle: 'tile'`：图标放进 22px 圆角色块、白色图形，用于系统设置式的设置窗口；文件类侧栏保持默认的彩色线性图标。
