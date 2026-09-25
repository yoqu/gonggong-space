# Popover

弹出层：点按触发元素后在旁边弹出的 Liquid Glass 面板，用于名片、筛选条件、快捷设置等轻量内容。

**你需要提供**：`trigger`（触发元素，如按钮或头像）、`children`（面板内容）、可选 `placement`（`bottom-start` 默认、`bottom-end`、`top-start`、`top-end`、`right-start`）、`width`、`open`/`defaultOpen`/`onOpenChange`、`aria-label`。

- 点外部或按 Esc 关闭。面板内边距 `space-12`，圆角 `radius-window`，材质同菜单（`glass-fill` + `shadow-menu`）。
- 需要用户做选择并立刻关闭的场景用 `Menu` / `PopUpButton`；需要确认后果的用 `Alert`。
- `ProfileCard` 是常见的面板内容：点消息里的头像或 @某人时弹出名片——头像、状态（「会议中 · 至 11:00」）、职位、字段列表（邮箱、城市、本地时间）和操作按钮（第一个默认为 primary，`text: false` 的只显示图标）。
