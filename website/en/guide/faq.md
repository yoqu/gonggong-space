# FAQ and troubleshooting

This page collects the most common problems and how to fix them. For anything not listed, start by gathering information with the [general troubleshooting steps](#general-troubleshooting-steps).

## General troubleshooting steps

1. **Check status**: `gg status` shows the server and owner this machine is bound to.
2. **Self-check**: `gg doctor` checks, in order, the server connection, agents, git credentials, disk, line endings, and on macOS the Screen Recording and Accessibility permissions. The mark at the start of each line: `✓` OK, `!` warning, `✗` error, `-` skipped. If there are errors, the command exits with a non-zero status.

   ```text
   ✓ 服务器连接	WSS 正常 · 证书固定通过
   ✓ Agent	Claude Code 2.1.3 · Codex 0.46.0 可用
   ✓ git 凭据	SSH · 可访问 · todo-app × 后端助手
   ✓ 磁盘	工作区 1.8 GB · 剩余 212 GB
   ```

   The output is in Chinese. The rows are: 服务器连接 (server connection: WSS OK, certificate pinning passed), Agent (Claude Code 2.1.3 and Codex 0.46.0 available), git 凭据 (git credentials: SSH, accessible, for todo-app × 后端助手), and 磁盘 (disk: workspaces 1.8 GB, 212 GB free).

3. **Check logs**: `gg logs` shows recent daemon logs; filter with `--level error|warn|info|debug` and `--lines <count>`.
4. **Export a diagnostics bundle**: `gg logs --export` creates a zip (on your Desktop by default, named `gonggong-diag-<date>-<time>.zip`; or specify one with `gg logs --export <path>.zip`) containing redacted logs, self-check results, version info, and the local config with tokens removed. You can send it straight to your admin.

Desktop app users can do the same on the 「日志与诊断」 (Logs & diagnostics) page; see [Feature pages](/en/desktop/pages). For command details, see [Command reference](/en/cli/reference).

## Bots and runs

### The Bot shows 「离线」 (Offline) and messages stay 「离线等待」 (Waiting for machine)

The daemon on the Bot's machine isn't connected to the server.

- CLI users: make sure `gg run` is still running on that machine (closing the terminal window disconnects it).
- Desktop app users: make sure the app is running (after you close the window it stays in the menu bar; it only stops when you choose 「退出」 (Quit)).
- Run `gg doctor` and look at the error on the 「服务器连接」 (Server connection) line.

Requests sent while it's offline wait for it to come online, for up to 30 minutes by default (group admins can change this in group settings under 「群级参数」 (Group parameters) →「Bot 离线等待上线（分钟）」 (Bot offline wait, in minutes)). After the timeout the run becomes 「已作废」 (Voided) and you need to send it again.

### A run stays 「排队中」 (Queued)

The step on the card states the reason. Common ones:

- 「本群上一轮未结束，排第 N」 ("previous turn in this group hasn't finished, position N"): a Bot runs only one turn at a time in a given group. Wait for the previous turn to finish, or stop it with `/stop`.
- The workspace is still being prepared (e.g. the first clone of the repository); it starts automatically once cloning finishes.
- The Bot's concurrency is full: the number of simultaneous turns has hit the 「并发上限」 (Concurrency limit); it starts automatically once tasks in other groups finish.

### It shows 「无权触发」 (Not allowed to trigger)

You're not in this Bot's trigger scope. Ask the Bot owner to add you to the 「指定名单」 (Specified list) in the Bot settings, or change the trigger scope to 「任何群成员」 (Any group member). Note that the 「完全访问」 (Full access) tier only allows the specified list to trigger. See [Bot settings and permissions](/en/user/bot-settings).

### "No workspace yet, not run" or "machine can't access the repository"

Messages like these appear in the group:

- `后端助手 还没有工作区，本次未执行；王磊 绑定工作区后重新发起即可` ("后端助手 doesn't have a workspace yet, so this request wasn't run; 王磊 can bind a workspace and resend")
- `后端助手 所在机器无法访问仓库（无权限或仓库不存在），本次未执行；王磊 配置后点「重新检查」` ("后端助手's machine can't access the repository (no permission or repository doesn't exist), so this request wasn't run; 王磊 should configure it and click 「重新检查」 (Recheck)")

A Bot accesses the repository with **its owner's own git credentials on the owner's machine**. Ask the Bot owner to confirm on their machine that they can access the repository (e.g. `git ls-remote <repository URL>`, or the 「git 凭据」 (git credentials) line of `gg doctor`). The reason in parentheses may be 「无权限或仓库不存在」 ("no permission or repository doesn't exist"), 「网络或证书问题」 ("network or certificate problem"), or 「连接超时」 ("connection timed out"). After configuring credentials, click 「重新检查」 (Recheck) in group settings under 「仓库与工作区」 (Repository & workspaces) or on the notice bar in the group. See [Repositories and workspaces](/en/user/repos-workspaces).

### Claude Code / Codex doesn't appear when creating a Bot, or the Bot shows 「agent 缺失」 (Agent missing)

The daemon didn't detect the corresponding CLI on this machine.

1. In a terminal, confirm `claude --version` / `codex --version` runs and that you're signed in.
2. The version can't be too old: Claude Code needs 2.0.0 or later, Codex needs 0.40.0 or later.
3. Run `gg agents` to see what the daemon detected. The daemon re-detects every minute, so after installing, just wait a moment for it to report automatically. You can also install or upgrade directly from 「Agent 工具」 (Agent tools) in the machine details in the web app.
4. If the CLI is installed in an unusual location, specify it with `gg config agent claude --path /full/path/to/claude` (same for Codex).

See [Agent tools and providers](/en/user/agents-providers).

## Binding and connection

### Binding fails with 「绑定码已失效」 or 「绑定码无效」 (bind code expired / invalid)

Connect links and bind codes are single-use and expire (the dialog shows a countdown).

- 「绑定码已失效（已过期或已被使用），请在 Web 端重新生成」 ("bind code is no longer valid (expired or already used); generate a new one in the web app"): open 「绑定新机器」 (Bind new machine) again to generate a new one.
- 「尝试次数过多，绑定码已锁定」 ("too many attempts; bind code locked"): generate a new one later.
- 「绑定码格式错误，应为 XXXX-XXXX」 ("invalid bind code format; expected XXXX-XXXX"): check that you copied it completely.

### Certificate errors

| Error | Cause and fix |
| --- | --- |
| `只允许通过 https:// 连接非本机服务器` ("only https:// is allowed for non-local servers") | The daemon allows `http://` only for the local loopback address. The server needs a certificate, and you must bind with an `https://` URL; see [HTTPS and certificates](/en/deploy/https) |
| `服务器证书指纹不匹配，拒绝连接：期望 …，实际 …` ("server certificate fingerprint mismatch, connection refused: expected …, got …") | The server changed its certificate, there's a certificate-replacing proxy in between, or you may be facing a man-in-the-middle. First verify the new fingerprint with your admin; once confirmed, generate a new bind code in the web app and run `gg login` again |
| `本机配置缺少服务器证书指纹（certSha256），请重新执行 gg login` ("local config is missing the server certificate fingerprint (certSha256); run gg login again") | The local config is incomplete; just bind again |
| `证书指纹格式错误，应为 sha256:AB:CD:…` ("invalid fingerprint format; expected sha256:AB:CD:…") | The `--fingerprint` value was copied incompletely |

::: warning Reverse proxies
The fingerprint in the connect link comes from the server process's own certificate. If a certificate-replacing reverse proxy sits in front of the server, the daemon sees the proxy's certificate, the fingerprint doesn't match, and binding is refused. For such deployments, have the proxy pass TLS through, or use the bind command without `--fingerprint` and verify the fingerprint manually. See [Reverse proxy and preview domain](/en/deploy/reverse-proxy).
:::

::: danger
When you bind for the first time without a fingerprint, the daemon trusts the certificate it sees at that moment and prints its fingerprint. Always check it against the fingerprint your admin published; if it doesn't match, run `gg logout` and contact your admin.
:::

### How do other machines on the LAN connect

- **Web**: LAN members can open the web app directly at the server's address. With a self-signed certificate the browser will warn that it's not trusted; confirm and continue.
- **daemon**: non-local connections must use `https://`. The admin runs `bash scripts/dev-cert.sh` to generate a self-signed certificate that includes the machine's LAN IP, sets `GONGGONG_TLS_CERT` / `GONGGONG_TLS_KEY` as instructed, starts the server and web app, and publishes the printed fingerprint to members. The web dev server listens only on localhost by default; to expose it to the LAN, set `WEB_HOST=0.0.0.0`. See [HTTPS and certificates](/en/deploy/https) and [Local development and testing](/en/dev/local).
- If you open the web app over a plain `http://` LAN address, some browser features are restricted. If clicking 「复制命令」 (Copy command) doesn't show the 「已复制」 (Copied) message, select the command text and copy it manually.

## Installation and system

### Typing `gg` opens the git GUI

oh-my-zsh's git plugin aliases `gg` to `git gui citool`. Add this line at the end of `~/.zshrc` and reopen your terminal:

```bash
unalias gg 2>/dev/null
```

To bypass it temporarily, use `command gg …`.

### macOS blocks it from running

- **The downloaded `gg` is blocked**: remove the "downloaded from the internet" flag:

  ```bash
  xattr -d com.apple.quarantine ~/.local/bin/gg
  ```

  A `gg` you build from source locally isn't blocked.
- **The desktop app says it "can't be opened"**: click 「仍要打开」 (Open Anyway) at the bottom of System Settings → Privacy & Security, or right-click the icon in Applications and choose Open.
- **Live view and remote control don't work**: in System Settings → Privacy & Security, allow the program that runs `gg` (the terminal or the desktop app) under Screen Recording and Accessibility. `gg doctor` tells you which one is missing. See [Permissions and system settings](/en/desktop/permissions).

### Downloading agent tools or adapters is slow or fails

On first run the daemon downloads the ACP adapters with npm, and installing Node.js / Claude Code / Codex from the web app or desktop app also downloads packages. The default source is the China mirror npmmirror; you can switch it:

```bash
gg agents mirror                 # show the current download source
gg agents mirror official        # use the official registry
gg agents mirror https://registry.example.com --node-mirror https://example.com/node   # custom
gg agents mirror npmmirror       # switch back to the default
```

Gonggong Space only changes its own config and never touches your global npm settings.

### `gg` says `command not found`

The directory containing `gg` isn't on your PATH. For install locations and PATH setup, see [Installation](/en/cli/).

## Previews

### A preview card won't open

- The card shows 「离线」 (Offline): the daemon on the Bot's machine isn't connected. Preview traffic is forwarded through it, so get the machine online first.
- The card shows 「服务已停止」 (Service stopped): the service behind the preview isn't running. Click 「启动服务」 (Start service) on the card, or have the Bot restart the service.
- The card shows 「已关闭」 (Closed): by default a preview closes automatically after 24 hours without visits (adjustable in system parameters). Have the Bot publish it again.
- In a LAN deployment, each preview uses one port on the server (41000–41099 by default, adjustable with `GONGGONG_PREVIEW_PORTS`). The server listens only on localhost by default; set `GONGGONG_PREVIEW_HOST=0.0.0.0` to make these ports reachable from the LAN, and open them in the firewall.
- For production, use a dedicated preview domain (`GONGGONG_PREVIEW_DOMAIN`, which must be a different domain from the main site, with wildcard DNS and a certificate), and set `GONGGONG_PUBLIC_URL` to the main site's URL.

See [Previews](/en/user/previews) and [Reverse proxy and preview domain](/en/deploy/reverse-proxy).

## Accounts and machines

- **Switching machines or retiring one**: run `gg logout` on the old machine to unbind it. Running `gg login` again on the same machine restores its original machine record and the Bots on it.
- **Account deactivated or machine revoked**: the daemon's next connection is refused, and it clears the local credentials and managed workspaces (local directories bound with `/cd` are not deleted). To restore access, contact your sysadmin.

## Related pages

- [Command reference](/en/cli/reference)
- [Local data and logs](/en/cli/local-data)
- [HTTPS and certificates](/en/deploy/https)
- [Glossary](/en/guide/glossary)
