# Admin console overview

This page explains what the admin console is, who can access it, and what each page manages.

## Who can access it

The admin console is available only to sysadmins (「系统管理员」). When a sysadmin signs in, a 「管理后台」 (Admin console) icon appears in the navigation bar on the far left of the chat window; click it to enter. Members don't see this entry, and visiting `/admin` directly sends them back to the messages page.

::: tip
Members manage their own Bots, machines, and usage in dialogs inside the chat interface (avatar menu → 「绑定新机器」 (Bind new machine), 「我的用量」 (My usage), and so on), with no need to enter the admin console. The console holds only global management and observability features.
:::

On first startup, the server creates the first sysadmin, `admin`, using `GONGGONG_ADMIN_PASSWORD`; see [Deploy from source](/en/deploy/install#first-admin). After that, you can make other members sysadmins in 「账号与角色」 (Accounts & roles).

## Pages at a glance

The console's left navigation has three groups. 「返回消息」 (Back to messages) at the bottom returns you to the chat interface.

| Group | Page | Purpose |
| --- | --- | --- |
| 管理 (Manage) | [账号与角色 (Accounts & roles)](/en/admin/users) | Create accounts, assign roles, reset passwords, deactivate and reactivate |
| 管理 (Manage) | [Bot](/en/admin/bots-groups#bot) | View every Bot's owner, binding, and status; create a Bot for any member |
| 管理 (Manage) | [群 (Groups)](/en/admin/bots-groups#groups) | View every group's mode, repository, member count, and archive status |
| 配置 (Configure) | [配置中心 (Configuration center)](/en/admin/config) | Layer server-global configuration on top of the repository baseline (currently MCP) |
| 配置 (Configure) | [系统参数 (System parameters)](/en/admin/params) | Self-registration toggle and global defaults |
| 配置 (Configure) | [客户端发布 (Client releases)](/en/admin/releases) | Upload new daemon and gg-cast versions; member machines upgrade automatically |
| 观测 (Observe) | [机器 (Machines)](/en/admin/machines) | OS, hardware, daemon version, online status, and network quality of every machine; revoke machines |
| 观测 (Observe) | [用量 (Usage)](/en/admin/usage) | Token usage summarized by Bot, requester, and group |
| 观测 (Observe) | [公开链接 (Public links)](/en/admin/shares) | All public links to previews; extend or revoke them |
| 观测 (Observe) | [审计记录 (Audit log)](/en/admin/audit) | Approvals, questions, admin actions, and more, kept permanently |

Each page has a toolbar at the top (title, count, action buttons, search box, and account menu), followed by a line of gray text describing what the page is for.

## Related pages

- [Accounts & roles](/en/admin/users)
- [Deployment overview](/en/deploy/)
- [Security model](/en/deploy/security)
