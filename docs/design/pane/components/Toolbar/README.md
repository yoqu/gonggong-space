# Toolbar

统一工具栏（macOS 27）：标题 + 分组的玻璃胶囊按钮 + 搜索框，高度 `toolbar-height`。

**你需要提供**：`title`、可选 `subtitle`（如项目数）、`children`：用 `ToolbarGroup` 把相关的 `ToolbarButton({icon, label, active?, onClick, text?})` 装进一个玻璃胶囊，最后可放 `SearchField`。`leading` 放标题左侧的元素（如侧栏开关）。

每个 ToolbarButton 必须有 `label`（作为提示和无障碍名称）。一组 2–3 个按钮；导航（前进/后退）、视图切换、共享类操作各成一组。
