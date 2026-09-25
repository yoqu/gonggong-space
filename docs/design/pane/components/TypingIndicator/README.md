# TypingIndicator

「正在输入」提示：放在消息列表末尾（带气泡的三个跳动圆点），或放在 `ChatHeader` 的 `subtitle` 里（`bubble: false` 只显示文字）。

**你需要提供**：`name`（一个名字，或名字数组——超过 2 人时显示「A、B 等 N 人」）、可选 `bubble`。

- 对方停止输入 5 秒后移除。圆点动画在「减少动态效果」下静止。
