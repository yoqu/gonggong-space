# LevelIndicator

电平 / 容量指示器（NSLevelIndicator）：三种形态——`capacity` 连续条（储存空间、配额）、`discrete` 分格（信号、电量）、`rating` 星级评分。

**你需要提供**：`kind`、`value`、`max`（容量默认 100，评分默认 5）、`aria-label`；可选 `warning`/`critical` 阈值（达到后填充改为 `tint-orange-text` / `tint-red-text`）、`parts`（容量条分段：`[{value, color, label}]`，带图例）、`label`（条上方的一行说明）、`segments`（分格数）、`editable` + `onChange`（可编辑评分，←→ 或数字键调整）。

- 颜色只是辅助：容量条上方一定要有「已用 186 GB，共 256 GB」这样的文字。
- 读屏：容量和分格按 meter 朗读，可编辑评分按 slider 朗读。
