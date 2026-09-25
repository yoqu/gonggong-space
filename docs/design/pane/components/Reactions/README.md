# Reactions

表情回复：气泡底部的一排胶囊，每个显示表情和回复人名字（最多列 3 人，之后写「等 N 人」）。

**你需要提供**：`items: [{emoji, users: string[], mine?, label?}]`、`onToggle(emoji)`、可选 `addable`（末尾显示「+」按钮，点开 `EmojiPicker`，选中即 `onToggle`）或 `onAdd`（只要按钮、自己处理弹出）、`compact`（只显示人数）。

自己参与的那项（`mine`）用 `tint-blue` 底、`accent` 描边。表情是用户内容，界面文案本身仍然不用 emoji。
