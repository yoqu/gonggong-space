# Toast

轻提示：操作完成后在窗口底部中间浮出的玻璃胶囊（如「已拷贝链接」），几秒后自动消失，可带一个「撤销」操作。另有 `HUD`：屏幕中央的方形玻璃面板（音量、亮度、「已存储」），和 macOS 系统 HUD 一致。

**你需要提供**：`Toast({message, icon?, action?: {label, onClick}, open, duration, onClose})`——设 `duration`（毫秒）和 `onClose` 自动关闭，带撤销操作时建议 ≥ 5000；`HUD({icon, title?, level?})`——`level`（0–1）显示 16 格电平条。

- 只用来确认已经发生的结果，不用于错误（错误用行内提示或 `Alert`）。
- 以 `role="status"` 播报，不抢焦点。
