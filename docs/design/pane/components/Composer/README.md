# Composer

输入框：圆角 `radius-bubble` 的输入区，上方可带「回复某人」引用，下方是工具行和圆形发送按钮。

**你需要提供**：`recipient`（占位符写成「发送给 某人」）或 `placeholder`、`value`/`defaultValue`/`onChange`、`onSend(text)`；可选 `replyTo: {author, text}` 和 `onCancelReply`、`tools: [{icon, label, onClick}]`（默认：表情、@、图片、文件、截图、格式）、`hint`（传 `false` 隐藏快捷键提示）。

Enter 发送，⇧Enter 换行，中文输入法选词时按 Enter 不会发送。输入为空时发送按钮不可用。高度随内容增长，最多 6 行。
