# EventCard

日程卡片：会话里分享的日程邀请。左侧是日历样式的日期块（星期用 `tint-red-text`，日期大字），右侧是标题、时间、地点、组织者，底部直接回复「接受 / 待定 / 拒绝」。

**你需要提供**：`title`、`month`、`day`、`weekday`、`time`；可选 `location`、`organizer`、`attendees`、`rsvp`/`defaultRsvp`/`onRsvp(v)`（传 `rsvp: false` 去掉底部回复栏）。

- 左侧文字随回复状态变化：「是否参加？」→「你已接受」。
- 日期块只放日期，不放图标；跨天日程在 `time` 里写全起止日期。
