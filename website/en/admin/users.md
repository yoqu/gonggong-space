# Accounts and roles

This page explains how sysadmins create accounts, assign roles, and reset passwords on the 「账号与角色」 (Accounts & roles) page, what disabling an account does, and how to manage teams on the 「团队」 (Teams) page.

![Admin console · Accounts & roles](/screenshots/web/admin-users.webp)

## Roles

Gonggong Space has only two account roles:

| Role | What it can do |
| --- | --- |
| 普通成员 (Member) | Sign in to the web app, bind their own machines, create Bots for themselves, create groups and direct chats, and direct Bots in groups; can see and modify only their own Bots and machines |
| 系统管理员 (System admin) | Everything a member can do, plus access to the admin console: manage accounts and teams, create or modify Bots for any member, view all groups and machines, revoke machines, and use the configuration center, system parameters, Feishu, client releases, site-wide stats, public links, and the audit log |

::: warning What even sysadmins can't change
A Bot's 「审批方式」 (Approval) setting (「每次问我」 (Ask me every time) / 「帮我审批」 (Review for me) / 「完全允许」 (Allow everything)) and its allow rules, its Git commit identity, and its Agent settings can be changed only by the Bot owner, not by sysadmins. Likewise, a machine's Agent tools, providers, Git access, and plugin permissions can be managed only by the machine owner. This prevents admins from remotely unlocking command execution on someone else's machine.
:::

Team owner / team admin (「团队所有者 / 团队管理员」) and group admin (「群管理员」) are not account roles but roles within a team or group, assigned in team settings and group settings respectively; see [Groups and direct chats](/en/user/groups).

## Account list

The toolbar shows 「N 个账号」 ("N accounts"). The table lists every account:

| Column | Description |
| --- | --- |
| 成员 (Member) | Avatar and display name |
| 账号 (Account) | The account name used to sign in |
| 所属团队 (Teams) | The teams this account has joined |
| 角色 (Role) | 系统管理员 (System admin) / 普通成员 (Member) |
| 机器 (Machine) | Number of bound machines and whether they're online, e.g. 「2 台 · 在线」 ("2 · online"); shows 「未绑定」 (Not bound) if none |
| 状态 (Status) | 「正常」 (Active), 「待修改密码」 (Password change pending: hasn't yet signed in with the initial password and changed it), or 「已停用」 (Disabled) |

Use the search box in the top-right corner to filter by name or account. Double-click a row to edit it; the action menu on the right of each row has 「编辑…」 (Edit…), 「重置密码…」 (Reset password…), and 「停用…」 (Disable…) (disabled accounts show 「启用」 (Enable) instead). You can't reset your own password or disable yourself here.

## Create an account

1. Click 「新建账号…」 (New account…) in the toolbar.
2. Fill in:
   - **账号 (Account)**: 2–32 characters of lowercase letters, digits, or `.` `_` `-`, e.g. `wanglei`. It can't be changed after creation.
   - **姓名 (Name)**: the name shown in the interface, e.g. 「王磊」 (Wang Lei).
   - **角色 (Role)**: member or system admin.
   - **初始密码 (Initial password)**: an easy-to-read temporary password (like `k7qm-4x2p-9d`) is generated automatically. Click 「重新生成」 (Regenerate) or type your own; at least 8 characters.
3. Click 「创建」 (Create). The account and initial password are copied to the clipboard together; send them to the person privately.

![The 「新建成员」 (New member) dialog](/screenshots/web/admin-user-new.webp)

On first sign-in, the person must change the initial password before they can enter the system. See [Sign-in and accounts](/en/user/login).

When [single-team mode](/en/admin/params#teams) is on, new accounts automatically join the only team; otherwise a team admin needs to send them an invite link to join a team.

::: tip Self sign-up
If you'd rather not create accounts one by one, turn on 「开放自助注册」 (Allow self sign-up) in [System parameters](/en/admin/params#accounts). The login page then shows a sign-up entry, and every account registered this way is a member. With Feishu connected, you can also use 「飞书自动开户」 (Feishu auto sign-up) so members of your organization get an account created on their first Feishu sign-in; see [Feishu](/en/admin/feishu#accounts).
:::

## Edit an account

In the 「编辑成员」 (Edit member) dialog you can change the **name** and **role**. The account name can't be changed, and you can't change your own role (so the only sysadmin can't demote themselves).

## Reset a password

When a member forgets their password:

1. Choose 「重置密码…」 (Reset password…) from the row's menu.
2. A temporary password is already generated in the dialog; regenerate it or type your own (at least 8 characters).
3. Click 「重置并复制」 (Reset & copy). The temporary password is copied to the clipboard; send it to the person privately.

After the reset:

- All of the person's web sessions are **invalidated immediately**; they must sign in again with the temporary password and change it right away.
- Their bound machines and Bots are **not affected**; the daemon stays online.

## Disable and enable

Choose 「停用…」 (Disable…) from the row's menu. After you confirm, it takes effect immediately:

- All of the member's daemon tokens and web sessions are revoked at once, and the login page shows 「账号已停用，请联系系统管理员」 ("This account is disabled; contact the system admin").
- After its next failed connection, the daemon clears the team secrets and managed workspaces on that machine (best effort, not guaranteed).
- Their Bots are removed from all groups; runs in progress are treated as involuntary interruptions.
- Group messages and audit records are kept.

You can click 「启用」 (Enable) at any time to let a disabled account sign in again, but the machines that were revoked and the Bots that were removed don't come back automatically: the member needs to [bind their machines](/en/user/bind-machine) again and add their Bots back to groups.

::: danger
You can't disable your own account. Before disabling someone, make sure they have no running tasks that need to be kept.
:::

## Teams

The 「团队」 (Teams) page (in the 「管理」 (Admin) group of the left navigation) lists every team. The toolbar shows 「N 个团队」 ("N teams"), and you can search by team name or owner. Sysadmins don't need to be team members; members, invites, the newcomer group, MCP, Skills, plugins, repositories, secrets, parameters, and so on within a team are managed by team admins in 「团队设置」 (Team settings).

| Column | Description |
| --- | --- |
| 团队 (Team) | Team avatar and name |
| 所有者 (Owner) | The team owner |
| 成员 (Members) | Number of members |
| 创建时间 (Created) | Creation date |
| 状态 (Status) | 「正常」 (Active) or 「已归档」 (Archived) |

### Create a team

1. Click 「新建团队…」 (New team…) in the toolbar.
2. Enter a 「团队名称」 (Team name) (up to 40 characters) and pick an account that isn't disabled as 「所有者」 (Owner).
3. Click 「创建」 (Create).

You can't create teams in [single-team mode](/en/admin/params#teams); turn single-team mode off first.

### Set the owner

Choose 「指定所有者…」 (Set owner…) from the row's menu, pick an account, and click 「保存」 (Save). That person becomes the owner (joining the team automatically if they weren't a member), and the previous owner becomes an admin.

### Archive and restore

- **Archive team** (「归档团队」): the team disappears from members' team lists; the team's groups are unbound from their Feishu chats, and runs in progress are stopped. In single-team mode you can't archive the only team.
- **Restore team** (「恢复团队」): restore an archived team from the row's menu. In single-team mode, you can't restore a team while another unarchived team exists.

## Audit

Creating accounts, changing names or roles, resetting passwords, disabling, enabling, self sign-up, as well as creating, archiving, and restoring teams and setting owners, are all written to the [audit log](/en/admin/audit) (type 「管理」 (Admin)).

## Related pages

- [Sign-in and accounts](/en/user/login)
- [System parameters](/en/admin/params)
- [Machines](/en/admin/machines)
- [Security model](/en/deploy/security)
