# ThreadPanel

话题侧栏：点开某条消息的「N 条回复」后，停靠在窗口右侧（`Window` 的 `inspector`），宽 360px。顶部是原消息，下面是回复，底部是话题专用的输入框。

**你需要提供**：`root`（原消息，通常是一个关掉悬停操作的 `Message`）、`children`（回复，一组 `Message`）、可选 `subtitle`（所在会话名）、`replyCount`、`onClose`、`composerProps`（传给底部 `Composer`，如 `onSend`）。

- 输入框默认带「同时发送到群聊」复选框（`alsoSend: false` 可去掉，`alsoSendDefault` 设默认勾选），不显示快捷键提示以节省宽度。
- 话题内不再嵌套话题：回复消息不要再传 `thread`。
