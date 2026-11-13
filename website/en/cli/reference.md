# Command reference

This page lists every `gg` subcommand, its options, and sample output.

```text
Usage: gg [OPTIONS] <COMMAND>

Commands:
  agents      List agent CLIs and Node.js on this machine; install, upgrade, pick their download mirror or change their settings [alias: agent]
  login       Bind this machine to your account with a one-time code from the Web (头像菜单 → 绑定新机器) …
  service     Keep `gg run` running in the background and start it at login (macOS launchd, Linux systemd user unit)
  logout      Unbind this machine locally (removes the saved token)
  status      Show which server and owner this machine is bound to
  run         Connect to the server and run bots dispatched to this machine
  bots        List the bots bound to this machine (they are managed on the Web)
  net         Measure latency and bandwidth to the server and report them (shown to admins only)
  doctor      Check the server connection, agents, git credentials, disk and line endings
  workspaces  List this machine's workspaces and local backups
  logs        Show recent daemon log lines, or export a redacted diagnostics bundle
  config      Local settings of this machine (a value of `default` restores the default)
  provider    This machine's model providers (third-party endpoints and API keys); they never leave the machine
  help        Print this message or the help of the given subcommand(s)

Options:
      --lang <zh|en>  Output language: zh or en (default: GG_LANG, then LC_ALL / LC_MESSAGES / LANG; Chinese unless another language) [env: GG_LANG=]
  -h, --help          Print help
  -V, --version       Print version
```

Add `--help` after any subcommand to see its help, e.g. `gg logs --help`. Command prompts and output are in Chinese by default, and help text is in English; add `--lang en` to any command (or set `GG_LANG=en`) to get English output. The samples below show the default Chinese output, with the English output noted after each.

| Command | Requires binding | Description |
| --- | --- | --- |
| [`gg login`](#gg-login) | — | Bind this machine |
| [`gg service`](#gg-service) | — | Install or uninstall the background service |
| [`gg logout`](#gg-logout) | — | Unbind this machine |
| [`gg status`](#gg-status) | — | Show binding and background service status |
| [`gg run`](#gg-run) | Yes | Run the daemon and take tasks |
| [`gg bots`](#gg-bots) | Yes | List this machine's Bots |
| [`gg agents`](#gg-agents) | — | Detect, install, and upgrade Agent tools; set the mirror and Agent settings |
| [`gg doctor`](#gg-doctor) | — | Self-check |
| [`gg net`](#gg-net) | Yes | Measure latency and bandwidth |
| [`gg workspaces`](#gg-workspaces) | Yes | List and clean up workspaces |
| [`gg logs`](#gg-logs) | — | View logs, export a diagnostics bundle |
| [`gg config`](#gg-config) | — | Local settings |
| [`gg provider`](#gg-provider) | Partly | Manage local model providers |

Commands that require binding print 「尚未绑定，请先执行 gg login」 ("Not bound yet; run gg login first") when the machine isn't bound.

## gg login

Binds this machine to your account using a connect code generated on the web.

```text
Usage: gg login [OPTIONS] [LINK]

Arguments:
  [LINK]  The 接入链接 copied from the Web

Options:
      --server <SERVER>
      --code <CODE>
      --fingerprint <FINGERPRINT>  Trust this SHA-256 certificate fingerprint (needed for a self-signed server)
      --ca-file <CA_FILE>          Trust the PEM CA certificate at this path (needed for a private CA)
      --create-bot <AGENT>         Also have the server create a bot of this agent on this machine, and a DM with it (claude|codex|gemini|codebuddy|pi|deepseek)
      --code-only                  Fail on an expired code instead of asking for a confirmation on the Web (unattended setups such as Docker)
```

Several forms:

```bash
# 1. Pass the server and connect code separately (this is what you copy from "Bind new machine" → "Use the command line" on the web)
gg login --server https://gg.example.com --code K7QM-4X2P

# 2. Pass the connect link directly
gg login 'gonggong://bind?server=https%3A%2F%2Fgg.example.com&code=K7QM-4X2P'

# 3. Server only, no connect code: go straight to confirmation on the web
gg login --server https://gg.example.com
```

| Option | Description |
| --- | --- |
| `LINK` | Connect link. Mutually exclusive with `--server`, `--code`, `--fingerprint`, and `--ca-file` |
| `--server` | Server address. A server that isn't on this machine must use `https://`; `http://` is allowed only for local addresses such as `localhost` and `127.0.0.1` |
| `--code` | Connect code in the format `XXXX-XXXX`, case-insensitive, valid for 30 minutes |
| `--fingerprint` | Trust this SHA-256 certificate fingerprint, for servers with a self-signed certificate. Written like `sha256:AB:CD:…`; the `sha256:` prefix and colons are optional (64 hex digits). Mutually exclusive with `--ca-file` |
| `--ca-file` | Trust this PEM CA certificate, for servers whose certificate is issued by a private CA |
| `--create-bot` | After binding, have the server create a Bot on this machine that uses this Agent, plus a direct chat with it. Binding the same machine with the same Agent again reuses the existing Bot |
| `--code-only` | Fail right away when the connect code is no longer valid, instead of switching to confirmation on the web. For unattended setups (such as first start in Docker) |

Without `--fingerprint` / `--ca-file`, the server certificate is verified against the system root certificates, so certificates issued by a public CA work as-is. The trust mode you choose is saved, and every connection `gg run` makes later is verified the same way. To get the fingerprint or configure certificates, see [HTTPS and certificates](/en/deploy/https).

Sample output:

```text
绑定成功：本机已归属 王磊（wanglei-mbp）
```

In English: "Bound: this machine now belongs to 王磊 (wanglei-mbp)".

- If this machine was bound before (and you ran `gg logout`), the original machine record is restored, and the output says 「绑定成功：已恢复本机原有机器记录（…），原有 Bot 绑定保持不变」 ("Bound: restored this machine's existing record (…); its Bot bindings are unchanged").
- With `--create-bot`, it also prints 「已准备好 Bot「…」和与它的私聊，回到 Web 即可开始对话」 ("Bot "…" and a DM with it are ready; go back to the Web to start chatting").

### Confirming on the web when the code has expired

If the connect code has expired, was already used, or you didn't pass one, `gg login` doesn't exit. Instead it asks you to confirm this machine on the web:

```text
接入码已过期或已用过，改为在网页上确认这台机器：
  确认链接：https://gg.example.com/link/…
  核对码：7KQM（与网页上显示的一致再点「允许接入」）
等待确认…命令中断后重新运行同一条命令会接着等
```

In English: "The connect code expired or was already used; allow this machine on the web instead: / Link: … / Check code: 7KQM (click Allow only if the web page shows the same code) / Waiting for confirmation... if this command is interrupted, run it again to keep waiting".

1. Open the confirmation link in a browser (`gg` opens it automatically when a graphical environment is available) and sign in with your account.
2. Check that the 4-character check code shown on the page matches the one in your terminal.
3. Click 「允许接入」 (Allow). `gg` completes the binding immediately, and this machine belongs to the account that clicked Allow.

When the request was started with an original connect code, the person who generated that code also gets a notification on the web and can handle it right from the notification. If you don't recognize a request, click 「拒绝」 (Deny); `gg` prints 「接入申请已被拒绝」 ("The connection request was denied") and exits.

- Each request is valid for 15 minutes. When it expires, `gg` automatically sends a new one once; if nobody confirms that either, it stops waiting. Run the same command again when you're ready.
- If you press Ctrl-C while waiting, running the same command again keeps waiting on the previous request, without generating a new check code.

## gg service

Keeps `gg run` running in the background and starts it automatically after you log in to the system. macOS uses launchd (a user-level LaunchAgent), Linux uses a systemd user unit; Windows isn't supported, so use the [desktop app](/en/desktop/) there.

```text
Usage: gg service <COMMAND>

Commands:
  install    Install (or update) and start the background service
  uninstall  Stop and remove the background service
  status     Print `service: running|installed|not-installed|unsupported`
```

```bash
gg service install     # install (or update) and start
gg service status      # service: running
gg service uninstall   # stop and remove
```

| Subcommand | Description |
| --- | --- |
| `install` | Writes the service configuration and starts it immediately. It reads the PATH of your login shell (so Node.js and Agent CLIs installed with nvm, volta, etc. are found too) and writes it into the service; `GONGGONG_HOME` is carried over too if set. Running it again updates the configuration and restarts the service |
| `uninstall` | Stops and removes the service |
| `status` | Prints `service: running` / `installed` (installed but not running) / `not-installed` / `unsupported` (not supported on this system) |

- **macOS**: the configuration file is `~/Library/LaunchAgents/com.gonggong.daemon.plist`, and logs go to `~/.gonggong/logs/service.log`.
- **Linux**: the configuration file is `~/.config/systemd/user/gonggong.service`, and the process is restarted 10 seconds after it exits. By default it runs only while you're logged in; to keep it running after you log out, run `loginctl enable-linger`.
- In environments without a systemd user instance (such as inside a container), the service can't be installed, and you're told to run it in the background with `nohup gg run > ~/.gonggong/logs/service.log 2>&1 &` instead.
- If a daemon is already running on this machine when you install (such as a foreground `gg run`), the service takes over once it exits; to switch right away, stop it first.

## gg logout

Unbinds this machine and deletes the locally saved credential (`~/.gonggong/config.json`).

```bash
gg logout
# 已退出登录；再次 gg login 会恢复这台机器及其 Bot
```

In English: "Logged out; running gg login again restores this machine and its Bots".

It tries to notify the server; if that fails, it still deletes the local credential and says 「如需停用该机器请在 Web 端移除」 ("To disable this machine, remove it on the Web"). `gg logout` doesn't delete workspaces or backups, and doesn't uninstall the background service (run `gg service uninstall` separately if needed).

## gg status

Shows which server this machine is bound to, who owns it, and the background service status.

```text
已绑定：https://gg.example.com · 归属 王磊 · 机器 <机器 ID>
bound: yes
service: running
```

In English, the first line reads "Bound: https://gg.example.com · owner 王磊 · machine &lt;machine ID&gt;". When not bound, the first line is 「未绑定」 ("Not bound") and `bound: no`. The last two lines have a fixed format, so scripts can check them.

## gg run

Connects to the server and runs Bots dispatched to this machine. When running in the foreground, **keep this process running**; once it stops, this machine's Bots show as offline. To keep it running, use [gg service](#gg-service).

```bash
gg run
```

- Only one daemon can run per machine. Running `gg run` while the desktop app or the background service is running fails with 「本机已有共工空间 daemon 在运行（…），同一台机器只能运行一个」 ("a Gonggong Space daemon is already running on this machine (…); only one can run per machine").
- On Ctrl-C or SIGTERM, it stops the managed services started by Bots before exiting.
- If the server rejects it, it exits and prints the reason. If the machine has been revoked (account deactivated or machine revoked), it clears managed workspaces and the local credential, and lists each deleted path.
- Logs are also written to `~/.gonggong/logs/`; see [Local data and logs](/en/cli/local-data).
- It upgrades automatically when a new version is available; see [Automatic upgrades](/en/cli/#automatic-upgrades).

## gg bots

Lists the Bots bound to this machine. Bots are managed on the web.

```text
王磊的 Claude Code	Claude Code	在线	审批方式 每次问我
	在 Web 中管理：https://gg.example.com/?bot=<Bot ID>
```

Here, 王磊的 Claude Code is the Bot name, 在线 means online, 审批方式 每次问我 means approval is set to "Ask me every time", and the second line is the 「在 Web 中管理」 ("Manage on the Web") link.

Possible statuses: 在线 (Online), 运行中 (Running), 离线 (Offline), 本机未安装该 agent (Agent not installed on this machine), 待绑定 (Pending binding), 待确认 · 请在 Web 中确认 (Pending confirmation · confirm it on the Web). When this machine has no Bots, it prints 「本机还没有 Bot」 ("No Bots on this machine yet").

## gg agents

Alias `gg agent`. Without a subcommand, lists detection results for Node.js and each Agent CLI on this machine.

```text
Node.js	24.15.0	最新 24.21.0（可升级）	自行安装	~/.nvm/versions/node/v24.15.0/bin/node
Claude Code	2.1.285	已是最新	自行安装	~/.nvm/versions/node/v24.15.0/bin/claude	可选模型待探测（daemon 运行时自动探测）
Codex	0.156.1	最新 0.159.2（可升级）	自行安装	~/.nvm/versions/node/v24.15.0/bin/codex	可选模型待探测（daemon 运行时自动探测）
```

The columns are: name, version, latest version (最新 …（可升级） "Latest … (upgrade available)" / 已是最新 "Up to date"), source (共工空间托管 "Managed by Gonggong Space" / 自行安装 "Self-installed"), path, and selectable models (可选模型待探测 "Models not probed yet (detected automatically while the daemon runs)"). If Node.js is below 22, the output ends with 「ACP 适配器需要 Node.js ≥ 22」 ("The ACP adapter needs Node.js ≥ 22").

### gg agents install

```text
Usage: gg agents install [OPTIONS] <KIND>

Arguments:
  <KIND>  [possible values: node, claude, codex, gemini, codebuddy, pi, deepseek]

Options:
      --version <VERSION>  Exact version (x.y.z); the latest by default
```

Installs the version managed by Gonggong Space from the mirror into `~/.gonggong/`. It needs no admin privileges and doesn't affect versions already installed on the system.

```bash
gg agents install node
gg agents install claude --version 2.1.285
```

### gg agents upgrade

```text
Usage: gg agents upgrade [OPTIONS] [KIND]

Arguments:
  [KIND]  [possible values: node, claude, codex, gemini, codebuddy, pi, deepseek]

Options:
      --all
```

Upgrades to the latest version. You must specify `KIND` or `--all` (mutually exclusive).

- Versions managed by Gonggong Space: the new version is installed directly.
- Self-installed versions: upgraded the way they were originally installed—`brew upgrade` for Homebrew installs, npm into the original location for global npm installs, and its built-in updater for Claude Code installed other ways. If the install method can't be determined, you're told to 「请用原安装方式升级」 ("upgrade it the way you installed it"). If the install directory needs root, it explains why and never runs sudo automatically.

### gg agents mirror

```text
Usage: gg agents mirror [OPTIONS] [VALUE]

Options:
      --node-mirror <URL>  Node.js download base of a custom mirror (where index.json lives)
```

Shows or sets the download source used to install Node.js, Agent CLIs, and the ACP adapters:

```bash
gg agents mirror                 # show the current mirror
gg agents mirror npmmirror       # Taobao mirror (default)
gg agents mirror official        # official registry
gg agents mirror https://registry.example.com --node-mirror https://example.com/mirrors/node   # custom
```

```text
镜像源：淘宝镜像（npmmirror）
npm	https://registry.npmmirror.com
Node.js	https://npmmirror.com/mirrors/node
```

In English, the first line reads "Mirror: npmmirror (China)".

A custom mirror requires both the npm registry URL and `--node-mirror` (the directory containing `index.json`); `--node-mirror` can't be combined with `npmmirror` / `official`. The setting is saved in `~/.gonggong/settings.json` and is the same setting as 「镜像源」 (Mirror) in the desktop app's 「设置」 (Settings).

### gg agents settings

```text
Usage: gg agents settings [OPTIONS] [AGENT]

Arguments:
  [AGENT]  [default: claude]

Options:
      --set <ID=VALUE>            Set a field, e.g. --set language=chinese (repeatable)
      --unset <ID>                Back to Claude Code's default (repeatable)
      --inherit-cli <true|false>  Also load the CLI's own user-level config (~/.claude)
```

Shows or changes this machine's Agent settings—the settings all Bots on this machine use by default. They're the same settings as the Agent settings in the machine details on the web. Changes take effect on the next turn of sessions in progress.

```text
Claude Code · 本机 Agent 设置
  language	language	-
  thinking	alwaysThinkingEnabled	-
  attribution	attribution	-
  gitInstructions	includeGitInstructions	-
  autoMemory	autoMemoryEnabled	-
  autoCompact	autoCompactEnabled	-
  bashTimeout	BASH_DEFAULT_TIMEOUT_MS	-
  bashMaxTimeout	BASH_MAX_TIMEOUT_MS	-
  nonessentialTraffic	CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC	-
加载 CLI 自身配置（~/.claude）：是
```

In English, the first line reads "Claude Code · agent settings on this machine" and the last "Load the CLI's own config (~/.claude): yes". The columns are the field ID, the corresponding Claude Code setting or environment variable, and the current value (`-` means the Claude Code default).

```bash
gg agents settings --set language=chinese --set autoCompact=false
gg agents settings --unset language
gg agents settings --inherit-cli false   # don't load the user-level config in this machine's ~/.claude
```

`--set` and `--unset` can be repeated. When the CLI's own config is loaded and `~/.claude` contains variables that override Gonggong's settings, those variables are listed.

## gg doctor

Checks the server connection, Agents, git credentials, disk, and line endings; on macOS it also checks Screen Recording and Accessibility permissions.

```text
✓ 服务器连接	HTTPS 正常
✓ Agent	Claude Code 2.1.285 · Codex 0.156.1 可用
- git 凭据	本机暂无托管仓库
✓ 磁盘	工作区 0 B · 剩余 880 GB
- 换行符	本机暂无托管仓库
✓ 屏幕录制	已授权
✓ 辅助功能	已授权
```

In English, the items are Server connection (HTTPS OK), Agent (… available), git credentials, Disk (Workspaces 0 B · 880 GB free), Line endings, Screen Recording, and Accessibility (Granted); 本机暂无托管仓库 is "No managed repositories on this machine yet".

Markers: `✓` OK, `!` warning, `✗` error, `-` skipped. If any item is an error, the exit code is 1. When not bound, 「服务器连接」 (Server connection) shows 「未绑定，请先执行 gg login」 ("Not bound; run gg login first"). 「自检」 (Self-check) in the machine details on the web runs the same checks.

## gg net

Measures latency and bandwidth to the server and reports them to the server.

```text
延迟 32 ms · 带宽 85 Mbps（已上报服务器，仅管理员可见）
```

In English: "Latency 32 ms · bandwidth 85 Mbps (reported to the server, visible to admins only)".

## gg workspaces

```text
Usage: gg workspaces [OPTIONS]

Options:
      --delete <GROUP/BOT>    Delete the removed / unused managed workspaces of <group>/<bot> (ids or names). /cd dirs are never deleted
      --reset-cd <GROUP/BOT>  Point a /cd-bound <group>/<bot> back at its managed clone (same as `/cd @bot --reset`)
```

Without options, lists this machine's workspaces and local backups:

```text
todo-app 开发群 × 前端小助手	托管	/Users/wanglei/gonggong/workspaces/todo-app 开发群/前端小助手/todo-app	空闲

本机备份 · 不上传
（无）
```

Each row shows group × Bot, type (托管 "Managed"), path, and status (空闲 "Idle"). The 「本机备份 · 不上传」 ("Local backups · never uploaded") section here is empty (（无） "(none)").

Managed workspaces are located at `~/gonggong/workspaces/<group name>/<Bot name>/<repo name>`. Directory names come from the group and Bot names at the time of creation; renaming later doesn't move the directory.

| Option | Description |
| --- | --- |
| `--delete <group/Bot>` | Deletes the managed workspaces of that "group × Bot" that have been removed or are unused. Group and Bot can be IDs or names. Directories bound with `/cd` are never deleted |
| `--reset-cd <group/Bot>` | Switches a `/cd`-bound Bot back to its managed workspace, same as `/cd @bot --reset` in the group; the result is posted to the group. Mutually exclusive with `--delete` |

```bash
gg workspaces --delete "todo-app 开发群/前端小助手"
gg workspaces --reset-cd "todo-app 开发群/前端小助手"
```

When the server can't be reached, workspaces are listed by local directory only, and group and Bot names can't be shown. In 「机器与 Bot」 (Machines & Bots) → machine → the 「工作区」 (Workspaces) tab on the web, you can see each workspace's usage and slim down or clean up; see [My machines](/en/user/machines). For the workspace concept, see [Repositories and workspaces](/en/user/repos-workspaces).

## gg logs

```text
Usage: gg logs [OPTIONS]

Options:
      --level <LEVEL>        [default: info] [possible values: error, warn, info, debug]
      --lines <LINES>        [default: 200]
      --export [<PATH.zip>]  Write a diagnostics .zip (redacted logs, checks, versions, config without the token)
```

| Option | Default | Description |
| --- | --- | --- |
| `--level` | `info` | Shows logs at this level and more severe: `error` / `warn` / `info` / `debug` |
| `--lines` | `200` | How many recent lines to show |
| `--export [path.zip]` | — | Exports a diagnostics bundle. Without a path, it's saved to the desktop (or your home directory if there's no desktop directory) as `gonggong-diag-<date-time>.zip` |

```bash
gg logs --level warn --lines 50
gg logs --export
# 已导出诊断包 /Users/wanglei/Desktop/gonggong-diag-20261113-101500.zip（logs/…、diag.json、versions.json、config.json、local.json）
```

The last line is the output; in English: "Exported diagnostics bundle /Users/wanglei/Desktop/gonggong-diag-20261113-101500.zip (logs/…, diag.json, versions.json, config.json, local.json)".

For the bundle's contents, see [Local data and logs](/en/cli/local-data#diagnostics-bundle).

## gg config

Local settings. A value of `default` restores the default.

### gg config agent

```text
Usage: gg config agent --path <PATH> <KIND>
```

Specifies the path to an Agent CLI instead of finding it on PATH automatically. `KIND` is `claude`, `codex`, `gemini`, `codebuddy`, `pi`, or `deepseek`. Models are chosen per Bot on the web, not here.

```bash
gg config agent claude --path /opt/tools/claude
# Claude Code · 路径 /opt/tools/claude
gg config agent claude --path default
# Claude Code · 路径 自动检测
```

In English, the output lines read "Claude Code · path /opt/tools/claude" and "Claude Code · path auto-detect".

A path that doesn't exist fails with 「找不到 …」 ("Not found: …"). The setting is saved in `~/.gonggong/local.json` and is the same setting as 「更换路径…」 (Change path…) on the desktop app's 「Agent」 page.

## gg provider

Manages this machine's model providers (third-party service URLs and API keys). Providers are stored only on this machine and never leave it; see [Permissions and system settings](/en/desktop/permissions).

```text
Commands:
  presets  List the built-in vendors (adapted from CC Switch's presets)
  list     List this machine's providers, defaults and bot overrides (keys masked)
  add      Add a provider from a preset (--preset) or by hand (--name + --base-url); the API key is read from stdin
  edit     Change a provider; sessions using it restart their adapter and resume with the change
  rm       Delete a provider; sessions using it start a new session on their next turn
  use      Machine default: `use <claude|codex|gemini|codebuddy|deepseek> <id|official>`; bot override: `use --bot <bot> <id|official|inherit>`
  import   Import from this machine's CC Switch (`cc-switch`: previews unless --all / --ids) or a `ccswitch://` link
```

Below, `AGENT` is `claude`, `codex`, `gemini`, `codebuddy`, `pi`, or `deepseek`.

### gg provider presets

`gg provider presets [AGENT]`: lists the built-in vendor presets (ID, name, category, Base URL, default model).

```text
Claude Code
  kimi	Kimi	国内厂商	https://api.moonshot.cn/anthropic	kimi-k2.7-code
  deepseek	DeepSeek	国内厂商	https://api.deepseek.com/anthropic	deepseek-v4-pro
  …
```

国内厂商 is the category "China vendors".

### gg provider list

`gg provider list [AGENT]`: lists this machine's providers (keys masked), with `*` marking the machine default; per-Bot overrides are listed too, if any.

```text
Claude Code · 本机默认：官方登录
Codex · 本机默认：官方登录
…
```

In English: "Claude Code · machine default: Official login".

### gg provider add

```text
Usage: gg provider add [OPTIONS] <AGENT>

Options:
      --preset <PRESET>
      --name <NAME>
      --base-url <BASE_URL>
      --model <MODEL>
      --key-stdin            Read the API key from stdin (keeps it out of the shell history)
      --default              Also make it this machine's default for the agent
```

Adds a provider either from a preset (`--preset`) or by hand (`--name` + `--base-url`). The API key **must** be passed on standard input with `--key-stdin`, so it doesn't end up in your shell history.

```bash
# Add from a preset and make it the machine default
printf '%s\n' "$DEEPSEEK_KEY" | gg provider add claude --preset deepseek --key-stdin --default

# Add by hand
printf '%s\n' "$MY_KEY" | gg provider add codex --name 公司网关 --base-url https://llm.example.com/v1 --model gpt-5 --key-stdin
```

### gg provider edit

`gg provider edit <ID> [--name …] [--base-url …] [--model …] [--key-stdin]`: changes a provider; give at least one option. Sessions using it restart their adapter and continue.

### gg provider rm

`gg provider rm <ID>`: deletes a provider. Sessions using it automatically start a new session on their next turn.

### gg provider use

Sets the machine default, or an override for a specific Bot:

```bash
gg provider use claude deepseek          # set Claude Code's machine default to deepseek
gg provider use codex official           # switch Codex back to official login
gg provider use --bot 前端小助手 kimi     # this Bot uses kimi on its own
gg provider use --bot 前端小助手 inherit  # this Bot goes back to inheriting the machine default
```

`--bot` accepts a Bot ID or name and requires `gg login` first (it asks the server which Agent the Bot uses). Switching doesn't affect sessions in progress; if some groups' sessions are still using the old provider, those groups are listed, and they switch only after a new session is started.

### gg provider import

```text
Usage: gg provider import [OPTIONS] <SOURCE>

Options:
      --all
      --ids <IDS>    Keys from the preview, comma separated
      --set-default  Also make the imported current provider (CC Switch's, or the link's) this machine's default
```

`SOURCE` is `cc-switch` (import from CC Switch on this machine) or a `ccswitch://` link.

```bash
gg provider import cc-switch                      # only preview what can be imported
gg provider import cc-switch --all --set-default  # import everything and make CC Switch's current provider the machine default
gg provider import cc-switch --ids kimi,deepseek  # import selected items by their keys from the preview
gg provider import 'ccswitch://…' --set-default   # import from a link
```

## Related pages

- [Command-line installation](/en/cli/)
- [Local data and logs](/en/cli/local-data)
- [Bind a machine](/en/user/bind-machine)
- [My machines](/en/user/machines)
- [HTTPS and certificates](/en/deploy/https)
- [FAQ and troubleshooting](/en/guide/faq)
