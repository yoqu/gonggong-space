# SegmentedControl

分段控件：在 2–5 个视图或模式间切换；也是 TabView 的标签条。

**你需要提供**：`items: [{value, label?, icon?, aria-label?}]`、`value`/`defaultValue`、`onChange(value)`、`aria-label`。`size`：`small`｜`regular`｜`large`。

底槽 `control-track`，选中片 `control-fill` + `shadow-control`，都为胶囊形。同一控件内不要混用纯图标与纯文字段。
