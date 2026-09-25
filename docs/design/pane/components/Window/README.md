# Window

窗口：交通灯 + 统一工具栏 + 可选侧栏 + 内容区。

**你需要提供**：`title`、`children`（内容，默认 20px 内边距）、可选 `sidebar`（一个 `Sidebar`）、`toolbar`（一个 `Toolbar`，省略时用 `title` 生成）、`width`/`height`、`inactive`（非活动窗口：灰色交通灯 + `shadow-window-inactive`）、`contentStyle`。

圆角 `radius-window`（macOS 27 统一为较小的固定值），活动窗口 `shadow-window`。另导出 `TrafficLights({inactive})` 单独使用。

- `rail`：最左侧的应用导航栏（`NavRail`）。有 `rail` 时交通灯放在导航栏顶部。
- `inspector`：右侧停靠面板（`ChatInfoPanel`、`ThreadPanel` 或你自己的检查器），与内容区之间一条 `separator`。
