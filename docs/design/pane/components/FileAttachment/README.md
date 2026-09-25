# FileAttachment

文件消息：文件类型色块 + 文件名（最多两行）+ 大小，右侧下载按钮。

**你需要提供**：`name`（带扩展名，据此自动决定色块：PDF 红、文档蓝、表格绿、演示橙、图片/视频紫、压缩包灰）、`size`、可选 `meta`（「已下载」「正在上传」）、`progress`（0–100，显示进度条）、`onDownload`（传 `false` 隐藏按钮）。在 `Message` 里用 `bare`。
