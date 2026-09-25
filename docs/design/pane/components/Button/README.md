# Button

Push button：胶囊形，四档尺寸，五种样式。

**你需要提供**：`children`（文字，动词开头：「存储」「移到废纸篓」）、可选 `icon`（图标名或节点）、`onClick`。

- `variant`：`default`（白色控件面，`control-fill`）｜`primary`（`accent-fill` + `on-accent`，每个视图/对话框最多一个，对应回车默认操作）｜`destructive`（`destructive-fill`，仅用于不可撤销操作）｜`glass`（Liquid Glass，浮在内容或壁纸上时用）｜`plain`（无底，`accent-text`，用于「了解更多…」这类次级链接）。
- `size`：`small` 20px｜`regular` 24px（默认）｜`large` 30px（Alert、设置页主操作）｜`xlarge` 36px（引导/登录页唯一主操作）。
- 只有 `icon` 没有文字时变为圆形图标按钮，必须传 `aria-label`。
- 文字用句首大写/中文不加句号；需要进一步输入的操作以「…」结尾。

不要：在同一组里放两个 primary；用 destructive 做「取消」。
