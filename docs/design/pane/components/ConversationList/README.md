# ConversationList

会话列表：IM 窗口左栏，按 macOS 27 贴边侧栏的样式做——`sidebar-bg` 底、不加阴影，行高 `conversation-row`（64px）。

**你需要提供**：`items` 数组，每项 `{id, name, avatar?, group?, status?, tags?, time, preview, unread?, muted?, pinned?, mention?, urgent?, draft?}`；`selected`/`defaultSelected`、`onSelect(id)`；可选 `header`（通常放 SearchField 和一个 small 尺寸的 SegmentedControl 做「全部 / 未读 / @我 / 群组」筛选）。

- 预览行前缀的优先级：「[加急]」>「[有人@我]」>「[草稿]」，前缀用 `tint-red-text`。
- `muted` 显示免打扰图标，未读徽标变灰。`pinned` 在时间前显示图钉。
- 时间写法：今天「10:42」、昨天「昨天」、一周内「星期二」、更早「9月20日」。
