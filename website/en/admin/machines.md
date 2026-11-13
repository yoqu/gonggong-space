# Machines

This page covers the 「机器」 (Machines) page: viewing the OS, version, online status, and network quality of every member's machine, dealing with outdated daemons, and revoking a machine.

![Admin console · Machines](/screenshots/web/admin-machines.webp)

## Machine list

The page title is 「机器与网络」 (Machines & network). The toolbar shows 「N 台 · M 台在线」 ("N machines · M online"), and the list refreshes automatically every 15 seconds. Use the search box in the top-right corner to filter by machine name, hostname, or owner.

| Column | Description |
| --- | --- |
| 主人 (Owner) | The member the machine belongs to |
| 机器 (Machine) | Machine name (the hostname unless renamed; hover to see the hostname) |
| 系统 (System) | Operating system and version |
| 硬件 (Hardware) | CPU model, core count, memory |
| daemon | daemon version. Versions with an outdated protocol are highlighted as a warning |
| Agent 版本 (Agent versions) | Versions of each Agent available on the machine; shows 「可升级」 (Update available) when a newer version exists. Hover to see the latest version and whether it's 「共工空间托管 / 自行安装」 (Managed by Gonggong Space / Self-installed) |
| 延迟 / 带宽 (Latency / Bandwidth) | Result of the most recent network measurement; hover to see when it was measured |
| 状态 (Status) | 在线 (Online) / 离线 (Offline) |
| 最后心跳 (Last heartbeat) | 「刚刚」 (just now) when online; how long ago when offline; 「从未连接」 (Never connected) if it never connected |

Revoked machines don't appear in the list.

### Network quality

Latency and bandwidth are measured by members on their own machines and reported: run `gg net` on the command line, or click 「测量延迟与带宽」 (Measure latency and bandwidth) in the desktop app. Results are shown only here, never in groups.

## Machine details

Double-click a row, or select it and click 「机器详情…」 (Machine details…) in the toolbar, to open that machine's page (the same page the machine owner sees). A banner at the top says 「正在以管理员身份查看 某人 的机器」 ("Viewing someone's machine as an admin"); click 「返回后台」 (Back to admin) to return to the list.

Sysadmins see only 「概览」 (Overview) here: system info, online status, the Bots it runs, and version info; they can rename or revoke the machine. 「Agent 与供应商」 (Agents & providers), 「工作区」 (Workspaces), 「Git 访问」 (Git access), 「诊断」 (Diagnostics), 「插件授权」 (Plugin permissions), and the terminal are available only to the machine owner; admins can't install tools, change providers, or upgrade the daemon on their behalf. Provider keys, URLs, and so on are stored only locally on the member's machine, never on the server. For what machine owners can do, see [My machines and Bots](/en/user/machines).

## daemon versions and upgrades

### Outdated protocol warning

When a daemon's protocol version is lower than the server's, the server refuses its connection, and a yellow notice 「N 台 daemon 协议版本过旧」 ("N daemons on an outdated protocol") appears at the bottom of the page, listing the machine name, version, and protocol version.

### How to upgrade machines

First upload the new version in [Client releases](/en/admin/releases). After that, each kind of machine upgrades differently (「如何升级」 (How to upgrade) under 「概览」 (Overview) on the machine page gives instructions for that machine type):

| Machine | How it upgrades |
| --- | --- |
| Command-line `gg` (macOS / Linux / Windows) | Downloads the new version automatically while online and restarts to finish once no tasks are running; a daemon rejected for an outdated protocol upgrades immediately |
| Linux command-line daemon | Besides auto-upgrade, the machine owner can click 「立即升级」 (Upgrade now) on the machine page: after downloading, it restarts automatically when idle, without interrupting running tasks |
| daemon in a Docker container | Newer images keep `gg` on the data volume, so the machine owner can also 「立即升级」 (Upgrade now) from the web, and it survives container rebuilds; older images require changing `GG_VERSION` on the server and rebuilding the container; see [Docker deployment](/en/deploy/docker) |
| Desktop app | The desktop app updates as a whole app; see [Client releases](/en/admin/releases#desktop-auto-update) |

For machines with auto-upgrade turned off, the machine owner needs to restart the daemon or replace `gg` manually; see [CLI installation](/en/cli/).

## Revoke a machine

If a machine is lost, a member leaves, or you suspect a token has leaked, you can revoke the machine:

1. Choose 「吊销机器…」 (Revoke machine…) from the row's menu, or click 「吊销」 (Revoke) on the machine page.
2. In the confirmation dialog 「要吊销机器 xxx 吗？」 ("Revoke machine xxx?"), click 「吊销」 (Revoke).

After revocation:

- The machine's daemon disconnects immediately and its token becomes invalid.
- The daemon cleans up the managed workspaces on that machine; directories set with `/cd` and backups are kept.
- To use the machine again, the member must generate a new connect link and bind it; see [Bind a machine](/en/user/bind-machine).

Revocations are written to the [audit log](/en/admin/audit). To disconnect all of a member's machines and sessions at once, [disable the account](/en/admin/users#disable-and-enable) instead.

## Related pages

- [My machines and Bots](/en/user/machines)
- [Bind a machine](/en/user/bind-machine)
- [Client releases](/en/admin/releases)
- [Command reference](/en/cli/reference)
