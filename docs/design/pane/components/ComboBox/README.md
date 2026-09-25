# ComboBox

组合框：既能从列表里选、也能直接输入的下拉框（NSComboBox），适合选项多但允许自定义值的场景，如城市、字体、标签。只能从固定选项里选时用 `PopUpButton`。

**你需要提供**：`options`（字符串数组，或 `{value, label, detail?}`；`detail` 显示在右侧）、`value`/`defaultValue`、`onChange(value, option)`（从列表选中时触发）、`onInput(text)`（自由输入时触发）、可选 `label`、`placeholder`。

- 输入时按包含关系筛选列表；点右侧箭头显示全部选项。
- 键盘：↓ 打开并移动，↑ 向上，Enter 选中，Esc 关闭；读屏按 combobox + listbox 朗读当前项。
