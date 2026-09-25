# EmojiPicker

表情选择器：Liquid Glass 面板，顶部搜索，分类「常用 / 笑脸 / 手势 / 符号」，8 列网格。点输入框的表情按钮、或表情回复里的「+」时弹出。

**你需要提供**：`onSelect(emoji)`；可选 `recent`（常用表情，默认 👍 ✅ 🎉 😄 🙏 👀 🔥 💪）、`defaultCategory`。

- 搜索按中文关键词匹配（「赞」「收到」「加急」「上线」）。
- 表情用系统彩色表情字体渲染；格子 34px，悬停为 `selection-fill`。
- 在 `Composer` 中点表情按钮开关（按钮保持按下态），选中后插入到光标处并关闭；在 `Reactions` 中设 `addable`，选中即回调 `onToggle(emoji)`。

键盘：Tab 进入网格后用方向键在表情间移动（上下一次跨一行 8 个），Enter 选中。
