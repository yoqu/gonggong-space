# FAQ and troubleshooting

This page collects the most common problems and how to fix them. For anything not listed, start by gathering information with the [general troubleshooting steps](#general-troubleshooting-steps).

## General troubleshooting steps

1. **Check status**: `gg status` shows the server this machine is bound to, the owner, and whether the background service is running (`service: running`).
2. **Self-check**: `gg doctor` checks the server connection, Agents, git credentials, disk, line endings, and on macOS the Screen Recording and Accessibility permissions. The mark before each line means: `✓` OK, `!` warning, `✗` error, `-` skipped; if there are errors, the command exits with a non-zero status.

   ```text
   ✓ 服务器连接	HTTPS 正常
   ✓ Agent	Claude Code 2.1.3 · Codex 0.160.1 可用
   ✓ git 凭据	SSH · 可访问 · todo-app × 后端助手
   ✓ 磁盘	工作区 1.8 GB · 剩余 212 GB
   ```

   (The lines are: server connection — HTTPS OK; Agent — Claude Code 2.1.3 · Codex 0.160.1 available; git credentials — SSH · reachable · todo-app × 后端助手; disk — workspaces 1.8 GB · 212 GB free. With an English locale, `gg` prints these in English.)

3. **Read the logs**: `gg logs` shows recent daemon logs; filter with `--level error|warn|info|debug` and `--lines <count>`.
4. **Export a diagnostics bundle**: `gg logs --export` creates a zip (on your desktop by default, named `gonggong-diag-<date>-<time>.zip`; or specify one with `gg logs --export <path>.zip`). It contains redacted logs, the self-check results, version info, and the local config with tokens removed, and you can send it straight to your admin.

Desktop app users can do the same on the 「日志与诊断」 (Logs & diagnostics) page; see [Pages](/en/desktop/pages). In the web app's 「机器与 Bot」 (Machines & Bots) you can also view a machine's self-check results and daemon logs; see [My machines and Bots](/en/user/machines). For command details, see [Command reference](/en/cli/reference).

## Connecting a machine

### I sent the message to my Agent and it stopped with an error

The Agent will tell you the raw output of the command. Common ones:

- "on Windows use the desktop app": connecting with one message supports only macOS and Linux. On Windows, expand 「其他方式」 (Other ways) in 「绑定新机器」 (Bind new machine) and bind with the desktop app.
- "no gg build for …" or 「这个平台还没有发布 gg」 ("No gg build has been published for this platform"): the server hasn't published a daemon for this platform yet. Ask your admin to upload one under 「管理后台」 (Admin console) →「客户端发布」 (Client releases); see [Client releases](/en/admin/releases).
- "this machine is already bound to …": this machine is already bound to another server (possibly through the desktop app). The Agent won't change that for you. If you do want to switch servers, run `gg logout` on the machine first, then send the message again.
- Certificate errors: the server uses a self-signed certificate, and connecting with one message requires a trusted certificate. Bind with the desktop app or the CLI instead and include the certificate fingerprint; see [HTTPS and certificates](/en/deploy/https).

### The connect code expired, or it asks me to allow this machine on the web

The connect code is valid for 30 minutes and can be used once. If it has expired or was already used, `gg login` doesn't simply fail: it opens a connection request and prints a confirmation link and a 4-character check code:

1. Open the confirmation link in a browser (if the 「绑定新机器」 (Bind new machine) dialog is open, the request also shows up right there);
2. Check that the code on the page matches the one in the terminal;
3. Click 「允许接入」 (Allow).

Only allow it if you just started connecting this machine yourself and the codes match. If it's denied or nobody confirms it for a long time, `gg login` stops waiting; run it again when you're ready.

### Other connection errors

- 「接入链接尝试次数过多，已锁定，请稍后在 Web 端重新生成」 ("Too many connect link attempts; it is locked. Generate a new one on the Web later"): reopen 「绑定新机器」 on the web a bit later.
- 「接入链接中的代码格式应为 XXXX-XXXX」 ("The code in the connect link should look like XXXX-XXXX"): check that you copied it completely.
- 「只允许通过 https:// 连接非本机服务器」 ("Non-local servers must use https://"): the server address must use `https://`; `http://` is only allowed for the local machine (`localhost`, `127.0.0.1`).

### The background service isn't running

The background service installed by the one-message setup or `gg service install` uses launchd on macOS and a systemd user service on Linux, and starts automatically after login.

- `gg service status` shows its status; `gg service install` reinstalls and starts it.
- On Linux, to keep it running after you log out, run `loginctl enable-linger` once.

## Bots and runs

### The Bot shows "Offline" and messages stay in "Waiting for machine"

The daemon on the Bot's machine isn't connected to the server.

- CLI users: confirm the background service is running with `gg service status`; without the background service, make sure the terminal running `gg run` is still open.
- Desktop app users: confirm the app is running (it stays in the background after you close the window; only 「退出」 (Quit) stops it).
- Run `gg doctor` and check the error for the 「服务器连接」 (Server connection) item.

Requests sent while it's offline wait for it to come online, up to 30 minutes by default (group admins can change this in group settings under 「群级参数」 (Group parameters) →「Bot 离线等待上线（分钟）」 (Wait for offline Bot (minutes))). After the timeout the run becomes 「已作废」 (Void), and you need to send it again.

### The run stays "Queued"

The steps on the card give the reason. Common ones:

- 「本群上一轮未结束，排第 N」 ("Previous turn in this group still running, #N in line"): the same Bot runs only one turn at a time in the same group. Wait for the previous turn to finish, or stop it with `/stop`.
- The workspace is still being prepared (for example, the first clone of the repository); it starts automatically when the clone finishes.
- The Bot's concurrency is full: the number of turns running at once has reached the 「并发上限」 (Concurrency limit); it starts automatically when tasks in other groups finish.

### It shows "Not allowed"

You're not in this Bot's trigger scope. Ask the Bot owner to add you to the 「指定名单」 (Specified list) in the Bot settings, or change the trigger scope to 「任何群成员」 (Any group member). Note that a Bot whose approval mode is 「完全允许」 (Allow everything) can only be triggered by people on the trigger list. See [Bot settings and permissions](/en/user/bot-settings).

### "has no workspace yet, so this was not run" or "machine cannot reach the repo"

(The messages are 「还没有工作区，本次未执行」 and 「所在机器无法访问仓库」.)

A Bot accesses the repository with **its owner's own git credentials on their machine**. Ask the Bot owner to confirm on their machine that they can reach the repository (for example `git ls-remote <repo URL>`, or the 「git 凭据」 (git credentials) item in `gg doctor`). Common reasons are 「无权限或仓库不存在」 ("no permission or the repo does not exist"), 「网络或证书问题」 ("network or certificate problem"), and 「连接超时」 ("connection timed out"). You can also configure Git access for the machine in the web app's 「机器与 Bot」 (Machines & Bots). Once it's set up, click 「重新检查」 (Recheck) in the group settings under 「仓库与同步」 (Repos & sync) or on the notice bar in the group. See [Repositories and workspaces](/en/user/repos-workspaces).

### An Agent is missing when creating a Bot, or the Bot shows "Agent missing"

The daemon didn't detect the corresponding CLI on this machine (the label is 「agent 缺失」).

1. In a terminal, confirm the CLI runs (for example `claude --version`, `codex --version`) and is logged in.
2. The version can't be too old. Minimum versions:

   | Agent | Minimum version |
   | --- | --- |
   | Claude Code | 2.0.0 |
   | Codex | 0.160.1 |
   | Gemini CLI | 0.36.0 |
   | CodeBuddy | 2.182.0 |
   | pi | 1.0.0 |
   | DeepSeek Harness | 0.2.2 |

3. Run `gg agents` to see what the daemon detected. Once installed, it's reported automatically after a moment; you can also install or upgrade directly under 「Agent 工具」 (Agent tools) in the machine details on the web.
4. If the CLI is installed in an unusual location, specify it with `gg config agent claude --path /full/path/to/claude` (same for other Agents).

See [Agent tools and providers](/en/user/agents-providers).

### Too many approval cards

In the Bot settings, change the 「审批方式」 (Approval) from 「每次问我」 (Ask me every time) to 「帮我审批」 (Review for me): builds, tests, local git, editing files inside the workspace, and the like go through directly, and only the rest comes to you. You can also turn on 「AI 预审」 (AI pre-review) to filter further. For a large one-off job, choose 「本次运行免审批」 (No approvals this run) on an approval card. See [Approvals and questions](/en/user/approvals).

## Connections and networking

### Can't connect to the server

- 「无法连接服务器 …」 ("Can't connect to server …"): confirm this machine can reach the server address (firewall, port, LAN/VPN).
- Certificate errors: the daemon verifies the server certificate. For a self-signed certificate, include the fingerprint when binding (`gg login --server … --code … --fingerprint <fingerprint>`); for a private CA, use `--ca-file`. After the certificate changes, machines bound with a fingerprint must bind again with the new fingerprint. See [HTTPS and certificates](/en/deploy/https).

### How do other machines on the LAN connect?

- **Web**: LAN members can open the web app directly at the server's address. With a self-signed certificate the browser warns that it isn't trusted; confirm to continue.
- **daemon**: bind with an `https://` address; a self-signed certificate needs the certificate fingerprint, as above. To generate a certificate that includes the LAN IP, see [HTTPS and certificates](/en/deploy/https).
- The web dev server listens only on the local machine by default; to open it to the LAN, set `WEB_HOST=0.0.0.0`. See [Local development and testing](/en/dev/local).

## Installation and system

### Typing `gg` opens the git GUI

The oh-my-zsh git plugin aliases `gg` to `git gui citool`. Add this line to the end of `~/.zshrc` and reopen the terminal:

```bash
unalias gg 2>/dev/null
```

To bypass it temporarily, use `command gg …`.

### macOS blocks it from running

- **A downloaded `gg` is blocked**: remove the "downloaded from the internet" flag:

  ```bash
  xattr -d com.apple.quarantine ~/.local/bin/gg
  ```

  A `gg` built from source on the machine isn't blocked.
- **The desktop app says it "can't be opened"**: at the bottom of System Settings → Privacy & Security, click "Open Anyway", or right-click the icon in Applications and choose "Open".
- **Live views and remote control don't work**: in System Settings → Privacy & Security, allow the program running `gg` (the terminal or the desktop app) under Screen Recording and Accessibility. `gg doctor` tells you which one is missing. See [Permissions and system settings](/en/desktop/permissions).

### Downloading Agent tools or adapters is slow or fails

On first run the daemon downloads the ACP adapters with npm, and installing Node.js and Agent tools from the web or the desktop app also downloads packages. The default source is the npmmirror mirror in China; you can switch it:

```bash
gg agents mirror                 # show the current source
gg agents mirror official        # use the official registry
gg agents mirror https://registry.example.com --node-mirror https://example.com/node   # custom
gg agents mirror npmmirror       # back to the default
```

Gonggong Space only changes its own configuration and never touches your global npm settings.

### `gg` says `command not found`

The directory containing `gg` isn't on your PATH. The one-message setup installs `gg` to `~/.local/bin/gg`; run it by full path, or add `~/.local/bin` to your PATH. See [Installation](/en/cli/).

### Workspaces take up too much disk

In the web app's 「机器与 Bot」 (Machines & Bots), open the machine's storage management to see each workspace's usage, and slim down or clean up workspaces you no longer use; from the command line, use `gg workspaces`. See [My machines and Bots](/en/user/machines).

## Previews

### A preview card won't open

- The card shows 「离线」 (Offline): the daemon on the Bot's machine isn't connected. Preview traffic goes through it, so get the machine online first.
- The card shows 「服务已停止」 (Service stopped): the service behind the preview isn't running. Click 「启动服务」 (Start service) on the card, or have the Bot start the service again.
- The card shows 「已关闭」 (Closed): by default a preview closes automatically after 24 hours without visits (adjustable in system parameters); have the Bot publish it again.
- In a LAN deployment each preview uses one port on the server (41000–41099 by default, adjustable with `GONGGONG_PREVIEW_PORTS`). The server listens only on the local machine by default; set `GONGGONG_PREVIEW_HOST=0.0.0.0` so the LAN can reach these ports, and open them in the firewall.
- For production, use a dedicated preview domain (`GONGGONG_PREVIEW_DOMAIN`, which must differ from the main site's domain, with wildcard DNS and a certificate), and set `GONGGONG_PUBLIC_URL` to the main site's address.

See [Previews](/en/user/previews) and [Reverse proxy and preview domains](/en/deploy/reverse-proxy).

## Accounts and machines

- **Switching machines or retiring one**: on the old machine, run `gg service uninstall` to stop the background service, then `gg logout` to unbind it. Binding the same machine again restores its machine record and the Bots on it.
- **Account disabled or machine revoked**: the daemon is rejected on its next connection and clears its local credentials and managed workspaces (local directories chosen by the Bot owner aren't deleted). Contact your sysadmin to restore access.

## Related pages

- [Command reference](/en/cli/reference)
- [Local data and logs](/en/cli/local-data)
- [HTTPS and certificates](/en/deploy/https)
- [Glossary](/en/guide/glossary)
