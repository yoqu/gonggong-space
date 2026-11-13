# System parameters

This page lists every item on the 「系统参数」 (System parameters) page: what it means, its default, and its allowed range.

![Admin console · System parameters](/screenshots/web/admin-params.webp)

## How it works

The top half of the page holds switches (accounts, teams, plugins, demo); the bottom half holds numeric parameters.

- **Switches take effect immediately**; there's no need to save. The result is shown in the top-right corner after you toggle one.
- **Numeric parameters** are arranged in groups, each with a number stepper on the right and the unit after it. When you change one, a dot appears in front of it and a save bar showing 「已修改 N 项」 ("N changes") appears at the bottom of the page; click 「保存」 (Save) to submit or 「放弃」 (Discard) to revert. The browser warns you if you leave the page with unsaved changes. Values outside the allowed range are rejected on save.
- Once saved, changes apply immediately to new requests (except 「机器心跳间隔」 (Machine heartbeat interval); see below) and are written to the [audit log](/en/admin/audit) with each item's old and new value.

These are **platform defaults**. Team admins can override some parameters for their team under 「团队设置 → 参数」 (Team settings → Parameters) (the "Team can override" column below); for the three items marked 「群默认」 ("group default"), group admins can further adjust them for their group in group settings. Teams and groups that haven't adjusted a value inherit it from the layer above.

「飞书自动开户」 (Feishu auto sign-up) and 「对外地址」 (Public URL) are set on the [Feishu](/en/admin/feishu) page.

## Accounts

| Switch | Default | Description |
| --- | --- | --- |
| 开放自助注册 (Allow self sign-up) | Off | When on, the login page shows a sign-up entry and new accounts become members. When off, accounts can only be [created by an admin](/en/admin/users#create-an-account) or registered through a team invite link. At most 5 accounts can be registered per IP per hour |

## Teams

| Switch | Default | Description |
| --- | --- | --- |
| 单团队模式 (Single-team mode) | On | When on, the team switcher is hidden and new accounts join the only team automatically. Can be turned on only when there is exactly one unarchived team |
| 建团队权限 (Who can create teams) | 仅系统管理员 (System admins only) | 「所有人」 (Everyone) or 「仅系统管理员」 (System admins only). In single-team mode, nobody can create teams |

If self sign-up is on, single-team mode is off, and team creation is limited to 「仅系统管理员」 (System admins only), the page warns you that self-registered accounts can't create teams and must join one through an invite link.

## Plugins

| Switch | Default | Description |
| --- | --- | --- |
| 插件 (Plugins) | Off | Master switch for the plugin system. When on, group admins can enable plugins in group settings, and group members use them through 「创作」 (Create) in the input box. When off, no plugin entry points are shown and no plugins are sent to machines; uploaded plugins are kept |
| 插件代码 (Plugin code) | Off | Allows plugins to run code on the executing machine, such as a local MCP server. Even when on, the machine owner must still authorize each plugin version on their own machine |

The 「管理插件」 (Manage plugins) button in the 「平台插件」 (Platform plugins) row opens [Configuration center · Plugins](/en/admin/config#plugins): built-in plugins are installed automatically with the server, and you can also upload your own, visible to all teams. For using plugins, see [Market and plugins](/en/user/market-plugins).

## Demo

| Switch | Default | Description |
| --- | --- | --- |
| 演示模式 (Demo mode) | Off | Turn on for public demos; see below |

Demo mode prevents content from leaking to the internet through tunnel domains and keeps visitors from damaging the demo environment. When on:

- Previews can be viewed only in the group after signing in; public links can't be created, existing public links stop working immediately, and preview cards aren't synced to Feishu.
- Live views are watch-only; they can't be controlled.
- Bots can't use the 「完全访问」 (Full access) tier; Bots set to Full access run as 「工作区写入」 (Workspace write).
- Except for sysadmins, nobody can change passwords or nicknames, dissolve groups, remove members, delete Bots, revoke machines, or archive teams.

## Runs and sessions

| Parameter | Default | Range | Team can override | Description |
| --- | --- | --- | --- | --- |
| 会话恢复失败时补送的群聊上下文（token 上限） (Group chat context replayed when a session cannot resume (max tokens)) | 16000 tokens | 1000–100000 | Yes | When a Bot resumes an earlier session, recent group messages (up to this total) are prepared alongside; if the session can't be resumed, they're given to the new session. The Bot can read older messages itself through built-in tools |
| 每轮随消息附带的群聊上下文（token 上限） (Group chat context sent with each turn (max tokens)) | 8000 tokens | 1000–100000 | Yes | Cap on the total group messages sent to the Bot with the @ message each turn (new messages since that Bot's last run, taken from newest to oldest, tokens estimated from character count, no limit on message count) |
| Bot 闲置后下次对话自动开新会话 (Start a new bot session after idle for) | 6 hours | 1–720 | No | If a Bot has had no session in a group (or thread) for this long, its next turn starts a new session automatically. Sessions idle this long no longer have a prompt cache, so resuming would reread the whole history at full price |
| 提问卡片每张题数上限 (Max questions per question card) | 4 | 1–4 | Yes | Has no effect in the current version; each question card is fixed at up to 4 questions |

## Attachments

| Parameter | Default | Range | Team can override | Description |
| --- | --- | --- | --- | --- |
| 单个附件大小上限 (Max size of one attachment) | 50 MB | 1–50 | No | Size limit for a single uploaded attachment; also applies to attachments in Feishu messages |
| 每条消息附件数 (Attachments per message) | 10 | 1–10 | Yes | Maximum number of attachments per message |

::: tip
When you change attachment limits, also check the request body size limit of your reverse proxy; see [Reverse proxy](/en/deploy/reverse-proxy).
:::

## Machine connections

| Parameter | Default | Range | Description |
| --- | --- | --- | --- |
| 机器心跳间隔 (Machine heartbeat interval) | 15 seconds | 5–120 | How often the daemon sends a heartbeat to the server. **Read when the server starts; restart the server after changing it**. The environment variable `GONGGONG_HEARTBEAT_SEC` takes precedence over this parameter |
| 机器离线判定（连续未收到心跳） (Machine offline after (missed heartbeats in a row)) | 3 | 2–10 | A machine is considered offline after this many consecutive heartbeat intervals without a heartbeat |

## Data retention

| Parameter | Default | Range | Description |
| --- | --- | --- | --- |
| 完整运行过程保留 (Keep full run details for) | 30 days | 1–3650 | Once a run has ended for longer than this, its full process (thinking, tool calls, output) and diff are deleted; the summary on the run card is kept. The server cleans up once an hour |
| 服务器备份（每日）保留 (Keep daily server backups for) | 7 days | 1–365 | Currently has no effect: the backup script always keeps the latest 7 backups plus the newest backup of each of the last 7 days that have backups; see [Backup and restore](/en/deploy/backup) |
| 删群后存档保留 (Keep archives of deleted groups for) | 30 days | 1–365 | Days to keep a group's archive after it's dissolved; the [Groups](/en/admin/bots-groups#groups) page uses it to show 「归档 · N 天后清除」 ("Archived · purged in N days") |

## Group and Bot defaults

| Parameter | Default | Range | Team can override | Description |
| --- | --- | --- | --- | --- |
| 权限审批等待 · 群默认 (Approval wait · group default) | 30 minutes | 1–1440 | Yes | How long to wait for the Bot owner to approve after a Bot makes a permission request; rejected automatically on timeout. See [Approvals and questions](/en/user/approvals) |
| 接力链长上限 · 群默认 (Max relay length · group default) | 3 hops | 1–10 | Yes | When a Bot @-mentions another Bot in its reply to relay the work, the maximum number of hand-offs in one relay chain |
| Bot 离线时请求等待上线 · 群默认 (Wait for an offline Bot · group default) | 30 minutes | 1–1440 | Yes | When a Bot's machine is offline, how long requests queue waiting for it to come online; after that, the request is dropped and the requester is notified |
| Bot 并发上限 · 新建默认 (Bot concurrency limit · default for new Bots) | 2 | 1–10 | Yes | Initial value of 「并发上限」 (Concurrency limit) for newly created Bots; existing Bots aren't affected |

## Other

| Parameter | Default | Range | Description |
| --- | --- | --- | --- |
| 预览无人访问后自动关闭 (Close previews after no visits for) | 24 hours | 1–720 | A preview nobody has opened for this long is closed automatically, and managed services no other preview uses are stopped; see [Result previews](/en/user/previews) |
| 预览公开链接最长有效期 (Longest validity of a public preview link) | 30 days | 1–365 | The longest validity you can choose when creating a public link; see [Public sharing](/en/user/shares) |

## Related pages

- [Groups and direct chats](/en/user/groups)
- [Feishu](/en/admin/feishu)
- [Audit log](/en/admin/audit)
- [Environment variables](/en/deploy/env)
