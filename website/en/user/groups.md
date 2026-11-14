# Groups and direct chats

This page covers starting groups and direct chats, organizing the conversation list, public channels and join requests, adding people and Bots, every option in group settings, and leaving or disbanding a group.

- **Group**: team members and multiple Bots collaborate together, and the group can be bound to a git repository. Groups are either 「公开频道」 (Public channel) or 「私有群」 (Private group).
- **Direct chat**: just you and one Bot (your own, or one someone shared with you). Good for personal use or trying out a Bot.

## Start a conversation

Groups and direct chats are created from the same entry point: click 「+」 (「发起会话」, New conversation) at the top of the conversation list. If you have no conversations yet, the 「发起会话」 (New conversation) button in the list also works.

![New conversation dialog](/screenshots/web/new-group.webp)

The dialog has two tabs at the top: 「发起会话」 (New conversation) and 「新建终端」 (New terminal). 「新建终端」 opens a terminal session on one of your own machines; see [My machines and Bots](/en/user/machines).

In 「发起会话」 (New conversation):

1. Under 「Bot」, click 「添加 Bot…」 (Add Bot…) and pick one or more Bots. Candidates are grouped into 「我的 Bot」 (My Bots) and 「其他成员的 Bot」 (Others' Bots), with your Bots sorted by most recently used. The search box supports pinyin (full pinyin, initials, or a mix, e.g. `jwc` finds 「姜维川」).
2. Under 「成员」 (Members), click 「+」 to add colleagues.
3. If the Bots need to change code, choose a repository and 「基准分支」 (Base branch) at the bottom; see [Repositories and workspaces](/en/user/repos-workspaces#bind-a-repository).
4. Fill in 「名称」 (Name), up to 60 characters, and turn on 「公开频道」 (Public channel) if you want.
5. Click 「创建群」 (Create group) or 「开始私聊」 (Start chat).

**Whether you get a group or a direct chat** depends on what you picked:

- Exactly one Bot of your own (or shared with you) and no members: a direct chat is created. The button reads 「开始私聊」 (Start chat), with the hint 「将创建与它的私聊，之后不能再加人」 ("This starts a direct chat with it; no one else can be added later"). A direct chat doesn't need a name.
- Anything else is a group: the button reads 「创建群」 (Create group), and a name is required.

When creating a group:

- You automatically become a group admin.
- When you add someone else's Bot, the Bot owner automatically joins the group (labeled 「Bot 主人」 (Bot owner)).
- Bots that aren't bound to a machine or are pending confirmation can't be added; they show 「待绑定，暂不能拉入」 ("Pending binding; can't be added yet") or 「待确认，暂不能拉入」 ("Pending confirmation; can't be added yet").
- If you chose a repository but didn't change the name, the name is taken from the repository.
- While the repository is being checked, the button shows 「检查中…」 (Checking…); if the base branch doesn't exist, you can't create the group.

::: tip Create from a Feishu chat
Once a sysadmin has connected Feishu, 「从飞书群创建…」 (Create from Feishu chat…) appears at the bottom of the dialog. It creates a matching group from an existing Feishu chat, or links the chat to a group you administer; see [Feishu](/en/admin/feishu).
:::

### About direct chats

- You can't add other members to a direct chat, and you can't add other people's Bots.
- In a direct chat with only one Bot, you don't need to @ it; any message you send triggers it.
- A direct chat shows the Bot's name by default; you can change 「私聊名称」 (Chat name) under 「私聊设置 → 基本信息」 (Chat settings → General).
- In a direct chat with a Bot someone shared with you, the title shows 「某某 共享的 Bot」 ("Bot shared by X"). The Bot works in a separate managed workspace and doesn't touch its owner's directories. If the sharing is withdrawn or the Bot is deleted, the direct chat becomes read-only.

## Conversation list

The conversation list on the left is divided into 「星标」 (Star), 「频道」 (Channels), and 「私信」 (Direct messages) sections, and you can create your own sections. **Right-click** a conversation (long-press on touch screens) to open its menu:

| Menu item | What it does |
| --- | --- |
| 加星标 / 取消星标 (Star / Unstar) | Adds it to or removes it from the 「星标」 (Star) section |
| 移到分区 (Move to section) | Files it under a section you created, or 「新建分区…」 (New section…) |
| 归入团队分区 (File under team section) | A group admin or team admin files the group under a team section (see below) |
| 通知 (Notifications) | This conversation's alert level: 「全部」 (All), 「仅@」 (Mentions only), 「关闭」 (Off); see [Notifications](/en/user/notifications#per-conversation-notification-levels) |
| 清除未读 (Mark as read) | Marks this conversation as read |
| 完成 / 移回列表 (Done / Move back to list) | Moves a conversation you've dealt with into 「已完成」 (Completed) at the bottom |
| 标记 / 取消标记 (Flag / Unflag) | Adds a flag, so you can later use 「只看已标记」 (Flagged only) |
| 打开群信息 / 私聊设置 (Open group info / Chat settings) | Opens the group settings sidebar on the right |
| 复制频道链接、离开频道 (Copy channel link, Leave channel) | Groups only |

- You can drag conversations straight into a section. The menu next to a section title has 「重命名…」 (Rename…), 「新建子分区…」 (New subsection…), 「上移」 (Move up), 「下移」 (Move down), and 「删除分区」 (Delete section), up to three levels deep. When a section is deleted, its conversations go back to the default sections.
- The top of the list also has three entries: 「话题」 (Thread), 「全部未读」 (All unreads), and 「稍后处理」 (Later); see [Scheduled tasks and threads](/en/user/schedules-threads#threads) and [Notifications](/en/user/notifications#unread).

## Public channels and join requests

### Public channels

There are two kinds of group:

| Type | Who can get in |
| --- | --- |
| 公开频道 (Public channel, `#` before the name) | Team members can find it in 「浏览频道」 (Browse channels) and join on their own |
| 私有群 (Private group, lock before the name) | Only by being added by a member; once filed under a team section, others can request to join |

Turn on 「公开频道」 (Public channel) when creating the group, or a group admin turns it on under 「群设置 → 成员」 (Group settings → Members).

Click 「浏览频道」 (Browse channels) at the top of the conversation list to search by name, filter by 「全部」 (All), 「已加入」 (Joined), or 「未加入」 (Not joined), and sort by 「最近活跃」 (Last active), 「人数最多」 (Most members), or 「名称」 (Name). Click 「加入」 (Join) on one you haven't joined to enter the group.

### Team sections and join requests

Team admins can create a team section from 「新建分区」 (New section) → 「团队分区…」 (Team section…) at the bottom of the conversation list; every team member sees it. Group admins can file a group there under 「群设置 → 成员 → 团队分区」 (Group settings → Members → Team section) or with 「归入团队分区」 (File under team section) in the right-click menu.

Groups in a team section that you haven't joined show 「未加入」 (Not joined); opening one shows a join preview:

- Public channel: click 「加入」 (Join) to enter the group directly.
- Private group: optionally fill in 「申请说明」 (Note), then click 「申请加入」 (Ask to join) and wait for a group admin to handle it; until then you can 「撤回申请」 (Withdraw request).

Group admins get a 「待处理入群申请」 (Join request to review) notification, and can also 「同意」 (Approve) or 「拒绝」 (Deny) under 「入群申请」 (Join requests) at the bottom of 「群设置 → 成员」 (Group settings → Members).

## Group settings sidebar

Click the 「群设置」 (Group settings) button in the group header to open the 「群设置」 sidebar on the right (「私聊设置」 (Chat settings) in a direct chat). Click the members button in the group header to go straight to the 「群成员」 (Members) page.

![Group settings sidebar](/screenshots/web/group-info.webp)

From top to bottom, the sidebar contains:

- **Group name and tags**: labeled 「公开频道」 (Public channel) or 「私有群」 (Private group), plus the sync mode; below are the repository URL and base branch, or 「未绑定仓库 · 各 Bot 使用本机目录」 ("No repo · each Bot uses a local folder") when none is bound.
- **Quick buttons**: 「成员」 (Members), 「公告」 (Notice, group admins only), 「设置」 (Settings).
- **Member avatars**: you can add members here.
- **Bot**, **预览与服务** (Previews & services), **定时任务** (Scheduled tasks), **知识库** (Wiki), **群公告** (Group notice): click to open the matching subpage. For scheduled tasks and the wiki, see [Scheduled tasks and threads](/en/user/schedules-threads) and [Wiki and secrets](/en/user/knowledge-secrets); for previews, see [Previews](/en/user/previews).
- **Personal settings** (affect only you):

| Setting | Description |
| --- | --- |
| 通知 (Notifications) | 「全部」 (All), 「仅@」 (Mentions only), 「关闭」 (Off); see [Notifications](/en/user/notifications#per-conversation-notification-levels) |
| 星标 (Star) | Puts it in the 「星标」 (Star) section of the conversation list |
| 运行卡片默认折叠 (Collapse run cards by default) | Affects only you; approval and question cards are always expanded |

- **Group management**: 「基本信息」 (General), 「成员」 (Members), 「仓库与同步」 (Repos & sync), 「群级参数」 (Group parameters), 「MCP」, 「Skill」, 「密钥」 (Secrets), 「飞书」 (Feishu); click one to open the group settings dialog. Non-admins see 「仅群管理员 · 某某」 ("Group admins only · X"), and the dialog opens read-only.
- At the bottom: 「退出群」 (Leave group) and 「解散群」 (Dissolve group) (「删除私聊」 (Delete chat) in a direct chat).

## Group settings dialog

The group settings dialog has tab navigation on the left. Group admins can make changes; members can open it to look, with 「仅群管理员可修改」 (Only group admins can make changes) at the bottom, and can only fill in their own values on the 「密钥」 (Secrets) tab.

![Group settings](/screenshots/web/group-settings.webp)

| Tab | Contents |
| --- | --- |
| 基本信息 (General) | Group name, group avatar, reply style, Bot replies in threads, group admins |
| 成员 (Members) | Only admins can invite, public channel, team section, join requests |
| Bot | The Bots in the group, same as the Bot page in the sidebar |
| 仓库与同步 (Repos & sync) | Repositories, push rules, sync mode; see [Repositories and workspaces](/en/user/repos-workspaces) |
| 群级参数 (Group parameters) | Approval, relay, and offline-wait parameters (「参数」 (Parameters) in a direct chat) |
| MCP / Skill | MCP servers and Skills that apply only to this group; when a name matches one at the team or platform level, the group level wins |
| 密钥 (Secrets) | Group-level secrets; see [Wiki and secrets](/en/user/knowledge-secrets#secrets) |
| 飞书 (Feishu) | Link a Feishu chat, set syncing per direction, and see the Feishu status of the group's Bots (visible to group admins only); see [Feishu](/en/admin/feishu) |
| 插件 (Plugins) | Appears when plugins are enabled for the system; see [Skill market and plugins](/en/user/market-plugins) |

A direct chat has only 「基本信息」 (General), 「Bot」, 「仓库与同步」 (Repos & sync), and 「参数」 (Parameters), plus 「插件」 (Plugins) when plugins are enabled.

### General

| Setting | Description |
| --- | --- |
| 群名称 (Group name) | Up to 60 characters; click 「保存」 (Save) after changing it |
| 群头像 (Group avatar) | You can upload one; if none is uploaded, it's composed from members' avatars |
| 回复风格 (Reply style) | 「技术」 (Technical) or 「业务」 (Business). 「业务」 makes Bots lead with the conclusion in plain language, without table names, code, or SQL, and put the supporting details at the end |
| Bot 回复进话题 (Bot replies in threads) | When on, @-mentioning a Bot in the group puts its reply in that message's thread instead of flooding the group; see [Threads](/en/user/schedules-threads#threads) |

### Group parameters

Group parameters override the system defaults. Click 「保存」 (Save) after making changes; they apply to new sessions.

| Parameter | Range | Default | Description |
| --- | --- | --- | --- |
| 权限审批等待（分钟） (Approval wait, minutes) | 1–1440 | 30 | If an approval request isn't handled within this time, it's automatically rejected; see [Approvals and questions](/en/user/approvals) |
| 接力链长上限（跳） (Max relay chain length, hops) | 1–10 | 3 | The maximum number of hops in a relay between Bots (including a Bot opening a thread to assign another Bot) |
| Bot 离线等待上线（分钟） (Wait for offline Bot, minutes) | 1–1440 | 30 | When a Bot is offline, the longest a request waits for it to come online; on timeout the request is voided and the requester is notified |

Defaults come from system parameters; see [System parameters](/en/admin/params). A Bot's concurrency limit and trigger scope are the Bot's own settings, not set per group.

## Members and group admins

A group has two roles: **group admin** and **member**. The creator is the first group admin, and a group can have multiple group admins.

Click 「成员」 (Members) in the sidebar to open the 「群成员」 (Members) page:

- You can search members (pinyin supported). Each member is shown with whether they're a 「群管理员」 (Group admin) and which Bots they brought in (「带入 某某」 ("Brought X") or 「未带入 Bot」 ("No Bots brought")).
- 「添加成员」 (Add member) lets you pick several people at once.
- Group admins can 「设为管理员」 (Make admin), 「取消管理员」 (Remove admin), or 「移出」 (Remove) other members.

| Action | Who can do it |
| --- | --- |
| Add members | Any member (only group admins once 「仅群管理员可拉人」 (Only admins can invite) is on) |
| Add your own Bots | Any member |
| Add someone else's Bot, remove Bots | Group admin |
| Remove members, make or remove admins | Group admin |
| Change the group name or avatar, post or remove the notice | Group admin |
| Bind or change repositories, change group parameters and other group settings | Group admin |
| Dissolve the group | Group admin |
| Set a Bot's approval mode in this group, change a Bot's workspace | Bot owner |
| Leave the group | Any member |

::: warning
- When you remove a member, their Bots are removed from the group as well, and turns in progress are treated as non-voluntary interruptions.
- The only group admin can't be removed or demoted; make someone else a group admin first.
:::

::: tip Team admins viewing a group
When a team admin opens a group they're not in, it's 「只读查看」 (Read-only): they can't post or manage, but can click 「进群并成为管理员」 (Join as group admin) to join.
:::

## Bots in a group

Click 「Bot」 in the sidebar to open the Bot page, which shows 「N 个 · 在线 M」 ("N · M online").

- Click 「拉入 Bot」 (Add Bot) to add one: members can add only their own Bots; group admins can add any Bot in the team. If a candidate Bot's owner isn't in the group, it's labeled 「主人将一并加入」 ("owner joins too").
- Each Bot shows its machine's workspace status, approval mode (labeled 「本群」 (This group) when set specifically for this group), and trigger scope.
- 「工作区…」 (Workspaces…) shows every directory this Bot uses in the group; the Bot owner can change them there; see [Repositories and workspaces](/en/user/repos-workspaces#each-bot-s-workspace).
- Under 「本群审批方式」 (Approval in this group) in the 「…」 menu, the Bot owner can choose an approval mode just for this group, or 「跟随全局」 (Follow global). Changes take effect immediately on turns in progress; when this group is set to 「完全允许」 (Allow everything), only the specified list can trigger the Bot. 「全局设置」 (Global settings) opens the Bot's own settings; see [Bot settings and permissions](/en/user/bot-settings).
- Group admins can 「移出」 (Remove) a Bot. Its workspace is kept and the owner decides whether to delete it; turns in progress are treated as non-voluntary interruptions.
- When a Bot is stuck (no workspace chosen, waiting for the owner, or can't reach the repository), the top of the page shows 「N 个 Bot 需要处理」 ("N Bots need attention").

## Group notice

Group admins click 「公告」 (Notice) in the sidebar, edit it in 「群公告 · 置顶展示在对话顶部」 (Group notice · pinned atop the chat), up to 500 characters, and click 「保存」 (Save).

Once posted, the notice is pinned at the top of the group's messages and visible to all members; when hidden, its first line shows below the title in the group header.

| Action | Who | Effect |
| --- | --- | --- |
| 不再显示 (Don't show again) | Any member | Hidden only for you; you can turn 「在对话顶部显示」 (Show atop the chat) back on from the 「群公告」 (Group notice) page |
| 移除 (Remove) | Group admin | No member sees it anymore; it can still be viewed in the history on the 「群公告」 page |
| 发布新公告 (Post a new notice) | Group admin | Replaces the old notice, which stays in the history; members who had hidden it see it again |

The 「群公告」 (Group notice) page in the sidebar shows the notice history, with the current one labeled 「当前」 (Current).

## Group tab bar

You can pin tabs to the top of a group; all members can see and open them. Any member can add one, up to 30 per group. Tab types:

| Type | Contents |
| --- | --- |
| 链接 (Link) | A URL |
| 知识库 (Wiki) | A wiki entry |
| 文件 (Files) | A file in a Bot's workspace, given as a relative path such as `docs/需求.md` |
| 入口 (Shortcut) | The group notice, pinned messages, scheduled tasks, or a Bot's Git log |

## Leave, dissolve, and delete

These actions are at the bottom of the sidebar. The first click turns the button into a confirmation state with an explanation; **click again** to carry it out.

**Leave group** (any member): click 「退出群」 (Leave group), then 「确认退出」 (Confirm leave). Your Bots are removed from the group as well. You can also use 「离开频道」 (Leave channel) in the conversation list's right-click menu.

- If you're the only group admin, you can't leave; make someone else a group admin in 「群成员」 (Members) first.
- You can rejoin a public channel later from 「浏览频道」 (Browse channels); a private group needs a member to invite you again.

**Dissolve group** (group admin): click 「解散群」 (Dissolve group), then 「确认解散」 (Confirm dissolve).

- The group is archived, turns in progress stop, and messages and the audit log are kept.
- Each Bot's managed workspace stays on its machine, and the owner decides whether to delete it; see [Workspace cleanup](/en/user/repos-workspaces#workspace-cleanup).

**Delete direct chat**: click 「删除私聊」 (Delete chat), then 「确认删除」 (Confirm delete). Messages and the audit log are kept, and the Bot's managed workspace stays on its machine.

## Related pages

- [Repositories and workspaces](/en/user/repos-workspaces)
- [Directing Bots in a group](/en/user/chat)
- [Scheduled tasks and threads](/en/user/schedules-threads)
- [Bot settings and permissions](/en/user/bot-settings)
- [Admin console · Bots and groups](/en/admin/bots-groups)
