# NotificationBanner

系统通知横幅：App 不在前台时，从屏幕右上角滑入的 macOS 通知样式。Liquid Glass 卡片，圆角 18px。

**你需要提供**：`title`（通常是发送者）、`body`（消息内容，最多两行）、可选 `subtitle`（所在群）、`time`（默认「现在」）、`avatar`（发送者头像，右下角叠一个小的 App 图标）、`app: {name, icon}`、`actions: [{label, onClick}]`（最多 2 个，如「回复」「标为已读」）、`stacked`（同一会话还有几条被折叠）、`onClose`。

- 关闭按钮悬停时出现在左上角，和系统通知一致。
- 通知内容遵守隐私设置：锁屏或开启「隐藏预览」时，`body` 改为「你收到一条新消息」。
- 默认的 App 图标是通用的蓝底对话气泡，接入你自己的产品时用 `app.icon` 换成自己的图标。
