# Login and account

This page explains how to log in to Gonggong Space (with a username and password, or Feishu), change your password on first login, sign up yourself, use the avatar menu, and manage your profile and Git preferences in 「设置」 (Settings).

## Log in

![Login page](/screenshots/web/login.webp)

1. Open the URL your admin gave you to reach the login page.
2. Fill in 「账号」 (Account) and 「密码」 (Password), then click 「登录」 (Log in).
3. After logging in you land on the main interface. If you haven't joined any group yet, you'll see the welcome page — see [Interface tour](/en/user/interface#welcome-page).

A few details about the login page:

- With 「记住我」 (Remember me) checked, the login page pre-fills your account next time (only the account, never the password).
- The sun / moon button in the top-right corner toggles between light and dark themes; it's the same setting as the theme in 「设置 → 外观」 (Settings → Appearance).
- If you opened a link to a specific page (such as a group link someone sent you), you're taken back to that page after logging in.
- You stay logged in for 30 days without having to log in again.

::: warning Login failures
- After 5 wrong passwords in a row for the same account, you'll see 「登录失败次数过多，请稍后再试」 ("Too many failed sign-ins, try again later") and must wait about 5 minutes before trying again.
- 「账号已停用，请联系系统管理员」 ("This account is disabled; contact the system admin") means an admin has disabled your account.
:::

### Forgot password

Clicking 「忘记密码？」 (Forgot password?) on the login page tells you to contact a sysadmin to reset your password. After the reset, the admin gives you a temporary password; log in with it and change it to your own as prompted. For the admin side, see [Accounts and roles](/en/admin/users).

## Change your password on first login

When an admin creates your account, the initial password is set by the admin. The first time you log in with it, you're asked to change your password before reaching the main interface.

![Change password on first login](/screenshots/web/change-password.webp)

1. In 「初始密码」 (Initial password), enter the password the admin gave you.
2. In 「新密码」 (New password), enter your own password; the strength bar below shows how strong it is (mixing letters, digits, and symbols is recommended).
3. Enter it again in 「确认新密码」 (Confirm new password).
4. Once all three rules are checked, click 「修改密码」 (Change password).

The new password must:

- Be at least 8 characters;
- Differ from the old password;
- Match in both fields.

After a successful change you go straight to the main interface, and logins on other devices are signed out. If you don't want to change it right now, click 「退出登录」 (Log out) at the bottom of the page.

## Feishu login

When an admin enables Feishu login, a 「飞书登录」 (Sign in with Feishu) button appears below 「登录」 (Log in) on the login page.

- The first time you log in with Feishu, if that Feishu identity isn't linked to a Gonggong Space account yet, you go to the 「飞书登录」 (Sign in with Feishu) page: enter your existing 「账号」 (Account) and 「密码」 (Password) and click 「绑定并登录」 (Link and sign in). If allowed, you can also click 「新建账号」 (Create account).
- Opening a Gonggong Space link inside the Feishu client logs you in with your Feishu identity automatically, with no button to click.
- Once logged in, you can also link or unlink Feishu in 「设置 → 账户」 (Settings → Account) — see below.

For admin configuration, see [Feishu](/en/admin/feishu).

## Self sign-up

Sign-up is closed by default; accounts are created by admins. When an admin turns on 「开放自助注册」 (Allow self sign-up) in 「管理后台 → 系统参数」 (Admin console → System parameters), the bottom of the login page shows 「还没有账号？立即注册」 (No account yet? Sign up); when it's off, it shows 「还没有账号？请联系系统管理员开通」 ("No account yet? Ask a system admin to create one").

![Sign-up page](/screenshots/web/register.webp)

When signing up, fill in:

| Field | Requirements |
| --- | --- |
| 账号 (Account) | Used to log in; 2–32 lowercase letters, digits, or `.` `_` `-`, e.g. `wanglei` |
| 姓名 (Name) | The name shown in groups |
| 密码 (Password) | At least 8 characters |
| 确认密码 (Confirm password) | Must match the password |

Click 「注册并进入」 (Sign up and continue) to finish signing up and log in automatically. Self-registered accounts are 「普通成员」 (Member) and don't need to change their password. If the account name is taken, you'll see 「账号已存在」 ("This account already exists"); frequent sign-ups from the same network are rate-limited (5 per hour).

::: tip Team invite links
If a team admin sends you an invite link, you can sign up through it even when self sign-up isn't open, and you join that team automatically after signing up.
:::

## Avatar menu

Your avatar is at the very bottom of the left navigation bar (on narrow screens, at the right of the bottom tab bar). Click it to open the menu:

![Avatar menu](/screenshots/web/account-menu.webp)

| Menu item | What it does |
| --- | --- |
| Top | Your name, role (sysadmin / member), and account |
| 暂停通知 (Pause notifications) | Pause for 30 minutes, 1 hour, 2 hours, until 9 AM tomorrow, or a custom time; while paused it shows 「恢复通知（已暂停到 …）」 (Resume notifications (paused until …)) — see [Notifications](/en/user/notifications) |
| 绑定新机器 (Bind new machine) | Bind your machine to your account — see [Bind a machine](/en/user/bind-machine). Members who haven't set up a Bot yet see 「接入我的电脑」 (Connect my computer) here; after clicking it, 「机器与 Bot」 (Machines & Bots) and 「市场」 (Market) also appear in the navigation bar |
| 我的用量 (My usage) | Your Bots' usage over the last 30 days |
| 新手指引 (Getting started) | Reopens the three-step getting-started guide: your groups and the Bots you can @, try asking a question, and how to use it in Feishu |
| 团队设置 / 邀请成员 (Team settings / Invite members) | Only shown when you're in exactly one team; inviting members requires team admin rights |
| 设置… (Settings…) | Opens personal settings |
| 退出登录 (Log out) | Logs out of the current account |

## Personal settings

Click 「设置…」 (Settings…) in the avatar menu. The left side has these pages:

| Page | Contents |
| --- | --- |
| 外观 (Appearance) | Language, theme, glass effect — see [Appearance and themes](/en/user/appearance) |
| 通知 (Notifications) | Notification preferences — see [Notifications](/en/user/notifications) |
| Git 与仓库 (Git & repos) | Connect GitHub / GitLab accounts, clone protocol preference — see below |
| 我的密钥 (My secrets) | Secrets that belong only to you — see [Knowledge base and secrets](/en/user/knowledge-secrets) |
| 我的 Skill (My Skills) | Skills that apply only in runs you start — see [Skill market and plugins](/en/user/market-plugins) |
| 账户 (Account) | Avatar, display name, email, password, Feishu — see below |

### Account

![Settings · Account](/screenshots/web/settings-account.webp)

- **Avatar**: upload an image and crop it, or remove it to go back to the avatar generated from your name. If Feishu is linked, you can click 「使用飞书头像」 (Use Feishu avatar).
- **Display name**: click 「修改显示名…」 (Change display name…), up to 40 characters. The display name is used in group member lists and messages. After you rename, your groups and your Bots show the new name.
- **Email**: click 「修改邮箱…」 (Change email…); leave it empty to clear it.
- **Password**: click 「修改密码…」 (Change password…), fill in 「当前密码」 (Current password), 「新密码」 (New password), and 「确认新密码」 (Confirm new password), then click 「保存新密码」 (Save new password). The rules are the same as for the first-login change.
- **Feishu**: click 「绑定飞书」 (Link Feishu) to link your Feishu identity. Once linked, you can log in with Feishu in one click and @ Bots in Feishu groups. Click 「解绑」 (Unlink) to remove it.

::: tip
After you change your password, logins on other devices are signed out immediately; the current browser stays logged in.
:::

### Git and repositories

- **Connected accounts**: click 「添加账号…」 (Add account…) to connect GitHub or GitLab (enter the instance URL and a read-only token; the dialog has 「如何获取 Token」 (How to get a token) steps and a button that goes straight to the token creation page). Once connected, you can search for and pick your repositories and branches directly when creating a group. The token is only used to list repositories and branches; it's stored encrypted on the server and not used for cloning. If an account becomes invalid, it shows 「需要重新连接」 (Needs reconnecting); click 「断开」 (Disconnect) and add it again. See [Repositories and workspaces](/en/user/repos-workspaces).
- **Protocol preference**: the protocol your Bots try first when cloning or checking a repository. Options are 「按仓库地址」 (Match repo URL, the default), 「优先 SSH」 (Prefer SSH), and 「优先 HTTPS」 (Prefer HTTPS); the other protocol is used as the fallback.

The SSH keys and tokens Bots use to clone and push private repositories on the machine aren't here; they're in 「Git 访问」 (Git access) on the machine page — see [My machines and Bots](/en/user/machines#git-access).

![Settings · Git & repos](/screenshots/web/settings-git.webp)

## Log out

Click 「退出登录」 (Log out) in the avatar menu. Logging out ends this login session and stops the current browser from receiving push notifications for this account.

## Related pages

- [Interface tour](/en/user/interface)
- [Bind a machine](/en/user/bind-machine)
- [Notifications](/en/user/notifications)
- [Appearance and themes](/en/user/appearance)
- [Admin console · Accounts and roles](/en/admin/users)
