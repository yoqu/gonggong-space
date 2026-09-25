# GroupBox

分组框：系统设置风格的圆角分组，每行左侧标签、右侧控件，行间发丝分隔线。

**你需要提供**：若干 `GroupRow({label, description?, value?, onClick?, chevron?, destructive?, children})`；`children` 为该行右侧的控件（Switch、PopUpButton、SegmentedControl、Slider…）。有 `onClick` 的行整行可点，右侧显示 `value`（`label-secondary`）和右箭头，用于进入下一级；`destructive` 行红字居中，单独放一个分组。底色 `group-bg`，圆角 `radius-menu`。
