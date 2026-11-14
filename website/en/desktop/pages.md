# Pages

This page walks through each page in the desktop app's left sidebar and what it's for.

The left sidebar has three groups: 「概览」 (Overview); the 「执行」 (Execution) group, with 「Agent」, 「Bot」, 「工作区」 (Workspaces), 「穿透与服务」 (Tunnels & services), 「实时画面」 (Live views), and 「市场」 (Market); and the 「本机」 (This machine) group, with 「日志与诊断」 (Logs & diagnostics) and 「设置」 (Settings). The bottom of the sidebar shows the machine owner, the machine name, and the operating system.

The desktop app focuses on "what this machine is doing." Creating Bots, changing Bot settings, managing providers, installing Skills, and similar tasks happen on the web; 「在 Web 中管理」 (Manage on Web) and 「在网页中打开」 (Open on the Web) on these pages open the corresponding place in your browser. For managing machines on the web, see [My machines and Bots](/en/user/machines).

The connection status in the top-right corner of the window is visible on every page; the button next to it does 「在浏览器中打开共工」 (Open Gonggong in the browser):

| Status | Meaning |
| --- | --- |
| 已连接 服务器地址 (Connected to `<server address>`) | Online and able to take tasks |
| 连接中 / 重连中 (Connecting / Reconnecting) | Connecting; when the server is unavailable, it reconnects automatically with exponential backoff |
| 协议不兼容 (Protocol incompatible) | This machine's version is too old and the server refuses the connection; upgrade required |
| token 已吊销 / token 无效 (Token revoked / Invalid token) | The account was disabled or the machine was revoked; bind again |
| 未运行 (Not running) | Another daemon is already running on this machine (usually the `gg` command line) |
| 未绑定 (Not bound) | Not bound to a server yet |

The status bar at the bottom of the window shows the heartbeat, latency to the server, the number of running and queued tasks, the ACP adapter versions, and this machine's daemon version and protocol version.

## Overview

Status of this machine's runner and runs in progress.

![Overview](/screenshots/desktop/overview.webp)

- **Four stat cards**: Connection (online or not, and whether the connection is encrypted), Bots (number bound, number of available Agents), Concurrency (running / sum of the concurrency limits of this machine's Bots, plus the local queue length), and Workspaces (count, how many are managed vs. local folders, and disk usage).
- **Running**: each row is a run in progress, showing the Bot, group, requester, current step, and status (运行中 / 等待审批 / 等待回答, Running / Awaiting approval / Awaiting answer). Click a row to open that run's 「运行过程」 (Process), which matches the run details on the web; click 「返回」 (Back) to return to Overview.
- **Local queue**: tasks waiting in this machine's queue because the concurrency limit is reached, and their positions.
- **Banners**: when there's a connection problem, the daemon isn't running, system permissions aren't granted, or live view streaming fails, a banner appears at the top of the page with a matching button (such as 「重试」 (Retry), 「去授权」 (Grant), 「查看」 (View), or 「重新绑定」 (Bind again)).

## Agent

Node.js and CLI runtimes on this machine: install, upgrade, detection, and providers.

![Agent](/screenshots/desktop/agents.webp)

An Agent is a CLI runtime installed on this machine and decides which models are available; a Bot is an identity in the team that runs one of these Agents. From top to bottom, the page shows:

**Node.js**: runs the ACP adapters and the Agents that don't need an adapter (Gemini CLI, CodeBuddy, and so on), and is also used for managed installs of Agents. Version 22 or later is required. If this machine doesn't have a suitable Node.js, clicking 「安装」 (Install) installs the version managed by Gonggong Space into `~/.gonggong/runtime`, without touching the system environment.

**Each Agent**: Claude Code, Codex, Gemini CLI, CodeBuddy (WorkBuddy), pi, DeepSeek Harness, and Antigravity CLI each have a card. When installed, a card shows:

- Path, version (and whether it meets the minimum version), source (共工空间托管 / 自行安装, Managed by Gonggong Space / Self-installed), and latest version (marked 「有更新」 (Update available) when there's a newer one)
- Login status, ACP adapter (the adapters for Claude Code, Codex, and pi ship with the daemon; the others are 「CLI 自带」 (Built into the CLI)), and available models (models and reasoning effort are set per Bot on the web)
- Which Bots use it

Available actions:

| Button | What it does |
| --- | --- |
| 安装 (Install) | Shown when the Agent isn't detected on this machine. Installs the version managed by Gonggong Space from the mirror; no admin rights needed |
| 升级到 x.y.z (Upgrade to x.y.z) | Shown when a new version is available. Managed installs upgrade directly; self-installed ones upgrade the way they were installed. The card shows the 「升级命令」 (Upgrade command), which you can also run in a terminal yourself |
| 改用共工空间托管安装 (Switch to the Gonggong Space managed install) | Shown when upgrading a self-installed version fails |
| 重新检测 / 已安装，重新检测 (Detect again / Installed, detect again) | Detect again after you've just installed or upgraded in a terminal |
| 更换路径… / 手动指定路径… (Change path… / Specify path…) | Choose the CLI executable to use |
| 恢复自动检测 (Restore auto-detection) | Cancel the manually specified path |

Install and upgrade logs are shown live in the card. The download source is set by 「镜像源」 (Mirror) in Settings.

**Machine providers**: below each Agent card is the list of its providers (except pi, which uses its own login: run `pi` on this machine and type `/login` to sign in or enter an API key). The selected one is this machine's default and is used by new sessions:

- 「官方登录」 (Official login): uses the CLI's own login and configuration on this machine.
- The rest are providers added on the web, showing the address, model, and masked key, or 「本机 Claude 配置目录」 (Local Claude configuration directory).

Here you can only switch this machine's default. To add, edit, or delete providers, click 「在 Web 中管理」 (Manage on Web) and do it on the machine page on the web; see [Agent tools and providers](/en/user/agents-providers). Switching doesn't interrupt ongoing sessions: if any group's session is still using the old provider, a dialog first lists the affected groups, and after you confirm, only new sessions use the new provider.

**Agent settings** (for Agents that support them, such as Claude Code): a read-only view of this machine's default Agent settings, and whether 「继承本机 CLI 配置」 (Inherit local CLI config) is on (which loads the personal config, CLAUDE.md, memory, hooks, and Skills under `~/.claude`). They apply to new sessions, and Bots can override some of them on the web. If settings in the local CLI config override the corresponding Gonggong settings, you'll see a notice here. To change them, also click 「在 Web 中管理」 (Manage on Web).

## Bot

Bots running on this machine and their providers; change other settings on the web.

![Bot](/screenshots/desktop/bots.webp)

Each Bot assigned to this machine has a card:

- **Status**: 在线 / 运行中 / 离线 / agent 缺失 / 待确认 (Online / Running / Offline / Agent missing / Pending confirmation).
- **Team**: the team the Bot belongs to.
- **Agent**: the Agent used and its version. If it isn't installed on this machine, it's shown in red with a 「前往 Agent」 (Go to Agent) button.
- **Provider**: a dropdown with 「继承机器（当前：…）」 (Inherit from machine (currently: …)), 「官方登录」 (Official login), or one of this machine's providers. It's stored only on this machine; ongoing sessions switch once a new session starts.
- **Concurrency limit, approval**: shown read-only.
- 「在 Web 中管理」 (Manage on Web): opens this Bot's settings on the web. A Bot someone else created for you shows 「待确认」 (Pending confirmation), and the button becomes 「在 Web 中确认」 (Confirm on Web).

Name, role description, model, concurrency limit, approval, and so on are changed on the web; see [Bot settings and permissions](/en/user/bot-settings).

## Workspaces

One managed directory per "group × Bot", or a bound local directory.

![Workspaces](/screenshots/desktop/workspaces.webp)

The table lists all workspaces on this machine: group, Bot, type (托管 / 托管 · 无仓库 / 本机目录, Managed / Managed · no repo / Local folder), path, status (运行中 / 空闲 / 已移出 / 未使用, Running / Idle / Removed / Unused; the last two include their disk usage), and a context usage ring. Double-click a row to open it in Finder (File Explorer on Windows).

Managed workspaces live under `~/gonggong/workspaces/<group name>/<Bot name>/<repo name>`, so you can find them directly in Finder.

- **Managed workspace**: you can 「打开」 (Open) it. A managed workspace that has been removed or is unused can be deleted with 「删除…」 (Delete…); after you confirm, the directory is deleted from this machine. This only affects the local directory; messages and records in the group are not affected.
- **Local folder (bound with `/cd`)**: you can 「打开」 (Open) it, or use 「改回托管」 (Back to managed) to send the Bot back to its managed workspace; the result is posted as a group message. Local folders are never deleted.

Below, 「本机备份 · 不上传」 (Local backups · never uploaded) lists overwritten local changes and interrupted work. They're kept only on this machine; click 「在 Finder 中显示」 (Show in Finder) — 「在资源管理器中显示」 (Show in Explorer) on Windows — to view them.

If the server can't be reached, the top of the page shows 「无法连接服务器」 (Cannot connect to the server), group and Bot names can't be shown for now, and workspaces are listed by local directory only.

::: tip Disk usage and cleanup
Viewing usage per workspace, slimming, and bulk cleanup happen under 「工作区」 (Workspaces) on the machine page on the web; see [My machines and Bots](/en/user/machines). For the workspace concept, see [Repositories and workspaces](/en/user/repos-workspaces).
:::

## Tunnels & services

Preview tunnels and hosted services opened by Bots, which can be stopped here.

![Tunnels & services](/screenshots/desktop/tunnels.webp)

- **Preview tunnels**: web previews a Bot has opened to group members, showing the group, Bot, port, and online status. You can 「本机打开」 (Open locally) to visit it in this machine's browser, or 「停止穿透」 (Stop tunnel) — shown as 「停止穿透和服务」 (Stop tunnel and service) when there's a hosted service.
- **Hosted services**: background services a Bot has started (such as a dev server), showing status (启动中 / 运行中 / 已退出 / 启动失败, Starting / Running / Exited / Failed to start), port, and start command. You can 「停止」 (Stop) them.

Stopping here has the same effect as stopping in the group on the web; group members see the change immediately. For the preview feature, see [Previews](/en/user/previews).

## Live views

Desktop app and mini program views pushed by Bots: streaming component, system permissions, and stream status.

![Live views](/screenshots/desktop/live.webp)

- **Streaming component**: the status of gg-cast. Official macOS installers show 「已内置」 (Bundled), installed and upgraded together with Gonggong Space. When it isn't bundled, it shows 「未内置」 (Not bundled) and is downloaded from the server on the first stream (the server must upload gg-cast under 「客户端发布」 (Client releases)).
- **System permissions** (macOS only): whether Screen Recording and Accessibility are granted. If not, click 「去授权」 (Grant); see [Permissions and system settings](/en/desktop/permissions).
- **Live views opened by Bots**: each view shows its type (桌面应用 / 小程序, Desktop app / Mini program), stream status (无人观看 / 启动中 / 推流中 / 推流失败 / 等待操作, No viewers / Starting / Streaming / Streaming failed / Waiting for action), and who is controlling it remotely. A failed stream shows the reason and retries automatically. You can 「关闭」 (Close) it — shown as 「关闭并停止应用」 (Close and stop app) when there's a hosted app.

This machine streams a window only while a group member is watching the live view on the web; it stops automatically when nobody is watching.

## Market

My Skills and market listings, read-only; install, publish, and review on the web.

- At the top, you can search Skills and plugins, click 「刷新」 (Refresh) to reload, or click 「在网页中打开」 (Open on the Web) to jump to the market on the web.
- **My Skills**: listings you've installed for yourself, showing the type, version (following the latest or pinned to a version), notices such as a new version being available or the listing being banned, and 「已启用 / 已停用」 (Enabled / Disabled).
- **Market**: all listings in the market, showing the author, team, and install count; ones you've installed are marked 「已引入」 (Installed).
- Click any listing to open a read-only detail view: latest version, author, install count, supported Agents, and where it's installed. Click 「在网页中查看详情」 (View details on the Web) to install, upgrade, remove, or request it on the web.

If the server can't be reached, you'll see 「连不上服务器，请检查网络后刷新」 ("Cannot reach the server. Check the network, then refresh"). For full market usage, see [Market and plugins](/en/user/market-plugins).

## Logs and diagnostics

「日志与诊断」 (Logs & diagnostics): connection, ACP, git, and sync logs; run processes are redacted before being stored.

![Logs & diagnostics](/screenshots/desktop/logs.webp)

**Diagnostics**: the following checks run automatically when you open the page, which may take half a minute. Each is marked 正常 / 注意 / 异常 / 跳过 (OK / Warning / Error / Skipped):

| Check | What it checks |
| --- | --- |
| Server connection | Whether the server is reachable, and whether the connection is encrypted (HTTPS / HTTP) |
| Agent | Whether each Agent is installed and meets the version requirement |
| git credentials | Whether this machine's managed repositories can reach their remotes |
| Disk | Workspace usage and free space |
| Line endings | Whether `core.autocrlf` is turned off in managed repositories |
| Screen Recording, Accessibility | macOS only; whether they're granted |

Two buttons below:

- 「测量延迟与带宽」 (Measure latency and bandwidth): measures latency and bandwidth to the server; the result is reported to the server.
- 「导出诊断包…」 (Export diagnostics bundle…): choose where to save, then export a zip containing redacted logs, diagnostic results, version information, and the configuration with credentials removed. You can send it to your admin for troubleshooting.

**Recent logs**: live daemon logs. Switch between info / warn / debug levels in the top-right corner.

## Settings

Appearance, upgrades, mirror, startup, and storage locations.

![Settings](/screenshots/desktop/settings.webp)

| Setting | Description |
| --- | --- |
| 语言 (Language) | 中文 / English |
| 主题 (Theme) | 浅色 / 深色 / 跟随系统 (Light / Dark / System) |
| 玻璃效果 (Glass effect) | 清透 / 标准 / 着色 (Clear / Standard / Tinted); adjusts the transparency of the sidebar, menus, and overlays |
| 版本 (Version) | The current version. Click 「检查更新」 (Check for updates) to check now; once a new version has downloaded, click 「立即重启」 (Restart now) to finish the upgrade |
| 自动升级 (Auto upgrade) | Downloads new versions automatically; they apply after a restart |
| 开机启动 (Launch at login) | Runs in the background after you log in |
| 关闭窗口后隐藏程序坞图标 (Hide the Dock icon when the window closes) | macOS only. Keeps the menu bar icon so you can reopen the window from the menu bar; background services keep running |
| 镜像源 (Mirror) | Download source for installing and upgrading Node.js and Agent tools: 淘宝镜像（npmmirror） (Taobao mirror (npmmirror), default) / 官方源 (Official registry) / 自定义 (Custom). Custom requires an npm registry and a Node.js download URL (the directory containing `index.json`) |
| 环境变量 (Environment variables) | Added when an Agent starts, one `KEY=VALUE` per line. After you click 「保存」 (Save), they apply to newly started Agent processes |
| 工作区根目录 (Workspaces root) | Managed workspaces and attachments directory; read-only |
| 备份目录 (Backups) | Overwritten local changes and interrupted work; read-only |
| 服务器 (Server) | The currently bound server; outbound connections only (HTTPS / WSS) |

**「解除绑定…」 (Unbind…)**: after you confirm, this machine disconnects, clears the team secrets and managed workspaces (directories bound with `/cd` and local backups are kept), and returns to [First-run setup](/en/desktop/onboarding). This cannot be undone.

## Related pages

- [Desktop app overview and installation](/en/desktop/)
- [Permissions and system settings](/en/desktop/permissions)
- [My machines and Bots](/en/user/machines)
- [Agent tools and providers](/en/user/agents-providers)
- [Market and plugins](/en/user/market-plugins)
- [Local data and logs](/en/cli/local-data)
