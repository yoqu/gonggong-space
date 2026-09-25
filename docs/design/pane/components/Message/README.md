# Message

消息：一行 = 头像 + 名字/时间 + 气泡。放在 `MessageList` 里，行间距 `space-16`。

**你需要提供**：`author: {name, avatar?, status?, tags?}`、`time`、`children`（字符串或节点，节点里可以用 `Mention` 和链接）、`self`（自己发的：靠右，`bubble-out` 浅蓝底）。

- `continued`：同一人连续发的第二条起，不再重复头像和名字。
- `bare`：卡片类内容（`FileAttachment`、`DocLink`、`MessageCard`、`ImageAttachment`）不套气泡。
- `reply: {author, text}` 在气泡顶部显示引用；`reactions` 显示在气泡底部；`thread: {count, people, lastTime}` 显示在气泡下方。
- 自己的消息：`receipt: {read, total}` 显示已读状态；`status="sending"` 显示转圈，`status="failed"` 显示红色重发按钮（`onRetry`）。
- `urgent` 加「加急」标签和红色气泡描边；`edited` 显示「（已编辑）」。
- 悬停时右上角浮出 `MessageActions`；`actions` 可换成自定义项，传 `false` 则关闭。
- 气泡圆角 `radius-bubble`，靠近头像的上角收为 5px 指示方向，不画尾巴。
