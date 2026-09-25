# Alert

警告对话框：打断用户做出决定。玻璃面板，左对齐，按钮横向等宽排列（3 个及以上纵向堆叠）。

**你需要提供**：`title`（问句，写清后果：「要将“季度报告”移到废纸篓吗？」）、`message`（一两句补充）、`actions: [{label, variant?, onClick}]`、可选 `icon`（48px，通常是 App 图标）与 `suppression`（「不再询问」复选框文字）。

默认操作用 `primary`，破坏性操作用 `destructive` 且不作为默认；「取消」永远存在。
