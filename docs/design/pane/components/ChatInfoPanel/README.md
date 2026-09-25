# ChatInfoPanel

群信息面板：从聊天头部的「设置」打开，停靠在窗口右侧（`Window` 的 `inspector` 属性），宽 300px。结构依次是：群身份、快捷入口、群成员、设置项、危险操作。

**你需要提供**：`name`、可选 `description`、`tags`、`avatar`（默认按群名生成方形头像；单聊传 `group: false`）；`shortcuts: [{icon, label, onClick}]`（一行 4 个，如搜索、文件、Pin、公告）；`members`（头像数组）、`memberCount`、`onAddMember`、`onShowAllMembers`；`settings: [{label, description?, value?, onClick?, control?}]`（带 `control` 的行右侧放 Switch 等控件，带 `onClick` 的行自动显示右箭头）；`danger: {label, onClick}`（如「退出群聊」「解散群组」，红字居中，单独一组）；`onClose`。

- 需要其他内容时，直接放进 `children`，会插在成员区和设置区之间。
- 设置项的开关立即生效，不需要「存储」按钮。
