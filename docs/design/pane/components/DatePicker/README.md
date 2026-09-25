# DatePicker

日期选择器：按钮样式的字段，显示「2026年10月8日 星期四」，点开后在弹出层里用 `Calendar` 选择，选中即关闭。

**你需要提供**：`value`/`defaultValue`、`onChange(isoDate)`、可选 `label`、`placeholder`（未选择时）、`min`/`max`、`marks`、`showWeekday`（默认 true）、`placement`。

- 值统一用 `'YYYY-MM-DD'` 字符串传出，避免时区问题；显示时按中文日期格式。
- 需要精确到时刻时，在旁边配一个 `Stepper` 或 `PopUpButton` 选时间，不要把时间塞进日历。
