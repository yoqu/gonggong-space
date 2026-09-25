# NavRail

应用导航栏：窗口最左侧的一列，切换消息、日历、云文档、会议、通讯录、工作台等模块。外观沿用 macOS 27 贴边侧栏的材质（`sidebar-bg`，无阴影）。

**你需要提供**：`items: [{id, label, icon, badge?, muted?, dot?}]`（4–7 个）、`selected`/`defaultSelected`、`onSelect(id)`；可选 `avatar`（顶部当前用户头像，带在线状态）、`footer`（贴底的项，如设置）。

- 放进 `Window` 的 `rail` 属性时，交通灯自动移到导航栏顶部，右侧的会话列表顶部留出与工具栏对齐的空间。
- 选中项：`tint-blue` 胶囊底 + `tint-blue-text` 图标，标签加粗，≥ 5:1。
- 未读用 `badge`（数字），只有「有新内容」没有数量时用 `dot`（红点）。标签 2–3 个字。

键盘：只占一个 Tab 位置，↑↓ 切换模块。
