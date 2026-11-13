# Interface tour

This page describes the layout of the web app's main interface: the welcome page, the navigation rail on the left, the conversation sidebar, the message area, the sidebar and workbench on the right, and what changes on narrow screens.

## Welcome page

Until you've joined any group, the main area shows the welcome page.

![Welcome page](/screenshots/web/welcome.webp)

**Members who set up their own Bots** see a short demo and a three-step guide; completed steps get a check mark and 「已完成」 (Completed):

1. **Bind a new machine**: copy one sentence and send it to Claude Code or Codex on your computer; it installs everything, binds the machine, and creates a Bot by itself. See [Bind a machine](/en/user/bind-machine).
2. **Create a Bot**: choose an Agent on the machine and give it an easy-to-recognize name. See [Create a Bot](/en/user/create-bot).
3. **Start your first conversation**: chat directly with your Bot, or bring in teammates and create a group. See [Groups and direct chats](/en/user/groups).

**Members who only @ Bots in groups** see a short version: click 「接入我的电脑，搭自己的 Bot」 (Connect my computer and build my own Bot) to go through the three steps above; if the sidebar has groups you can join, click 「查看可加入的群」 (See groups to join) to request to join; or wait for a teammate to add you to a group and @ a Bot there to ask questions directly.

After you join a group, a 「开始使用」 (Get started) card stays in the sidebar until all three steps are done. 「新手指引」 (Getting started) in the avatar menu reopens the onboarding guide at any time.

## Overall layout

![Main interface overview](/screenshots/web/interface.webp)

From left to right:

| Area | Contents |
| --- | --- |
| Navigation rail | Messages, Works, Market, Machines & Bots, Notifications, admin console; the avatar menu at the bottom |
| Sidebar | The conversation list; in 「机器与 Bot」 (Machines & Bots) it becomes a tree of machines and Bots |
| Message area | Messages and the composer of the current group or direct chat |
| Right side | Sidebars such as group info and threads, or the workbench when tabs are open |

On wide screens, reopening the web app takes you back to the group you last had open.

## Navigation rail

| Button | What it does |
| --- | --- |
| 消息 (Messages) | Back to the conversation list; the badge is the unread count across all groups not muted |
| 作品 (Works) | The works library; appears only when the team has creation plugins enabled. See [Prototypes, canvas, and works](/en/user/artifacts) |
| 市场 (Market) | The Skill and plugin market. See [Skill market and plugins](/en/user/market-plugins) |
| 机器与 Bot (Machines & Bots) | Your machines and Bots. See [My machines and Bots](/en/user/machines) |
| 通知 (Notifications) | Opens the notification panel; the badge is the number of unread notifications. See [Notifications](/en/user/notifications) |
| 管理后台 (Admin console) | Visible to sysadmins only. See [Admin console](/en/admin/) |
| Avatar | The avatar menu. See [Login and account](/en/user/login#avatar-menu) |

::: tip
「市场」 (Market) and 「机器与 Bot」 (Machines & Bots) are for setting up Bots. Members who have no machine or Bot and aren't a group admin or team admin don't see these two items by default; they appear after clicking 「接入我的电脑」 (Connect my computer) in the avatar menu.
:::

## Conversation sidebar

At the top are the 「共工空间」 (Gonggong Space) title (replaced by a team switcher if you've joined several teams) and 「+」 (New conversation), with the search box below. Click the search box or press `⌘K` (`Ctrl K` on Windows / Linux) to search conversations, messages, files, and runs.

The dialog opened by 「+」 lets you 「发起会话」 (New conversation; pick members and Bots — choosing only one of your own Bots makes a direct chat, otherwise a group is created), or switch to 「新建终端」 (New terminal). See [Groups and direct chats](/en/user/groups) and [My machines and Bots](/en/user/machines#terminal-sessions).

Below the search box, in order:

- **Shortcuts**: 「话题」 (Threads; threads you follow and their new replies), 「全部未读」 (All unreads), 「稍后处理」 (Later; saved messages and reminders);
- **Sections**: 「星标」 (Star), team sections, personal sections you created, 「频道」 (Channels; groups), and 「私信」 (Direct messages; direct chats). Groups and direct chats are sorted by latest message and can be dragged to another section; sections can be collapsed;
- **Done**: conversations marked 「完成」 (Done) are tucked into 「已完成 · N」 (Done · N) at the bottom;
- **Terminals**: machine terminal sessions you've opened;
- When you have flagged conversations, a 「只看已标记」 (Flagged only) filter appears at the top.

Each row shows the latest message; running, unread count, draft, and muted states are all marked on the row. Right-click (or use the row's menu) to star, move to a section, set notifications, clear unreads, mark done, flag, open group info, copy the channel link, leave the channel, and more; see [Groups and direct chats](/en/user/groups).

At the bottom of the sidebar is a status line: the connection to the server (已连接 / 连接中… / 已断开 · 重连中 — Connected / Connecting… / Disconnected · reconnecting), the number of online Bots, and the number of online machines.

::: tip Keyboard
With focus on the conversation list, use `↑` `↓` `Home` `End` to move between and open conversations.
:::

## Message area

At the top of the message area is the group header: group avatar and name, with a subtitle showing the first line of the group announcement and the bound repository and branch (when no repository is bound it shows 「未绑定仓库 · 各 Bot 使用本机目录」 (No repo · each Bot uses a local folder); in a direct chat it shows whether the Bot uses a managed workspace or a local directory). Buttons on the right:

- **Members** (not in direct chats): the number is the member count; opens the member list in the group info sidebar.
- **Threads**: opens the group's thread list. See [Schedules and threads](/en/user/schedules-threads).
- **Workbench**: shows or hides the workbench on the right; the number is how many tabs are open.
- **Group settings**: opens or closes the group info sidebar.

Below the group header are the group tab bar, the Git bar, and the Bot bar (branch, sync status, context usage, etc.), followed by the message list and the composer. These are covered in [Directing Bots in a group](/en/user/chat), [Runs](/en/user/runs), and [Git management](/en/user/git).

## Right side: sidebar

Click 「群设置」 (Group settings) or 「群成员」 (Members) to open the group info sidebar, showing group members, Bots, the announcement, and more (see [Groups and direct chats](/en/user/groups)); click 「话题」 (Thread) to open the thread list. Drag the sidebar's left edge to resize it (or focus it and use `←` `→`); the width is remembered in this browser. When the window is narrower than 1100px, the sidebar is collapsed by default.

## Right side: workbench

When you open a run's process, code changes, files, or a preview from a message, the content appears as a tab in the workbench to the right of the message area. Each group has its own set of tabs, up to 12.

![Split layout: the workbench to the right of the message area, showing a web preview](/screenshots/web/workbench-split.webp)

Common tabs:

| Tab | Contents |
| --- | --- |
| Run (`Bot name · 第 N 轮`, turn N) | A turn's 「过程」 (Process), 「改动」 (Changes), 「上下文」 (Context), and 「审批记录」 (Approvals). See [Runs](/en/user/runs) |
| Changes | Uncommitted changes in the Bot's workspace. See [Diffs and files](/en/user/diff-files) |
| Files | The file tree and file contents of the Bot's workspace |
| Git | Commits, log, stashes, comparison, and conflict resolution. See [Git management](/en/user/git) |
| Terminal | An interactive shell in the Bot's workspace (machine owner only) |
| Knowledge base / prototype | Knowledge base entries and the prototype canvas. See [Knowledge base and secrets](/en/user/knowledge-secrets) and [Prototypes, canvas, and works](/en/user/artifacts) |
| Preview / mini program / desktop app | Web pages, mini programs, or live views published by the Bot. See [Previews](/en/user/previews) |

The 「+」 (New tab) on the workbench tab bar can open a web page, add a group tab, browse a Bot's files, open its Git panel, or create a new terminal.

### Web preview

The toolbar lets you refresh, enter a path, switch the viewport width (fit / 1440 / 1024 / 768 / 390), open in a new window, and create a 「公开链接…」 (Public link…).

![Web preview tab](/screenshots/web/workbench-web.webp)

### Mini programs and desktop apps

Mini programs and desktop apps are shown as a live view. The default is 「仅观看」 (View only); click 「开始控制」 (Take control) to operate remotely. Frame rate and quality are adjustable, and stream stats can be shown in the top-right corner.

![Mini program tab](/screenshots/web/workbench-miniprogram.webp)

When several people are watching, others can request control, and the current controller chooses 「同意」 (Approve) or 「拒绝」 (Deny); they can also 「交还控制」 (Release control) at any time.

![Desktop app tab (live view and remote control)](/screenshots/web/workbench-live.webp)

### Layouts

Switch between three layouts at the top-right of the workbench:

| Layout | Effect | Shortcut |
| --- | --- | --- |
| 分栏 (Split) | Conversation list, message area, and workbench side by side | `⌘\` toggles between split and focus |
| 专注 (Focus) | The conversation list shrinks to a column of avatars, giving the workbench more room | `⌘\` |
| 全屏 (Full screen) | The message area shrinks to a narrow strip and the workbench fills the rest; press `Esc` to go back | `⌘⇧\` |

![Focus layout](/screenshots/web/workbench-focus.webp)

![Full screen layout](/screenshots/web/workbench-fullscreen.webp)

Other shortcuts: `⌃Tab` / `⌃⇧Tab` switch tabs, `⌥W` closes the current tab (on Windows / Linux, `⌘` becomes `Ctrl`). Right-click a tab to 「关闭其他标签页」 (Close other tabs) or 「关闭右侧标签页」 (Close tabs to the right). Drag the divider between the message area and the workbench to adjust the chat column width.

::: tip
When the window is narrower than 1100px there's no 「分栏」 (Split); 「专注」 (Focus) is used automatically. Only the 4 most recently used web preview tabs stay active; the rest go to sleep (a moon icon on the tab) to save memory and resume when you click them again. Tabs can be dragged to reorder.
:::

## Narrow-screen layout

When the window is narrower than 768px (e.g. on a phone), the interface becomes a single column:

- The home screen is the conversation list, and the navigation rail becomes a bottom tab bar (the rail's items plus the avatar).
- Inside a group, only the message area is shown; the back button at the top-left returns to the conversation list.
- The group info sidebar appears as an overlay on top of the message area.
- The workbench becomes a full-screen page with its tabs in a dropdown at the top; tap 「返回聊天」 (Back to chat) to return to the message area, with your draft and scroll position preserved.
- When you scroll the message area, the top bar collapses and the composer shrinks; they come back when you return to the bottom or tap the input area.
- When disconnected from the server, 「连接已断开，正在重连…」 ("Disconnected. Reconnecting…") appears at the top.

![Workbench on a phone](/screenshots/web/workbench-mobile.webp){width=320}

## Related pages

- [Login and account](/en/user/login)
- [Groups and direct chats](/en/user/groups)
- [Directing Bots in a group](/en/user/chat)
- [Runs](/en/user/runs)
- [Appearance and themes](/en/user/appearance)
