# Sheet

Sheet：窗口内的模态面板，从工具栏下方出现，压暗并阻断这个窗口（其他窗口不受影响）。用于新建、导出、设置向导等需要一小组输入再确认的任务。放在 `Window` 的子元素里即可。

**你需要提供**：`open`、`onClose`（Esc 和「取消」都应调用）、`title`、可选 `message`（一句说明）、`children`（表单控件）、`actions: [{label, variant?, onClick, disabled?, autoFocus?}]`（从左到右排列，最右边是 primary，如「取消」「创建」）、`footer`（左下角的次要操作，如「了解更多…」）、`width`（默认 480）、`closeOnScrim`（默认 false：点遮罩不关闭，防止误丢输入）。

- 打开后焦点进入第一个输入框（或带 `autoFocus` 的按钮），Tab 在面板内循环，关闭后焦点回到打开前的位置。
- 只需要确认或警告、没有输入时，用 `Alert` 或 `Dialog`，不要用 Sheet。
- 遮罩 `scrim`，面板 `window-bg` + `shadow-window`，圆角 `radius-window`。
