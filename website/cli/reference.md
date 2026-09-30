# 命令参考

本页列出命令行 `gg` 的全部子命令、参数和输出示例。

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

任何子命令后加 `--help` 查看它的帮助，例如 `gg logs --help`。命令的提示和输出是中文，帮助文本是英文。

| 命令 | 需要先绑定 | 说明 |
| --- | --- | --- |
| [`gg login`](#gg-login) | — | 绑定本机 |
| [`gg logout`](#gg-logout) | — | 解除本机绑定 |
| [`gg status`](#gg-status) | — | 查看绑定状态 |
| [`gg run`](#gg-run) | 是 | 运行 daemon，接任务 |
| [`gg bots`](#gg-bots) | 是 | 列出本机 Bot |
| [`gg agents`](#gg-agents) | — | 检测、安装、升级 Agent 工具，设置镜像源 |
| [`gg doctor`](#gg-doctor) | — | 自检 |
| [`gg net`](#gg-net) | 是 | 测量延迟与带宽 |
| [`gg workspaces`](#gg-workspaces) | 是 | 列出、清理工作区 |
| [`gg logs`](#gg-logs) | — | 查看日志、导出诊断包 |
| [`gg config`](#gg-config) | — | 本机设置 |
| [`gg provider`](#gg-provider) | 部分 | 管理本机模型供应商 |

需要先绑定的命令在未绑定时会提示「尚未绑定，请先执行 gg login」。

## gg login

用网页生成的一次性绑定码，把本机绑定到你的账号。

```text
Usage: gg login [OPTIONS] [LINK]

Arguments:
  [LINK]  The 接入链接 copied from the Web

Options:
      --server <SERVER>
      --code <CODE>
      --fingerprint <FINGERPRINT>  Expected server certificate SHA-256 (sha256:AB:CD:…) as published by the admin
```

两种写法，任选其一：

```bash
# 1. 直接传接入链接（网页「绑定新机器」→「使用命令行」里复制的就是这种）
gg login 'gonggong://bind?server=https%3A%2F%2Fgg.example.com&code=K7QM-4X2P'

# 2. 分别传服务器和绑定码
gg login --server https://gg.example.com --code K7QM-4X2P
```

| 参数 | 说明 |
| --- | --- |
| `LINK` | 接入链接。与 `--server`、`--code`、`--fingerprint` 互斥 |
| `--server` | 服务器地址，必须与 `--code` 同时使用。非本机地址只允许 `https://` |
| `--code` | 绑定码，格式 `XXXX-XXXX`，大小写不限 |
| `--fingerprint` | 管理员公布的服务器证书 SHA-256 指纹，如 `sha256:AB:CD:…`。指定后证书不一致会直接失败 |

输出示例：

```text
绑定成功：本机已归属 王磊（wanglei-mbp）
已固定服务器证书 sha256:AB:CD:…
请与管理员公布的指纹核对；不一致请立即执行 gg logout 并联系管理员
```

- 不带 `--fingerprint` 时，信任服务器当前出示的证书并固定下来，打印指纹供你核对。
- 这台机器之前绑定过（执行过 `gg logout`）时会恢复原有机器记录，输出「已恢复本机原有机器记录（…），原有 Bot 绑定保持不变」。
- 绑定码一次性有效、会过期，失效了在网页上重新生成。

## gg logout

解除本机绑定，删除本机保存的凭据（`~/.gonggong/config.json`）。

```bash
gg logout
# 已退出登录；再次 gg login 会恢复这台机器及其 Bot
```

会尽量通知服务器；通知失败时仍会删除本机凭据，并提示「如需停用该机器请在 Web 端移除」。`gg logout` 不删除工作区和备份；桌面端的「解除绑定…」会同时清除托管工作区。

## gg status

查看本机绑定到哪个服务器、归属谁。

```text
已绑定：https://gg.example.com · 归属 王磊 · 机器 <机器 ID>
```

未绑定时输出「未绑定」。

## gg run

连接服务器，运行派到本机的 Bot。**这个进程要一直开着**，关掉后本机 Bot 显示离线。

```bash
gg run
```

- 同一台机器只能运行一个 daemon。桌面端在运行时执行 `gg run` 会报错「本机已有共工空间 daemon 在运行（…gg run 或桌面端），同一台机器只能运行一个」。
- 按 Ctrl-C 或收到 SIGTERM 时，会先停掉 Bot 启动的托管服务再退出。
- 被服务器拒绝时退出并打印原因。若机器被吊销（账号停用或机器被吊销），会清除托管工作区与本机凭据，并逐条列出删除的路径。
- 日志同时写到 `~/.gonggong/logs/`，见 [本地数据与日志](/cli/local-data)。
- 服务器发布新版本后会自动升级，见 [自动升级](/cli/#自动升级)。

## gg bots

列出绑定到本机的 Bot。Bot 在网页上管理。

```text
前端小助手	Claude Code	在线	命令审批 每次询问
	在 Web 中管理：https://gg.example.com/?bot=<Bot ID>
```

状态可能是：在线、运行中、离线、本机未安装该 agent、待绑定、待确认 · 请在 Web 中确认。本机没有 Bot 时输出「本机还没有 Bot」。

## gg agents

不带子命令时，列出本机 Node.js、Claude Code、Codex 的检测结果。

```text
Node.js	24.15.0	最新 24.21.0（可升级）	自行安装	~/.nvm/versions/node/v24.15.0/bin/node
Claude Code	2.1.285	已是最新	自行安装	~/.nvm/versions/node/v24.15.0/bin/claude	可选模型待探测（daemon 运行时自动探测）
Codex	0.156.1	最新 0.159.2（可升级）	自行安装	~/.nvm/versions/node/v24.15.0/bin/codex	可选模型待探测（daemon 运行时自动探测）
```

各列依次是：名称、版本、最新版本、来源（共工空间托管 / 自行安装）、路径、可选模型。Node.js 低于 22 时末尾会提示「ACP 适配器需要 Node.js ≥ 22」。

### gg agents install

```text
Usage: gg agents install <KIND>

Arguments:
  <KIND>  [possible values: node, claude, codex]

Options:
      --version <VERSION>  Exact version (x.y.z); the latest by default
```

从镜像源安装共工空间托管版，装在 `~/.gonggong/` 下，不需要管理员权限，也不影响系统里已有的版本。

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

把共工空间托管版升级到最新版本。必须指定 `KIND` 或 `--all`（二者互斥）。自行安装的版本请用你原来的方式升级。

### gg agents mirror

```text
Usage: gg agents mirror [OPTIONS] [VALUE]

Options:
      --node-mirror <URL>  Node.js download base of a custom mirror (where index.json lives)
```

查看或设置安装 Node.js、Claude Code、Codex 以及 ACP 适配器时的下载源：

```bash
gg agents mirror                 # 查看当前镜像源
gg agents mirror npmmirror       # 淘宝镜像（默认）
gg agents mirror official        # 官方源
gg agents mirror https://registry.example.com --node-mirror https://example.com/mirrors/node   # 自定义
```

```text
镜像源：淘宝镜像（npmmirror）
npm	https://registry.npmmirror.com
Node.js	https://npmmirror.com/mirrors/node
```

自定义镜像必须同时给出 npm registry 地址和 `--node-mirror`（`index.json` 所在目录）；`--node-mirror` 不能与 `npmmirror` / `official` 一起用。设置保存在 `~/.gonggong/settings.json`，与桌面端「设置」里的「镜像源」是同一项。

## gg doctor

检查服务器连接、Agent、git 凭据、磁盘和换行符；macOS 上还检查屏幕录制、辅助功能权限。

```text
✓ 服务器连接	WSS 正常 · 证书固定通过
✓ Agent	Claude Code 2.1.285 · Codex 0.156.1 可用
- git 凭据	本机暂无托管仓库
✓ 磁盘	工作区 0 B · 剩余 880 GB
- 换行符	本机暂无托管仓库
✓ 屏幕录制	已授权
✓ 辅助功能	已授权
```

标记含义：`✓` 正常，`!` 注意，`✗` 异常，`-` 跳过。有任一项异常时退出码为 1。未绑定时「服务器连接」显示「未绑定，请先执行 gg login」。

## gg net

测量到服务器的延迟和带宽，并上报服务器。

```text
延迟 32 ms · 带宽 85 Mbps（已上报服务器，仅管理员可见）
```

## gg workspaces

```text
Usage: gg workspaces [OPTIONS]

Options:
      --delete <GROUP/BOT>    Delete the removed / unused managed workspaces of <group>/<bot> (ids or names). /cd dirs are never deleted
      --reset-cd <GROUP/BOT>  Point a /cd-bound <group>/<bot> back at its managed clone (same as `/cd @bot --reset`)
```

不带参数时列出本机工作区和本机备份：

```text
todo-app 开发群 × 前端小助手	托管	/Users/wanglei/.gonggong/workspaces/…	空闲

本机备份 · 不上传
（无）
```

| 参数 | 说明 |
| --- | --- |
| `--delete <群/Bot>` | 删除该「群 × Bot」已移出或未使用的托管工作区。群和 Bot 可以写 ID 或名称。`/cd` 绑定的目录永远不会被删除 |
| `--reset-cd <群/Bot>` | 让 `/cd` 绑定的 Bot 改回托管工作区，效果同群里的 `/cd @bot --reset`，结果见群消息。与 `--delete` 互斥 |

```bash
gg workspaces --delete "todo-app 开发群/前端小助手"
gg workspaces --reset-cd "todo-app 开发群/前端小助手"
```

无法连接服务器时只按本机目录列出，群与 Bot 名称显示不出来。工作区的概念见 [仓库与工作区](/user/repos-workspaces)。

## gg logs

```text
Usage: gg logs [OPTIONS]

Options:
      --level <LEVEL>        [default: info] [possible values: error, warn, info, debug]
      --lines <LINES>        [default: 200]
      --export [<PATH.zip>]  Write a diagnostics .zip (redacted logs, checks, versions, config without the token)
```

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--level` | `info` | 显示该级别及更严重的日志：`error` / `warn` / `info` / `debug` |
| `--lines` | `200` | 显示最近多少行 |
| `--export [路径.zip]` | — | 导出诊断包。不写路径时保存到桌面（没有桌面目录则为用户主目录），文件名 `gonggong-diag-<日期-时间>.zip` |

```bash
gg logs --level warn --lines 50
gg logs --export
# 已导出诊断包 /Users/wanglei/Desktop/gonggong-diag-20260930-101500.zip（logs/…、diag.json、versions.json、config.json、local.json）
```

诊断包内容见 [本地数据与日志](/cli/local-data#诊断包)。

## gg config

本机设置。值写 `default` 表示恢复默认。

### gg config agent

```text
Usage: gg config agent --path <PATH> <KIND>
```

指定 Agent CLI 的路径，代替在 PATH 中自动查找。`KIND` 为 `claude` 或 `codex`。模型在服务器上为 Bot 选择，不在这里设置。

```bash
gg config agent claude --path /opt/tools/claude
# Claude Code · 路径 /opt/tools/claude
gg config agent claude --path default
# Claude Code · 路径 自动检测
```

路径不存在会报错「找不到 …」。设置保存在 `~/.gonggong/local.json`，与桌面端「Agent」页的「更换路径…」是同一项。

## gg provider

管理本机的模型供应商（第三方服务地址和 API Key）。供应商只保存在本机，不会离开这台机器，见 [供应商配置只存本机](/desktop/permissions#供应商配置只存本机)。

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

下文 `AGENT` 均为 `claude` 或 `codex`。

### gg provider presets

`gg provider presets [AGENT]`：列出内置厂商预设（ID、名称、分组、Base URL、默认模型）。

```text
Claude Code
  kimi	Kimi	国内厂商	https://api.moonshot.cn/anthropic	kimi-k2.7-code
  deepseek	DeepSeek	国内厂商	https://api.deepseek.com/anthropic	deepseek-v4-pro
  …
```

### gg provider list

`gg provider list [AGENT]`：列出本机供应商（Key 已打码），`*` 标出本机默认；有 Bot 单独设置时一并列出。

```text
Claude Code · 本机默认：官方登录
Codex · 本机默认：官方登录
```

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

从预设（`--preset`）或手动（`--name` + `--base-url`）新增，二者选一。API Key **必须**通过 `--key-stdin` 从标准输入传入，避免留在 shell 历史里。

```bash
# 从预设新增，并设为本机默认
printf '%s\n' "$DEEPSEEK_KEY" | gg provider add claude --preset deepseek --key-stdin --default

# 手动新增
printf '%s\n' "$MY_KEY" | gg provider add codex --name 公司网关 --base-url https://llm.example.com/v1 --model gpt-5 --key-stdin
```

### gg provider edit

`gg provider edit <ID> [--name …] [--base-url …] [--model …] [--key-stdin]`：修改供应商，至少给出一项。正在使用它的会话会重启适配器后继续。

### gg provider rm

`gg provider rm <ID>`：删除供应商。正在使用它的会话下一轮会自动开启新会话。

### gg provider use

设置本机默认，或为某个 Bot 单独设置：

```bash
gg provider use claude deepseek          # Claude Code 的本机默认改为 deepseek
gg provider use codex official           # Codex 改回官方登录
gg provider use --bot 前端小助手 kimi     # 该 Bot 单独使用 kimi
gg provider use --bot 前端小助手 inherit  # 该 Bot 改回继承本机默认
```

`--bot` 可写 Bot 的 ID 或名称，需要先 `gg login`（要向服务器查询 Bot 使用的 Agent）。切换不影响进行中的会话；仍有群的会话使用旧供应商时会列出这些群，开启新会话后才切换。

### gg provider import

```text
Usage: gg provider import [OPTIONS] <SOURCE>

Options:
      --all
      --ids <IDS>    Keys from the preview, comma separated
      --set-default  Also make the imported current provider (CC Switch's, or the link's) this machine's default
```

`SOURCE` 为 `cc-switch`（从本机 CC Switch 导入）或一条 `ccswitch://` 链接。

```bash
gg provider import cc-switch                      # 只预览可导入的项
gg provider import cc-switch --all --set-default  # 全部导入，并把 CC Switch 当前使用的设为本机默认
gg provider import cc-switch --ids kimi,deepseek  # 按预览里的 key 选择导入
gg provider import 'ccswitch://…' --set-default   # 从链接导入
```

## 相关页面

- [命令行安装](/cli/)
- [本地数据与日志](/cli/local-data)
- [绑定机器](/user/bind-machine)
- [常见问题与排查](/guide/faq)
