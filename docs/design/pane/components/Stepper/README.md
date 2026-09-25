# Stepper

步进器：数字输入框加 macOS 的上下小箭头（NSStepper），用于字号、份数、间隔时间这类有范围的数字。

**你需要提供**：`value`/`defaultValue`、`onChange(number)`、`min`、`max`、`step`（默认 1，小数步长自动决定显示的小数位，或用 `precision` 指定）、可选 `label`、`unit`（单位，放在箭头左侧）、`width`（输入框宽，默认 72）。

- 键盘：↑↓ 增减一步，⇧↑↓ 一次十步；也可以直接输入，失焦或回车时校验并限制在范围内。到达上下限时对应箭头变灰。
- 读屏按 spinbutton 朗读当前值和范围。
