# ChatHeader

聊天头部：头像、会话名、标签、副标题和一组玻璃胶囊操作，下方是可选的标签页。放进 `Window` 的 `toolbar` 属性里，就成为这个窗口的统一工具栏。

**你需要提供**：`title`、可选 `group`（群用方形头像）、`avatar`（自定义头像节点）、`subtitle`（成员数、签名、「对方正在输入…」）、`tags`、`actions: [{icon, label, onClick}]`（最多 4 个：视频会议、搜索、添加成员、设置）、`tabs: [{value, label}]` 与 `tab`/`onTabChange`（聊天、云文档、Pin、文件、公告）、`trailing`。

对方正在输入时，把 `subtitle` 换成 `<TypingIndicator name="张三" bubble={false} />`；设置按钮通常打开右侧的 `ChatInfoPanel`。
