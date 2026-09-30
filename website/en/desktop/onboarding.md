# First-run setup

This page walks through binding the desktop app the first time you open it: give the desktop app a connect link, check the server and certificate, and click 「绑定」 (Bind).

If this machine isn't bound yet, the desktop app opens straight to the 「绑定到团队服务器」 (Bind to team server) page.

![First-run setup](/screenshots/desktop/onboarding.webp)

## Step 1: Generate a connect link on the web

1. Sign in to the Gonggong Space web app in your browser.
2. Click your avatar in the top-right corner → 「绑定新机器」 (Bind new machine). The web app generates a one-time connect link and shows a countdown.
3. Choose one:
   - Click 「在客户端中打开」 (Open in client): the browser launches the desktop app and fills in the link automatically.
   - Click 「复制接入链接」 (Copy connect link): switch back to the desktop app and paste it into the 「接入链接」 (Connect link) field.

For details on the web dialog, see [Bind a machine](/en/user/bind-machine).

::: tip Auto-fill
When the setup page opens, and every time you switch from the browser back to the desktop app window, the desktop app reads the clipboard if the field is empty. If the clipboard contains a valid connect link or `gg login` command, it's filled in automatically.
:::

## Step 2: Paste and check

The 「接入链接」 (Connect link) field accepts any of the following (leading/trailing spaces and quotes are ignored):

- A connect link, like `gonggong://bind?server=…&code=…`
- The command copied under 「使用命令行」 (Use the command line) on the web, e.g. `gg login 'gonggong://bind?…'` or `gg login --server https://gg.example.com --code K7QM-4X2P`

Once recognized, the parsed result is listed below:

| Item | Description |
| --- | --- |
| 服务器 (Server) | The address of the team server to bind to |
| 绑定码 (Bind code) | One-time bind code in the format `XXXX-XXXX` |
| 证书 (Certificate) | Shown only when the link includes a certificate fingerprint; displays 「已固定证书指纹」 ("certificate fingerprint pinned") and the fingerprint value |

If the content can't be recognized, the reason appears below the field, e.g. 「绑定码格式错误，应为 XXXX-XXXX」 ("invalid bind code format, should be XXXX-XXXX") or 「只允许通过 https:// 连接非本机服务器」 ("non-local servers can only be reached over https://").

Make sure this is your team's server, then click 「绑定」 (Bind). **The desktop app never binds automatically**: even when launched from a link, you must click Bind yourself.

## Certificate fingerprint

When the server uses HTTPS, the desktop app pins the server certificate and from then on trusts only that certificate:

- The link includes a fingerprint (the 证书 row shows 「已固定证书指纹」): binding succeeds only if the certificate the server presents matches the fingerprint; otherwise it fails with an error.
- The link has no fingerprint: binding trusts the certificate the server currently presents and records it. If your admin has published a fingerprint, after binding check that the 「服务器连接」 (Server connection) item in 「日志与诊断」 (Logs & Diagnostics) is OK, and contact your admin if in doubt.

::: warning Non-local servers require HTTPS
For security, servers can only be reached over `https://`, except for local addresses such as `localhost` / `127.0.0.1`. For self-signed certificates, see [HTTPS and certificates](/en/deploy/https).
:::

## Step 3: Done

After you click Bind, the desktop app exchanges the bind code for this machine's long-lived credentials and starts the daemon. On success:

- You land on the main window, with 「已连接 服务器地址」 ("Connected &lt;server address&gt;") shown in the top-right corner.
- On macOS, if Screen Recording and Accessibility aren't granted yet, the 「授予系统权限」 (Grant system permissions) page opens next. These two only affect live views and remote control, so you can click 「稍后」 (Later) for now. See [Permissions and system settings](/en/desktop/permissions).
- Back on the web, the 「绑定新机器」 dialog shows that binding is complete. You can now [create a Bot](/en/user/create-bot) and assign it to this machine.

## FAQ

**What if the bind code has expired?**
A connect link is valid for one use only. Once it expires, generate a new one on the web.

**Opening a connect link says 「本机已绑定到 …，请先在设置中解绑」 ("This machine is already bound to …; unbind it in Settings first")?**
This machine is already bound. To rebind it to a different server or account, click 「解除绑定…」 (Unbind…) in 「设置」 (Settings) first, then open the link again.

**Already bound with `gg login`?**
The desktop app and the command line share the same binding information, so opening the desktop app takes you straight to the main window without first-run setup.

## Related pages

- [Desktop app overview and installation](/en/desktop/)
- [Pages](/en/desktop/pages)
- [Bind a machine](/en/user/bind-machine)
- [HTTPS and certificates](/en/deploy/https)
