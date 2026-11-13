# Admin console overview

This page explains what the admin console is, who can access it, and what each page manages.

## Who can access it

The admin console is open only to sysadmins (「系统管理员」, System admin). When a sysadmin signs in, a 「管理后台」 (Admin console) icon appears in the navigation bar on the far left of the chat window; click it to enter. Members don't see this entry, and visiting `/admin` directly sends them back to the messages page. A sysadmin who hasn't joined any team yet can also enter the console from the welcome page.

::: tip
Members manage their own Bots, machines, and usage inside the chat interface (machines in the left sidebar, 「我的用量」 (My usage) in the avatar menu, and so on); see [My machines and Bots](/en/user/machines). Members, invites, MCP, Skills, plugins, secrets, parameters, and so on within a team are managed by team admins in 「团队设置」 (Team settings). The console holds only platform-wide management and observability features.
:::

On first startup, the server creates the first sysadmin, `admin`, using `GONGGONG_ADMIN_PASSWORD`; see [Deploy from source](/en/deploy/install). After that, you can make other members sysadmins in 「账号与角色」 (Accounts & roles).

## Pages at a glance

The console's left navigation has three groups. 「返回消息」 (Back to messages) at the bottom returns you to the chat interface. On narrow screens (such as phones), the navigation becomes horizontally scrollable tabs at the top.

| Group | Page | Purpose |
| --- | --- | --- |
| 管理 (Admin) | [账号与角色 (Accounts & roles)](/en/admin/users) | Create accounts, assign roles, reset passwords, disable and enable accounts |
| 管理 (Admin) | [团队 (Teams)](/en/admin/users#teams) | Owner, member count, and status of every team; create, archive, and restore teams; set the owner |
| 管理 (Admin) | [Bot (Bots)](/en/admin/bots-groups#bots) | Owner, binding, and status of every Bot; create a Bot for any member |
| 管理 (Admin) | [群 (Groups)](/en/admin/bots-groups#groups) | Mode, repository, member count, and archive status of every group |
| 管理 (Admin) | [定时任务 (Scheduled tasks)](/en/admin/bots-groups#scheduled-tasks) | Scheduled tasks of every group and direct chat; disable or delete any of them |
| 配置 (Configuration) | [配置中心 (Configuration)](/en/admin/config) | Platform-layer MCP, Skills, plugins, and secrets, plus the market's 「待审核」 (Pending review) |
| 配置 (Configuration) | [系统参数 (System parameters)](/en/admin/params) | Switches for sign-up, teams, plugins, demo mode, and platform defaults |
| 配置 (Configuration) | [飞书 (Feishu)](/en/admin/feishu) | Feishu main app, public URL, Feishu auto sign-up |
| 配置 (Configuration) | [客户端发布 (Client releases)](/en/admin/releases) | Upload daemon, gg-cast, and desktop installers/update packages |
| 观测 (Observability) | [机器 (Machines)](/en/admin/machines) | OS, hardware, daemon version, online status, and network quality of every machine; revoke machines |
| 观测 (Observability) | [会话统计 (Conversation stats)](/en/admin/usage#conversation-stats) | Overview of conversations, messages, and runs across the site, with details by conversation, member, Bot, and team |
| 观测 (Observability) | [用量 (Usage)](/en/admin/usage) | Token usage summarized by Bot, requester, and group |
| 观测 (Observability) | [公开链接 (Public links)](/en/admin/shares) | All public links to previews; extend or revoke them |
| 观测 (Observability) | [审计记录 (Audit log)](/en/admin/audit) | Approvals, questions, admin actions, and more, kept permanently |

Each page has a toolbar at the top (title, count, action buttons, search box, and account menu), followed by a line of gray text describing what the page is for. The toolbars of 「Bot」, 「群」, 「定时任务」, 「会话统计」, 「用量」, and 「审计记录」 include a team filter, which defaults to 「全部团队」 (All teams).

## Related pages

- [Accounts & roles](/en/admin/users)
- [Deployment overview](/en/deploy/)
- [Security model](/en/deploy/security)
