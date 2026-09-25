# TextArea

多行文本框：群介绍、反馈、备注等较长输入。样式与 `TextField` 一致，可纵向拖动调整高度。

**你需要提供**：`label`、`value`/`defaultValue`/`onChange`、可选 `placeholder`、`rows`（默认 3）、`maxLength`（显示「已输入 / 上限」计数，`showCount: false` 可隐藏）、`autoGrow`（随内容长高，最高 `maxHeight`，默认 240px）、`hint`、`error`。
