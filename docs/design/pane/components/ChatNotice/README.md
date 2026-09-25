# ChatNotice

会话中的居中提示：日期分隔、系统消息、「以下为新消息」分隔线、加急提醒。

**你需要提供**：`kind`（`date` | `system` | `unread` | `urgent` | `recalled`）和 `children`；`date` 可加 `day`（「今天」「昨天」，粗体显示）；`recalled`（撤回）默认文字「你撤回了一条消息」，可带 `action: {label: '重新编辑', onClick}`，只在自己撤回后 2 分钟内提供。系统消息写成陈述句：「张三 邀请 Mia Chen 加入了群聊」。
