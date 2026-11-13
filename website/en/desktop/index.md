# Desktop app overview and installation

This page explains what the Gonggong Space desktop app is, how to install it, what to do the first time you open it, how it upgrades, and how it relates to the `gg` command line.

## What the desktop app is

The desktop app is an application with a built-in daemon, available for macOS and Windows. Once it's installed, **you don't need to install the `gg` command line**, and you don't need to keep a terminal window open:

- **Built-in daemon**: the app itself is this machine's executor. It receives tasks dispatched to Bots on this machine and runs them with local Agents such as Claude Code and Codex.
- **Stays in the background**: closing the window leaves the app running in the background. The menu bar icon (the system tray icon on Windows) has two items, 「打开」 (Open) and 「退出」 (Quit). On macOS, clicking the Dock icon also brings the window back.
- **Graphical view and management**: you can view this machine's Agents, Bots, workspaces, tunnels & services, live views, market, logs and diagnostics, and settings in the window. See [Pages](/en/desktop/pages).
- **Streaming component included**: gg-cast, which Bots use to stream live views of desktop apps and mini programs, is bundled with the macOS installer. No separate download is needed.

![Desktop app overview](/screenshots/desktop/overview.webp)

## Supported platforms

| Platform | Installer |
| --- | --- |
| macOS · Apple silicon (M series) | `Gonggong_<version>_aarch64.dmg` |
| macOS · Intel | `Gonggong_<version>_x86_64.dmg` |
| Windows (x64) | `Gonggong_<version>_x64-setup.exe` |

The two Mac installers are built, signed, and notarized separately, and each updates itself automatically. An installer for the wrong chip won't run. Not sure which chip you have? Click the Apple menu in the top-left corner of the screen → 「关于本机」 (About This Mac).

There is no desktop app for Linux; use the [`gg` command line](/en/cli/).

## Installation

1. Get the installer in either of these ways:
   - On the web, open 「绑定新机器」 (Bind new machine) → 「其他方式」 (Other ways) → 「① 安装客户端」 (① Install the client). It recommends an installer for your current system; you can switch under 「选择系统」 (Choose a system). Click 「下载」 (Download). If this space hasn't published a client yet, you'll see 「前往 GitHub 下载」 (Download from GitHub) instead.
   - Download directly from [GitHub Releases](https://github.com/yoqu/gonggong-space/releases/latest).
2. Install:
   - macOS: double-click the dmg, drag **共工空间** into the 「应用程序」 (Applications) folder, then open it from Applications.
   - Windows: double-click `setup.exe`, follow the setup wizard, then open Gonggong Space from the Start menu.
3. Complete binding by following [First-run setup](/en/desktop/onboarding).

::: tip App name
After installation, the app appears as 「共工空间」 in Finder, 「系统设置」 (System Settings), the window title, and the menu bar. Earlier versions were named Gonggong. After installing the new version, you can delete the old Gonggong from Applications; binding information is stored in `~/.gonggong` and is not affected. If system permissions show as not granted, re-grant them by following [Permissions and system settings](/en/desktop/permissions).
:::

## Blocked by the system on first launch (macOS)

Officially released macOS installers are signed and notarized, so you can open them with a double-click. If you got an unsigned or unnotarized build, macOS will say it 「无法打开」 (can't be opened) or 「无法验证开发者」 (can't verify the developer):

1. Double-click to open it once, then dismiss the prompt.
2. Open 「系统设置 → 隐私与安全性」 (System Settings → Privacy & Security), scroll to the bottom, and click 「仍要打开」 (Open Anyway).
3. Enter your password when prompted. After that, the app opens normally.

::: warning Builds not signed with a Developer ID
macOS ties Screen Recording and Accessibility permissions to the app's signature. Installers without a Developer ID signature have a different signature in every version, so **these two permissions stop working after an upgrade and must be granted again**. See [Permissions and system settings](/en/desktop/permissions).
:::

## Upgrades

The desktop app checks for updates on its own:

- **Where updates come from**: it first checks the bound server. If the server has published an update for this platform under 「客户端发布」 (Client releases), it downloads from the server; otherwise it checks GitHub Releases.
- **When it checks**: with 「自动升级」 (Auto upgrade) turned on in 「设置」 (Settings), it checks at startup and every 6 hours after that. You can also click 「检查更新」 (Check for updates) on the 「版本」 (Version) row in Settings.
- **How it takes effect**: the new version downloads in the background. When it's ready, a banner at the top of the window says 「新版本 vX.Y.Z 已下载，重启以更新」 ("Version vX.Y.Z has been downloaded. Restart to update"), with release notes. Click 「立即重启」 (Restart now) to finish the upgrade, or 「稍后」 (Later). If tasks are running on this machine, you're warned first: 「有运行中的任务，重启会中断」 ("Tasks are running. Restarting will interrupt them").
- **Skipping several versions**: it keeps checking while waiting for a restart, so if the app stays open for a long time across several releases, a restart takes you straight to the latest.

## Quitting and launch at login

- **Closing the window doesn't quit**: the daemon keeps running in the background and this machine's Bots stay online.
- **Quit completely**: click the Gonggong Space icon in the menu bar (the system tray on Windows) and choose 「退出」 (Quit). After quitting, this machine's Bots show as offline and group messages wait in the queue.
- **Launch at login**: turn on 「开机启动」 (Launch at login) in Settings to run in the background automatically after you log in.
- **Hide the Dock icon** (macOS only): turn on 「关闭窗口后隐藏程序坞图标」 (Hide the Dock icon when the window closes) in Settings. After you close the window, only the menu bar icon remains; choose 「打开」 (Open) from the menu bar to get the window back. Background services keep running. Off by default.

## Desktop app or `gg` command line

The desktop app and the `gg` command line share the same local data (`~/.gonggong/`), including binding information. As a result:

- **Only one daemon can run on a machine.** If you open the desktop app while `gg run` or `gg service` is running, the Overview page shows 「daemon 未运行」 ("Daemon not running"), meaning another daemon is already running on this machine. Stop the command-line daemon first (`gg service uninstall`, or end `gg run`), then click 「重试」 (Retry).
- If the machine was already bound with `gg login`, the desktop app reuses that binding; you don't need to bind again.
- Mac and Windows users should use the desktop app; use the command line on Linux, servers, and other environments without a graphical interface.

| | Desktop app | `gg` command line |
| --- | --- | --- |
| Platforms | macOS (Apple silicon / Intel), Windows | macOS / Linux / Windows |
| Running in the background | Stays in the menu bar / system tray after the window closes; can launch at login | Register as a background service with `gg service install`, or run `gg run` in the foreground |
| Live view streaming component | Bundled with the macOS installer | Downloaded from the server on the first stream |
| Upgrades | The app updates itself; takes effect after a restart | Downloads the new version and replaces itself automatically; on Linux you can also upgrade with one click on the web |

## Related pages

- [First-run setup](/en/desktop/onboarding)
- [Pages](/en/desktop/pages)
- [Permissions and system settings](/en/desktop/permissions)
- [Command line installation](/en/cli/)
- [Bind a machine](/en/user/bind-machine)
- [My machines and Bots](/en/user/machines)
