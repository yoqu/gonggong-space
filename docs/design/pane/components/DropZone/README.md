# DropZone

拖放区：把文件拖进来或点「选择文件…」添加，下方列出已添加的文件和上传状态。

**你需要提供**：`onFiles(files)`（拖入或选择后回调原生 `File` 数组）、可选 `accept`、`multiple`、`title`（默认「将文件拖到这里」）、`description`（格式和大小限制）、`buttonLabel`、`files: [{name, size?, progress?, error?}]`（显示列表：进行中显示进度条，100 显示「已上传」，`error` 显示错误）、`onRemove(index)`、`compact`（横排，放在表单里）。

- 拖入时边框变为 `accent` 实线、底色 `tint-blue`，标题改为「松开以添加」。
- 永远保留「选择文件…」按钮：拖放不是唯一入口，键盘和读屏用户也能添加。
- 大小或格式不符时逐个文件报错，不要整批拒绝。
