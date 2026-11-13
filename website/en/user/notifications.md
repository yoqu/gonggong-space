# Notifications

This page covers the notification center, per-conversation notification levels, browser and Feishu push, pausing notifications and quiet hours, and unread messages and 「稍后处理」 (Later).

## Notification center

Click 「通知」 (Notifications) in the left navigation bar to open the notification panel; the unread count is next to the title.

![Notification center panel](/screenshots/web/notifications.webp)

The notification center only holds items that **need your action or concern you directly**; group-level events such as mode switches or a machine falling behind are shown only inside the group. Common notifications:

| Notification | When you get it |
| --- | --- |
| 待审批 (Needs approval) | Your Bot requests an action that needs approval — see [Approvals and questions](/en/user/approvals) |
| 待回答 (Needs answer) | A Bot asked you a question |
| 有人@我 (Mentioned) / Bot 回复了我 (Bot replied to me) | Someone @-mentioned you; or a Bot replied in a thread to a task you started |
| 稍后处理提醒 (Reminder) | A reminder you set is due |
| Bot 离线作废 (Expired: Bot offline) | A Bot you @-mentioned never came online, and the request was dropped after timing out |
| 接力链结束 (Relay finished) | A Bot relay you started has ended (completed or interrupted with `/stop`) |
| Bot 无法访问仓库 (Bot cannot reach the repo) | Your Bot's machine can't access the repository bound to the group |
| 定时任务已停用 (Scheduled task turned off) | Your scheduled task was turned off automatically — see [Scheduled tasks and threads](/en/user/schedules-threads#manage-and-turn-off) |
| 待处理入群申请 (Join request to review) / 入群申请已通过 (Join request approved) / 被拒绝 (declined) | Someone asked to join a group you manage; or your request got a result |
| 待处理共享申请 (Share request to review) / 共享申请已通过 (Share request approved) / 被拒绝 (declined) | Bot sharing requests and their results |
| 待审批 Git 操作 (Git request to review) | A member requests a Git operation on your Bot's workspace — see [Git](/en/user/git) |
| 待确认的机器接入 (Machine waiting to be allowed) | A machine is asking to connect with a connect code you sent — see [Bind a machine](/en/user/bind-machine) |
| 待授权的插件 (Plugin to authorize) | A plugin wants to run code on your machine — see [Skill market and plugins](/en/user/market-plugins) |
| 待确认 Bot (Bot to confirm) / 共享 Bot (Shared Bot) | An admin created a Bot for you that needs confirmation; someone shared a Bot with you |
| 引入申请 (Install request), reviews, bans, 版本更新 (New version) | Related to the Skill market — see [Skill market and plugins](/en/user/market-plugins) |
| 本地有改动 (Local changes) / 同步冲突 (Sync conflict) | Your Bot in a force-sync group needs attention — see [Repositories and workspaces](/en/user/repos-workspaces#sync-mode) |

Each notification shows its type, content, group, and time. Approvals and requests already handled elsewhere are marked 「已处理」 (Handled).

- Click a notification: marks it read and jumps to where you can handle it.
- Join requests and share requests can be handled directly with 「同意」 (Approve) / 「拒绝」 (Decline); plugin authorizations with 「允许」 (Allow) / 「拒绝」 (Deny); approvals in direct chats you're not part of (such as a direct chat with a Bot you shared with someone) with 「批准」 (Approve) / 「拒绝」 (Deny).
- At the top: 「全部标为已读」 (Mark all as read) and 「清除已读」 (Clear read); 「×」 at the right of a row deletes that notification.
- When you open a group, notifications for @-mentions of you in that group are marked read automatically; @-mentions in a thread are marked read when you open the thread.

## Per-conversation notification levels

Each group and direct chat can have its own notification level. Change it via 「通知」 (Notifications) in the conversation list's right-click menu, or under 「通知」 in the group settings sidebar:

| Level | Description |
| --- | --- |
| 全部 (All) | Alert for every new message |
| 仅@ (Mentions only; default) | Alert only for @me and @all |
| 关闭 (Off) | No alerts even for @-mentions; pending approvals and questions to you still alert |

- At 「全部」 (All), every new message is pushed to the browser but doesn't go into the notification list; thread replies only alert the thread's followers.
- Conversations set to 「关闭」 (Off) show a mute icon in the group header, are grayed out in the conversation list, and don't count toward the total unread count.
- Only group admins can @all in a group.

## Browser and Feishu push

Besides the notification center, notifications can also be pushed to your browser and to Feishu. Settings are under avatar menu → 「设置…」 (Settings…) → 「通知」 (Notifications).

### Browser notifications

Once enabled, new notifications pop up as system notifications even when the Gonggong Space web page isn't in the foreground; clicking one opens the relevant page directly.

1. In 「设置 → 通知」 (Settings → Notifications), click 「开启浏览器通知」 (Turn on browser notifications). The bottom of the notification panel has the same button.
2. Choose 「允许」 (Allow) in the browser's permission prompt.

Once enabled, it shows 「浏览器通知已开启」 ("Browser notifications are on"). You need to enable it separately on each device and in each browser.

::: warning HTTPS required
Browser push only works in a secure context: the URL must be `https://`, or `localhost` / `127.0.0.1` on your own machine. When you access the app over `http://` with a LAN IP, the browser doesn't offer push and this option doesn't appear. If you need push, ask your admin to set up HTTPS — see [HTTPS and certificates](/en/deploy/https).
:::

::: tip 「浏览器通知已被禁止，请在浏览器设置中允许」 ("Browser notifications are blocked; allow them in your browser settings") is shown
You previously denied notification permission in the browser. In the browser's site settings, change "Notifications" for this site to Allow, then refresh the page.
:::

- After you sign in, if this browser was authorized before, it automatically resubscribes for the current account.
- Signing out unsubscribes this browser, so it no longer receives push notifications for the previous account.

### Feishu notifications

When the system has Feishu login enabled, 「设置 → 通知」 (Settings → Notifications) has a 「飞书通知」 (Feishu notifications) switch: notifications that need your action are also sent to Feishu as cards, delivered to you in a direct chat by the 「共工」 (Gonggong) app; the group you're currently viewing isn't sent again.

If you haven't linked a Feishu account yet, it shows 「绑定飞书账号后可开启」 ("Link your Feishu account to turn this on"); click 「绑定飞书」 (Link Feishu) to link one first.

### What isn't pushed

- 待确认 Bot (Bot to confirm), 共享 Bot (Shared Bot), Bot 无法访问仓库 (Bot cannot reach the repo), 定时任务已停用 (Scheduled task turned off), 本地有改动 (Local changes), 同步冲突 (Sync conflict), and 版本更新 (New version) only go into the notification list and aren't pushed.
- Notifications for the group you're viewing in the foreground aren't pushed.
- Nothing is pushed while notifications are paused or during quiet hours (see below); the notification list still records everything.

## Pause notifications and quiet hours

**Pause notifications**: avatar menu → 「暂停通知」 (Pause notifications), then choose 「30 分钟」 (30 minutes), 「1 小时」 (1 hour), 「2 小时」 (2 hours), 「到明天 9 点」 (Until 9 AM tomorrow), or 「自定义…」 (Custom…). While paused, your avatar shows a mute badge and the menu item becomes 「恢复通知（已暂停到 …）」 (Resume notifications (paused until …)); click it to resume early.

**Quiet hours**: turn on 「免打扰时段」 (Quiet hours) in 「设置 → 通知」 (Settings → Notifications). The default is 22:00 to 08:00; it can span midnight and uses your browser's time zone. During this period every day, browser and Feishu notifications aren't pushed; the notification list still records everything.

## Unread

- In the conversation list, a group with unread messages has its name in bold, and **the count only includes messages that @-mention you**; for direct chats, the count is all unread messages.
- The browser tab title shows the total unread count, e.g. 「(3) 共工空间」.
- When you open a group with unread messages, it shows 「N 条新消息 · 跳到首条」 (N new messages · Jump to first).
- Press Esc to mark the current conversation as read; Shift + Esc marks all groups in the current team as read (after confirmation).
- 「清除未读」 (Mark as read) in the conversation list's right-click menu; 「从这里标为未读」 (Mark unread from here) in a message's 「更多」 (More) menu moves the unread divider to that message.

「全部未读」 (All unreads) at the top of the conversation list collects unread messages across all groups, one card per group. You can 「回复…」 (Reply…) or 「标为已读」 (Mark as read) directly, and 「全部标为已读」 (Mark all as read) is at the top.

## Later

For a message you want to handle later, click 「稍后处理」 (Later) in its 「更多」 (More) menu and pick a reminder time: 「20 分钟后」 (In 20 minutes), 「1 小时后」 (In 1 hour), 「3 小时后」 (In 3 hours), 「明天 9 点」 (Tomorrow at 9:00), 「下周一 9 点」 (Next Monday at 9:00), 「自定义…」 (Custom…), or 「不提醒」 (Don't remind me).

- When it's due, you get a 「稍后处理提醒」 (Reminder) notification.
- 「稍后处理」 (Later) at the top of the conversation list is split into 「进行中」 (In progress) and 「已完成」 (Completed). Each item can be marked 「完成」 (Done), or you can 「改提醒」 (Change reminder), 「跳到原消息」 (Go to message), or 「移除」 (Remove); completed items can be moved back with 「移回进行中」 (Move back to in progress). A count shows when reminders are due.
- For a message already saved, the menu shows 「修改提醒」 (Change reminder) and 「移除稍后处理」 (Remove from Later).

## Related pages

- [Approvals and questions](/en/user/approvals)
- [Scheduled tasks and threads](/en/user/schedules-threads)
- [Interface tour](/en/user/interface)
- [HTTPS and certificates](/en/deploy/https)
