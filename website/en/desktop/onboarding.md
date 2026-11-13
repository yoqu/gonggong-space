# First-run setup

This page covers the binding flow the first time you open the desktop app: hand the connect link to the desktop app, check the server, and click 「绑定」 (Bind).

If this machine isn't bound yet, the desktop app opens straight to the 「绑定到团队服务器」 (Bind to your team server) page.

![First-run setup](/screenshots/desktop/onboarding.webp)

## Step 1: Get a connect link on the web

1. Sign in to Gonggong Space in your browser and open 「绑定新机器」 (Bind new machine), either from the avatar menu or from 「机器与 Bot」 (Machines & Bots) in the left sidebar.
2. Expand 「其他方式」 (Other ways). If the desktop app is already installed, click 「我已安装」 (Already installed) to skip the download.
3. Under 「② 打开接入链接」 (② Open the connect link), choose one:
   - Click 「在客户端中打开」 (Open in client): the browser launches the desktop app and fills in the connect link automatically.
   - Click 「复制接入链接」 (Copy connect link): switch back to the desktop app and paste it into the 「接入链接」 (Join link) input box.

For the full description of the web dialog, see [Bind a machine](/en/user/bind-machine).

::: tip Auto-fill
When the setup page opens, and every time you switch from the browser back to the desktop app window, the desktop app reads the clipboard if the input box is empty. If the clipboard contains a valid connect link or `gg login` command, it's filled in automatically.
:::

## Step 2: Fill in and check

The 「接入链接」 (Join link) input box accepts any of the following (surrounding spaces and quotes are ignored):

- A connect link, such as `gonggong://bind?server=…&code=…`
- The command copied under 「使用命令行」 (Use the command line) on the web, such as `gg login --server https://gg.example.com --code ABCD-EF23`, or `gg login 'gonggong://bind?…'`

Once recognized, the parsed result is listed below:

| Item | Description |
| --- | --- |
| 服务器 (Server) | Address of the team server to bind to |
| 接入代码 (Connect code) | One-time connect code, format `XXXX-XXXX` |

If the content can't be recognized, the reason appears under the input box, for example 「无法识别：请粘贴接入链接或 gg login 命令」 ("Not recognized: paste a connect link or a gg login command") or 「不是共工空间的接入链接」 ("Not a Gonggong Space connect link").

Make sure this is your team's server, then click 「绑定」 (Bind). **The desktop app never binds automatically.** Even when launched from a link, you must click 「绑定」 yourself.

::: tip Server address and certificate
- Servers other than this machine must use an `https://` address; `http://` is allowed only for local addresses such as `localhost` and `127.0.0.1`.
- If the server uses a trusted certificate, no extra steps are needed. If it uses a self-signed certificate, append `--fingerprint <certificate fingerprint>` to the command (or `&fp=<certificate fingerprint>` to the end of the connect link) before pasting it. See [HTTPS and certificates](/en/deploy/https).
:::

## Step 3: Done

After you click 「绑定」 (Bind), the desktop app exchanges the connect code for this machine's long-term credentials and starts the daemon. When it succeeds:

- The main window opens, with 「已连接 服务器地址」 ("Connected to `<server address>`") in the top-right corner.
- On macOS, if Screen Recording and Accessibility haven't been granted yet, the 「授予系统权限」 (Grant system permissions) page appears next. These two only affect live views and remote control, so you can click 「稍后」 (Later) for now. See [Permissions and system settings](/en/desktop/permissions).
- Back on the web, the 「绑定新机器」 (Bind new machine) dialog shows 「绑定成功」 (Bound) and lists the Agents detected on this machine. Click 「新建 Bot」 (New Bot) to [create a Bot](/en/user/create-bot) on this machine.

## FAQ

**It says 「接入链接已失效（已过期或已被使用），请在 Web 端重新生成」 ("The connect link is no longer valid (expired or already used); generate a new one on the Web")?**
A connect code is valid for 30 minutes and can be used only once. Go back to the web, reopen 「绑定新机器」 (Bind new machine), and bind with a new connect link.

**It says 「接入链接尝试次数过多，已锁定」 ("Too many connect link attempts; it is locked")?**
Generate a new connect link on the web later.

**Opening a connect link says 「本机已绑定到 …，请先在设置中解绑」 ("This machine is already bound to …. Unbind it in Settings first")?**
This machine is already bound. To bind it to a different server or account, first click 「解除绑定…」 (Unbind…) in 「设置」 (Settings), then open the link again.

**Already bound with `gg login`?**
The desktop app and the command line share the same binding information, so the desktop app goes straight to the main window without first-run setup.

## Related pages

- [Desktop app overview and installation](/en/desktop/)
- [Pages](/en/desktop/pages)
- [Bind a machine](/en/user/bind-machine)
- [HTTPS and certificates](/en/deploy/https)
