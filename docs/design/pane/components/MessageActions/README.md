# MessageActions

消息悬停操作条：Liquid Glass 胶囊，默认 5 个动作——表情回复、回复、回复话题、转发、更多。

**你需要提供**：可选 `items: [{icon, label, onClick}]`（最多 5 个，每个都要有 `label`，用作提示和无障碍名称）、`onAction(label)`。一般不用单独使用，`Message` 会在悬停和键盘聚焦时自动显示它。
