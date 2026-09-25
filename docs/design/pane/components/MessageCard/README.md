# MessageCard

消息卡片：机器人和应用发的结构化消息，比如审批、通知、告警。有色标题栏 + 字段 + 按钮。

**你需要提供**：`title`、`template`（`blue` 通知、`green` 成功、`orange` 待处理、`red` 告警、`purple`、`gray` 已结束）、可选 `icon`、`status: {label, tone}`（标题栏右侧的状态标签）、`fields: [{label, value, short?}]`（`short` 两列并排）、`children`（自由内容）、`actions: [{label, variant?, onClick}]`（最多 3 个，至多一个 `primary`）、`note`（脚注：来源、时间）。

处理完成后，把按钮换成状态标签（如「已同意」），不要留着可点的按钮。
