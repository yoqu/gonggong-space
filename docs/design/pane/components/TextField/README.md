# TextField

单行文本框：圆角 `radius-field`，`content-bg` 底，1px `control-stroke` 内描边。

**你需要提供**：`label`（放在框上方，`label-secondary`）、`placeholder`、`value`/`defaultValue`/`onChange`；可选 `hint`（说明）或 `error`（错误文字，出现时描边变 `system-red` 并带警示符号，不只靠颜色）。`size="large"` 30px 高。

聚焦时 3px `focus-ring` 外环。占位符用 `label-tertiary`，不要把必要说明只写在占位符里。
