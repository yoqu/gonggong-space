# Composer

输入框：圆角 `radius-bubble` 的输入区，上方可带「回复某人」引用，下方是工具行和圆形发送按钮。

**你需要提供**：`recipient`（占位符写成「发送给 某人」）或 `placeholder`、`value`/`defaultValue`/`onChange`、`onSend(text)`；可选 `replyTo: {author, text}` 和 `onCancelReply`、`tools: [{icon, label, onClick}]`（默认：表情、@、图片、文件、截图、格式）、`hint`（传 `false` 隐藏快捷键提示）、`accessory`（放在发送按钮左侧的小控件，如「同时发送到群聊」复选框）。

传 `mentions`（成员数组）后，输入「@」或点 @ 按钮会弹出 `MentionPicker`：↑↓ 选择、Enter/Tab 确认、Esc 关闭，选中后插入「@名字 」，并回调 `onMention(member)`；`mentionAll: false` 去掉「所有人」。点表情按钮弹出 `EmojiPicker`，选中的表情插入光标处；`recentEmoji` 自定义常用表情。

Enter 发送，⇧Enter 换行，中文输入法选词时按 Enter 不会发送。输入为空时发送按钮不可用。高度随内容增长，最多 6 行。
