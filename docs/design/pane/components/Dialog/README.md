# Dialog

对话框：盖住整个页面的模态层（网页里没有「窗口」时使用）。可以像 Sheet 一样带标题、说明、内容和按钮，也可以用 `bare` 直接包一个 `Alert`。

**你需要提供**：与 `Sheet` 相同的 `open`、`onClose`、`title`、`message`、`children`、`actions`；另有 `bare`（不画面板，只提供遮罩、居中和焦点管理，用来包 `Alert`）、`role: 'alertdialog'`（破坏性确认时使用）、`contained`（限制在最近的定位容器内，演示用）、`closeOnScrim`（默认 true）。

- 破坏性确认：`bare` + `Alert`，破坏性按钮不设 `autoFocus`，让 Enter 不会误触删除。
- 焦点管理同 `Sheet`：打开时进入，Tab 循环，Esc 关闭，关闭后归还焦点。
