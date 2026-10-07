# Command reference

This page lists every `gg` subcommand, its options, and sample output.

```text
Usage: gg <COMMAND>

Commands:
  agents      List agent CLIs and Node.js on this machine; install, upgrade or pick their download mirror
  login       Bind this machine to your account with a one-time code from the Web
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
  -h, --help     Print help
  -V, --version  Print version
```

Add `--help` after any subcommand to see its help, e.g. `gg logs --help`. Command prompts and output are in Chinese; help text is in English.

| Command | Requires binding | Description |
| --- | --- | --- |
| [`gg login`](#gg-login) | — | Bind this machine |
| [`gg logout`](#gg-logout) | — | Unbind this machine |
| [`gg status`](#gg-status) | — | Show binding status |
| [`gg run`](#gg-run) | Yes | Run the daemon and take tasks |
| [`gg bots`](#gg-bots) | Yes | List this machine's Bots |
| [`gg agents`](#gg-agents) | — | Detect, install, and upgrade Agent tools; set the mirror |
| [`gg doctor`](#gg-doctor) | — | Self-check |
| [`gg net`](#gg-net) | Yes | Measure latency and bandwidth |
| [`gg workspaces`](#gg-workspaces) | Yes | List and clean up workspaces |
| [`gg logs`](#gg-logs) | — | View logs, export a diagnostics bundle |
| [`gg config`](#gg-config) | — | Local settings |
| [`gg provider`](#gg-provider) | Partly | Manage local model providers |

Commands that require binding print 「尚未绑定，请先执行 gg login」 ("not bound yet; run gg login first") when the machine isn't bound.

## gg login

Binds this machine to your account using a one-time bind code generated on the web.

```text
Usage: gg login [OPTIONS] [LINK]

Arguments:
  [LINK]  The 接入链接 copied from the Web

Options:
      --server <SERVER>
      --code <CODE>
```

Two forms; use either one:

```bash
# 1. Pass the connect link directly (from 「复制接入链接」 on the web)
gg login 'gonggong://bind?server=https%3A%2F%2Fgg.example.com&code=K7QM-4X2P'

# 2. Pass the server and bind code separately (this is what you copy from 「绑定新机器」 → 「使用命令行」 on the web)
gg login --server https://gg.example.com --code K7QM-4X2P
```

| Option | Description |
| --- | --- |
| `LINK` | Connect link. Mutually exclusive with `--server` and `--code` |
| `--server` | Server address; must be used together with `--code`. Either `https://` or `http://` (unencrypted); the server certificate isn't verified |
| `--code` | Bind code in the format `XXXX-XXXX`, case-insensitive |

Sample output:

```text
绑定成功：本机已归属 王磊（wanglei-mbp）
```

This reads: "Bound successfully: this machine now belongs to 王磊 (wanglei-mbp)."

- To try the public demo server, use `gg login --server http://gg.uyoqu.com --code <bind code>` with a bind code generated there.
- If this machine was bound before (and you ran `gg logout`), the original machine record is restored, and the output says 「已恢复本机原有机器记录（…），原有 Bot 绑定保持不变」 ("restored this machine's original record (…); existing Bot bindings unchanged").
- Bind codes are single-use and expire. If one is no longer valid, generate a new one on the web.

## gg logout

Unbinds this machine and deletes the locally saved credential (`~/.gonggong/config.json`).

```bash
gg logout
# 已退出登录；再次 gg login 会恢复这台机器及其 Bot
```

The output means "Logged out; running gg login again restores this machine and its Bots."

It tries to notify the server; if that fails, it still deletes the local credential and prints 「如需停用该机器请在 Web 端移除」 ("to deactivate this machine, remove it on the web"). `gg logout` doesn't delete workspaces or backups; the desktop app's 「解除绑定…」 (Unbind…) also clears managed workspaces.

## gg status

Shows which server this machine is bound to and who owns it.

```text
已绑定：https://gg.example.com · 归属 王磊 · 机器 <机器 ID>
```

This reads "Bound: https://gg.example.com · owner 王磊 · machine &lt;machine ID&gt;". When not bound, it prints 「未绑定」 ("not bound").

## gg run

Connects to the server and runs Bots dispatched to this machine. **Keep this process running**; once it stops, this machine's Bots show as offline.

```bash
gg run
```

- Only one daemon can run per machine. Running `gg run` while the desktop app is running fails with 「本机已有共工空间 daemon 在运行（…gg run 或桌面端），同一台机器只能运行一个」 ("a Gonggong Space daemon is already running on this machine (…gg run or the desktop app); only one can run per machine").
- On Ctrl-C or SIGTERM, it stops the managed services started by Bots before exiting.
- If the server rejects it, it exits and prints the reason. If the machine has been revoked (account deactivated or machine revoked), it clears managed workspaces and the local credential, and lists each deleted path.
- Logs are also written to `~/.gonggong/logs/`; see [Local data and logs](/en/cli/local-data).
- It upgrades automatically when the server publishes a new version; see [Automatic upgrades](/en/cli/#automatic-upgrades).

## gg bots

Lists the Bots bound to this machine. Bots are managed on the web.

```text
前端小助手	Claude Code	在线	命令审批 每次询问
	在 Web 中管理：https://gg.example.com/?bot=<Bot ID>
```

Here, 前端小助手 is the Bot name, 在线 means online, 命令审批 每次询问 means command approval is set to "ask every time", and the second line is the 「在 Web 中管理」 (Manage on web) link.

Possible statuses: 在线 (online), 运行中 (running), 离线 (offline), 本机未安装该 agent (agent not installed on this machine), 待绑定 (pending binding), 待确认 · 请在 Web 中确认 (pending confirmation · confirm on the web). When this machine has no Bots, it prints 「本机还没有 Bot」 ("no Bots on this machine yet").

## gg agents

Without a subcommand, lists detection results for Node.js, Claude Code, and Codex on this machine.

```text
Node.js	24.15.0	最新 24.21.0（可升级）	自行安装	~/.nvm/versions/node/v24.15.0/bin/node
Claude Code	2.1.285	已是最新	自行安装	~/.nvm/versions/node/v24.15.0/bin/claude	可选模型待探测（daemon 运行时自动探测）
Codex	0.156.1	最新 0.159.2（可升级）	自行安装	~/.nvm/versions/node/v24.15.0/bin/codex	可选模型待探测（daemon 运行时自动探测）
```

The columns are: name, version, latest version (最新 … （可升级） "latest … (upgradable)" / 已是最新 "up to date"), source (共工空间托管 managed by Gonggong Space / 自行安装 self-installed), path, and selectable models (可选模型待探测 "models not probed yet; probed automatically while the daemon runs"). If Node.js is below 22, the output ends with 「ACP 适配器需要 Node.js ≥ 22」 ("ACP adapters require Node.js ≥ 22").

### gg agents install

```text
Usage: gg agents install <KIND>

Arguments:
  <KIND>  [possible values: node, claude, codex]

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
  [KIND]  [possible values: node, claude, codex]

Options:
      --all
```

Upgrades versions managed by Gonggong Space to the latest. You must specify `KIND` or `--all` (mutually exclusive). Upgrade self-installed versions the way you originally installed them.

### gg agents mirror

```text
Usage: gg agents mirror [OPTIONS] [VALUE]

Options:
      --node-mirror <URL>  Node.js download base of a custom mirror (where index.json lives)
```

Shows or sets the download source used to install Node.js, Claude Code, Codex, and the ACP adapters:

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

The first line reads "Mirror: Taobao mirror (npmmirror)".

A custom mirror requires both the npm registry URL and `--node-mirror` (the directory containing `index.json`); `--node-mirror` can't be combined with `npmmirror` / `official`. The setting is saved in `~/.gonggong/settings.json` and is the same setting as 「镜像源」 (Mirror) in the desktop app's 「设置」 (Settings).

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

The items are server connection (HTTPS OK; for an `http://` server, 「HTTP 正常（未加密）」 "HTTP OK (unencrypted)"), Agent (available), git credentials, disk (workspace usage · free space), line endings, Screen Recording, and Accessibility (已授权 granted). 本机暂无托管仓库 means "no managed repositories on this machine yet".

Markers: `✓` OK, `!` warning, `✗` error, `-` skipped. If any item is an error, the exit code is 1. When not bound, 「服务器连接」 (Server connection) shows 「未绑定，请先执行 gg login」 ("not bound; run gg login first").

## gg net

Measures latency and bandwidth to the server and reports them to the server.

```text
延迟 32 ms · 带宽 85 Mbps（已上报服务器，仅管理员可见）
```

This reads "Latency 32 ms · bandwidth 85 Mbps (reported to the server, visible to admins only)".

## gg workspaces

```text
Usage: gg workspaces [OPTIONS]

Options:
      --delete <GROUP/BOT>    Delete the removed / unused managed workspaces of <group>/<bot> (ids or names). /cd dirs are never deleted
      --reset-cd <GROUP/BOT>  Point a /cd-bound <group>/<bot> back at its managed clone (same as `/cd @bot --reset`)
```

Without options, lists this machine's workspaces and local backups:

```text
todo-app 开发群 × 前端小助手	托管	/Users/wanglei/.gonggong/workspaces/…	空闲

本机备份 · 不上传
（无）
```

Each row shows group × Bot, type (托管 managed), path, and status (空闲 idle). The 「本机备份 · 不上传」 (Local backups · not uploaded) section here is empty (（无） "none").

| Option | Description |
| --- | --- |
| `--delete <group/Bot>` | Deletes the managed workspaces of that "group × Bot" that have been removed or are unused. Group and Bot can be IDs or names. Directories bound with `/cd` are never deleted |
| `--reset-cd <group/Bot>` | Switches a `/cd`-bound Bot back to its managed workspace, same as `/cd @bot --reset` in the group; the result is posted to the group. Mutually exclusive with `--delete` |

```bash
gg workspaces --delete "todo-app 开发群/前端小助手"
gg workspaces --reset-cd "todo-app 开发群/前端小助手"
```

When the server can't be reached, workspaces are listed by local directory only, and group and Bot names can't be shown. For the workspace concept, see [Repositories and workspaces](/en/user/repos-workspaces).

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
# 已导出诊断包 /Users/wanglei/Desktop/gonggong-diag-20260930-101500.zip（logs/…、diag.json、versions.json、config.json、local.json）
```

The last line is the output: "Exported diagnostics bundle /Users/wanglei/Desktop/gonggong-diag-20260930-101500.zip (logs/…, diag.json, versions.json, config.json, local.json)".

For the bundle's contents, see [Local data and logs](/en/cli/local-data#diagnostics-bundle).

## gg config

Local settings. A value of `default` restores the default.

### gg config agent

```text
Usage: gg config agent --path <PATH> <KIND>
```

Specifies the path to an Agent CLI instead of finding it on PATH automatically. `KIND` is `claude` or `codex`. Models are chosen per Bot on the server, not here.

```bash
gg config agent claude --path /opt/tools/claude
# Claude Code · 路径 /opt/tools/claude
gg config agent claude --path default
# Claude Code · 路径 自动检测
```

The output lines read "Claude Code · path /opt/tools/claude" and "Claude Code · path auto-detect".

A path that doesn't exist fails with 「找不到 …」 ("not found: …"). The setting is saved in `~/.gonggong/local.json` and is the same setting as 「更换路径…」 (Change path…) on the desktop app's 「Agent」 page.

## gg provider

Manages this machine's model providers (third-party service URLs and API keys). Providers are stored only on this machine and never leave it; see [Provider config stays on this machine](/en/desktop/permissions#provider-config-stays-on-this-machine).

```text
Commands:
  presets  List the built-in vendors (adapted from CC Switch's presets)
  list     List this machine's providers, defaults and bot overrides (keys masked)
  add      Add a provider from a preset (--preset) or by hand (--name + --base-url); the API key is read from stdin
  edit     Change a provider; sessions using it restart their adapter and resume with the change
  rm       Delete a provider; sessions using it start a new session on their next turn
  use      Machine default: `use <claude|codex> <id|official>`; bot override: `use --bot <bot> <id|official|inherit>`
  import   Import from this machine's CC Switch (`cc-switch`: previews unless --all / --ids) or a `ccswitch://` link
```

Below, `AGENT` is always `claude` or `codex`.

### gg provider presets

`gg provider presets [AGENT]`: lists the built-in vendor presets (ID, name, category, Base URL, default model).

```text
Claude Code
  kimi	Kimi	国内厂商	https://api.moonshot.cn/anthropic	kimi-k2.7-code
  deepseek	DeepSeek	国内厂商	https://api.deepseek.com/anthropic	deepseek-v4-pro
  …
```

国内厂商 is the category "Chinese vendors".

### gg provider list

`gg provider list [AGENT]`: lists this machine's providers (keys masked), with `*` marking the machine default; per-Bot overrides are listed too, if any.

```text
Claude Code · 本机默认：官方登录
Codex · 本机默认：官方登录
```

This reads "machine default: official sign-in" for each Agent.

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
gg provider use codex official           # switch Codex back to official sign-in
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
- [FAQ and troubleshooting](/en/guide/faq)
