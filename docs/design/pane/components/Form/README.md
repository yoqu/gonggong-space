# Form

表单布局：macOS 设置面板的经典排法——标签右对齐成一列，控件左对齐成另一列，说明文字放在控件下方。用在 Sheet、设置窗口和对话框里。

**你需要提供**：`Form` 包住若干 `FormRow({label, hint?, align?, children})`；标签默认自动加全角冒号（`colon: false` 去掉）；多行控件（复选框组、单选组、多行文本）用 `align: 'top'` 让标签和第一行对齐。`Divider` 放在两组设置之间；`FormActions` 放底部按钮（右对齐，primary 在最右，次要链接可以用 `marginRight: auto` 放左边）。

- `labelWidth` 默认按最长标签自动；同一窗口里多个表单要对齐时给固定宽度。
- 每行一件事；立即生效的开关不需要「存储」按钮，只有需要一起提交的输入才加 `FormActions`。
- 另有 `CheckboxGroup({options, value/defaultValue, onChange})`：多选组，值为数组。
