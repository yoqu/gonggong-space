# Bind a machine

Bots run on members' own machines. This page explains how to bind a machine to your account. The easiest way is to send one sentence to an Agent on that machine and let it install and bind everything itself; you can also use the desktop app, the command line, or Docker. For day-to-day management after binding, see [My machines and Bots](/en/user/machines).

## Open Bind new machine

Use any of these entry points:

- 「绑定新机器」 (Bind new machine) in the avatar menu (members who haven't set up a Bot yet see 「接入我的电脑」 (Connect my computer) here instead);
- 「机器与 Bot」 (Machines & Bots) in the left navigation bar → 「绑定新机器」 (Bind new machine) at the bottom of the machine list; with no machines yet, it's the 「绑定新机器」 (Bind new machine) button in the middle of the page;
- Step one on the home welcome page, 「绑定新机器」 (Bind new machine) → 「开始绑定」 (Start binding), or the sidebar's 「开始使用」 (Get started) card.

When the dialog opens, it automatically generates a one-time **connect code** (like `ABCD-EF23`), valid for 30 minutes and replaced automatically when it expires. The step bar at the top shows progress: 「复制给 Agent」 (Copy to your agent) → 「机器接入」 (Machine connects) → 「Bot 就绪」 (Bot ready).

## Option 1: Send it to your Agent (recommended)

Works on macOS and Linux when the machine already has an Agent such as Claude Code or Codex installed and logged in.

![Send to your Agent](/screenshots/web/bind-agent.webp)

1. In the dialog's 「发给你的 Agent」 (Send to your agent) section, click 「复制」 (Copy) to copy the sentence. It looks like:
   ```text
   帮我接入共工空间：读取 https://gg.example.com/api/install.md 并按步骤执行，接入码 ABCD-EF23。
   ```
   (Roughly: "Connect me to Gonggong Space: read https://gg.example.com/api/install.md and follow the steps; connect code ABCD-EF23.")
2. On the machine you want to bind, open Claude Code, Codex, or similar, and paste the sentence to it.
3. Wait for it to finish, usually 1–3 minutes. The dialog shows 「等待接入…Agent 会自己下载安装，通常 1–3 分钟」 ("Waiting… the agent downloads and installs by itself, usually in 1–3 minutes").

The Agent follows the steps provided by the server on its own:

- Downloads `gg`, verifies its sha256, and installs it to `~/.local/bin/gg` (only in your home directory — no sudo, no system settings changed);
- Binds the machine to your account using the connect code;
- Creates a Bot using its own kind of Agent (named "your name's Agent name", e.g. 「王磊的 Claude Code」 (王磊's Claude Code)) and sets up a direct chat between you and it;
- Runs `gg service install` so `gg` stays resident in the background and starts automatically when you log in (launchd on macOS, a systemd user service on Linux);
- Finally runs `gg status`; it's connected only when the output shows both `bound: yes` and `service: running`.

Once connected, the web page closes the dialog automatically and opens the direct chat with the new Bot — just tell it what you need.

::: tip
- If the machine is already bound to another server, the Agent stops and asks you instead of changing `~/.gonggong` on its own.
- On Linux, to stay online after you log out, run `loginctl enable-linger` as prompted.
- If `~/.local/bin` isn't on your PATH, run commands as `~/.local/bin/gg`.
- Windows doesn't support this option; expand 「其他方式」 (Other ways) and use the desktop client.
:::

### An expired connect code is fine too

If the connect code the Agent uses has expired or was already used, `gg` doesn't fail and exit; it asks you to confirm on the web instead:

1. The terminal (or the Agent's reply) shows a confirmation link and a 4-digit 「核对码」 (Check code), and displays 「等待确认…」 ("Waiting for confirmation...").
2. If the 「绑定新机器」 (Bind new machine) dialog is still open, a 「机器接入申请」 (Machine hookup request) card appears right in the dialog, and you also get a notification. You can also open the confirmation link in a browser (page title 「确认机器接入」 (Confirm a machine)).
3. Check that the 「核对码」 (Check code) on the web page matches the one in the terminal, confirm that 「系统」 (System) and 「发起 IP」 (Requested from IP) are your machine, and click 「允许接入」 (Allow).
4. The machine finishes binding right away, creates the Bot automatically, and opens the direct chat.

::: warning Only allow connections you just started yourself
After 「允许接入」 (Allow), the machine belongs to **the account that clicked Allow**. Allow only when you yourself just started the connection and the check code matches the terminal; click 「拒绝」 (Deny) for requests you don't recognize.
:::

A confirmation request is valid for 15 minutes. After that it shows 「接入申请已过期」 ("This request has expired"); just rerun the same command on the machine. If the command is interrupted midway, rerunning the same command keeps waiting on the original request.

## Option 2: Other ways

Expand 「其他方式」 (Other ways) in the dialog. There are two steps:

### ① Install the client

The page recommends an installer for your current OS; you can switch under 「选择系统」 (Choose a system):

| Option | Description |
| --- | --- |
| macOS（Apple 芯片） (macOS (Apple silicon)) / macOS（Intel） (macOS (Intel)) | Desktop client with a built-in daemon — see [Desktop app](/en/desktop/) |
| Windows | Desktop client |
| Linux x86_64 / aarch64（命令行） (command line) | The `gg` command-line tool — see [Command-line installation](/en/cli/) |

If the client is already installed, click 「我已安装」 (Already installed) to skip.

### ② Open the connect link

- **Desktop app**: on the machine you want to bind, click 「在客户端中打开」 (Open in client) and the desktop app picks up the connect link. If it doesn't open automatically, click 「复制接入链接」 (Copy connect link) and paste it into the desktop app's first-run onboarding. See [Desktop first-run setup](/en/desktop/onboarding).
- **Command line**: expand 「使用命令行」 (Use the command line), click the copy button, and run it in the machine's terminal:
  ```bash
  gg login --server https://gg.example.com --code ABCD-EF23
  ```
  You can also pass the connect link straight to `gg login`:
  ```bash
  gg login 'gonggong://bind?server=…&code=…'
  ```
  On success the terminal prints 「绑定成功：本机已归属 王磊（…）」 ("Bound: this machine now belongs to 王磊 (…)"). Then keep it resident:
  ```bash
  gg service install
  ```
  You can also run `gg run` in the foreground (the machine goes offline when you close the terminal). With options such as `--create-bot claude`, `gg login` also creates a Bot and direct chat, just like Option 1.
- **Docker**: expand 「在 Docker 中运行」 (Run in Docker), copy the `GONGGONG_BIND_URL='…'` line, and add it to `.env` in the server's `docker/daemon` directory (`GG_VERSION` and `GONGGONG_MACHINE_ID` are also required). Run `docker compose up -d --build`; the container binds automatically on first start. For the full steps, see [Docker deployment](/en/deploy/docker).

After binding with any of these, the dialog shows 「绑定成功」 (Bound) and lists the Agents and versions detected on the machine. Click 「新建 Bot」 (New Bot) to create a Bot on this machine (see [Create a Bot](/en/user/create-bot)), or 「稍后」 (Later).

::: tip Server address and certificates
- Non-local servers must use an `https://` address; `http://` is only allowed for local addresses such as `localhost`.
- If the server uses a self-signed certificate, add `--fingerprint <SHA-256 fingerprint>` to `gg login`; with a private CA, add `--ca-file <CA certificate path>`. See [HTTPS and certificates](/en/deploy/https).
:::

## What gets reported after binding

After binding, the machine belongs to you. The client reports the machine name, OS, CPU, memory, and the Agents available on the machine (Claude Code, Codex, Gemini CLI, CodeBuddy, pi, DeepSeek Harness). Agent login info, providers, and API keys stay on the machine and are never uploaded — see [Agent tools and providers](/en/user/agents-providers).

## Common errors

::: warning
- 「接入链接尝试次数过多，已锁定，请稍后在 Web 端重新生成」 ("Too many connect link attempts; it is locked. Generate a new one on the Web later"): too many failures from the same network in a short time; wait 10 minutes and try again.
- 「待确认的接入申请过多，请稍后再试」 ("Too many connection requests are waiting; try again later"): one person can have at most 3 pending requests at once; handle them on the web first.
- 「接入申请已被拒绝」 ("The connection request was denied"): someone clicked 「拒绝」 (Deny) on the web; rerun the connect command if needed.
- 「无法连接服务器 …」 ("Can't connect to server …"): check that the machine can reach the server address (firewall, port, intranet/VPN).
- 「只允许通过 https:// 连接非本机服务器」 ("Non-local servers must use https://"): change the address to `https://`.
:::

## Multiple machines and rebinding

One account can bind multiple machines (say, an office Mac and a Linux cloud host), binding each one once. When creating a Bot, you choose which machine it runs on.

- **Rebinding the same machine**: restores the original machine record and its Bots; the web page shows 「已恢复原有机器」 (Existing machine restored).
- **Changing a machine's owner**: if the machine previously belonged to someone else and still has their Bots on it, binding is refused; the previous owner has to delete those Bots first.
- **Going offline temporarily**: stop `gg run`, run `gg service uninstall`, or quit the desktop app. Running `gg logout` on the machine deletes its local credentials; a later `gg login` restores the machine and its Bots.
- **Retiring it for good**: revoke the machine on the web — see [My machines and Bots](/en/user/machines#revoke-a-machine).

## Related pages

- [My machines and Bots](/en/user/machines)
- [Agent tools and providers](/en/user/agents-providers)
- [Create a Bot](/en/user/create-bot)
- [Command-line installation](/en/cli/)
- [Desktop app](/en/desktop/)
