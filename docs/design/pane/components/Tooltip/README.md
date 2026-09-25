# Tooltip

提示气泡（help tag）：鼠标停留约 0.6 秒、或键盘聚焦时，在控件上方显示一句说明，可带快捷键。主要给只有图标的按钮用。

**你需要提供**：`content`（一句短语，不加句号）、`children`（一个可聚焦的元素，通常是图标按钮）；可选 `shortcut`（如「⌘N」）、`placement`（`top` 默认 / `bottom`）、`delay`（毫秒）。

- 提示不能承载必需的信息——图标按钮仍然要有 `aria-label`；提示通过 `aria-describedby` 关联。
- 移开、失焦或按 Esc 立即隐藏。
