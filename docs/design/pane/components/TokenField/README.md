# TokenField

标签输入框（NSTokenField）：把输入的内容变成一个个胶囊，用于收件人、成员、标签等多值输入。

**你需要提供**：`value`/`defaultValue`（字符串或 `{label, tone?, detail?}` 数组）、`onChange(tokens)`；可选 `suggestions`（输入时按包含关系联想，最多 6 条，`detail` 显示在右侧）、`label`、`placeholder`、`hint`、`commitOnBlur`（默认 true：失焦时把剩余文字也变成胶囊）。

- 确认一个胶囊：Enter、Tab、逗号或分号（中英文均可）；空输入时按退格删除最后一个胶囊。重复值自动忽略。
- 胶囊默认 `tint-blue`，外部联系人用 `orange`，普通标签用 `gray`，与 `Tag` 的颜色含义一致。
