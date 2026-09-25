# PopUpButton

弹出按钮：从一组互斥选项中选一个，点开后显示带勾选的 Menu。

**你需要提供**：`options: [{value, label}]`、`value`/`defaultValue`、`onChange(value)`；可选 `size`、`placeholder`、`defaultOpen`。

外观同默认 Button，右侧带上下箭头。点击外部或按 Esc 关闭。选项超过 12 个考虑用搜索或列表。
