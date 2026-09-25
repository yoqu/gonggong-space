# MeetingCard

视频会议卡片：在会话里发起或分享会议时出现。三种状态：`scheduled`（即将开始，蓝）、`live`（进行中，绿，带呼吸点）、`ended`（已结束，灰）。

**你需要提供**：`title`、`time`、`status`；可选 `startsIn`（如「5 分钟后开始」，替换默认标签文字）、`meetingId`（等宽字体显示）、`host`、`duration`（结束后显示）、`participants`（头像数组）、`joined`（在会人数）、`onJoin`、`onReplay`（有回放时显示「查看回放」）。

- 进行中和即将开始时右下角是 primary「加入会议」；结束后换成回放按钮或不显示按钮。
- 状态同时用文字、颜色和图标底色表达。
