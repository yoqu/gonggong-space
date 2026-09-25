# Tag

标签：会话和发送者身上的身份标记，以及卡片状态。

**你需要提供**：`children`（2–4 个字）、`tone`、可选 `icon`。

- 约定：`orange` 外部、`blue` 机器人、`green` 官方、`purple` 全员、`gray` 部门，`red` 否定状态；`solid-red` 只用于「加急」。
- 浅底 `tint-*` 配 `tint-*-text`，两套主题都 ≥ 4.7:1。
- `Badge({count, muted})`：未读数徽标，超过 99 显示「99+」；免打扰会话用 `muted`（`badge-muted` 灰）。
