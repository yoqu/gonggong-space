# Calendar

月历：选择单个日期。标题「2026年10月」，左右箭头翻月，「今天」一键回到当天；一周从星期一开始（`weekStart: 0` 改为星期日）。

**你需要提供**：`value`/`defaultValue`（`'YYYY-MM-DD'` 或 `Date`）、`onChange(isoDate)`；可选 `min`/`max`（范围外的日期不可选）、`marks`（有日程的日期下方显示小圆点）、`today`。

- 选中日期：`accent-fill` 圆 + `on-accent` 字；今天：`accent-text` 加粗；非本月日期 `label-secondary`。
- 键盘：Tab 进入日期网格，方向键按天 / 按周移动（跨月自动翻页），PageUp/PageDown 翻月，Enter 或空格选中。每个日期的读屏名称是完整日期加星期。
