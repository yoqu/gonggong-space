# ColorWell

颜色选择：两种形态。默认是色井（NSColorWell）——点开弹出层，从色板里选或输入 `#RRGGBB`；`inline` 是系统设置里「强调色」那样的一排圆点，适合 5–10 个固定选项。

**你需要提供**：`value`/`defaultValue`（十六进制字符串）、`onChange(hex)`；可选 `colors`（色板，默认 macOS 系统色 + 黑白）、`names`（每个颜色的中文名，用于读屏和提示，`inline` 时必填）、`label`、`aria-label`。

- 输入框只接受 6 位十六进制，格式不对时给出行内提示；按 Enter 应用。
- `inline` 形态按单选组操作：←→ 切换。选中的圆点中间出现白点，不只靠边框区分。
