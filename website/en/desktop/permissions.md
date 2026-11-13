# Permissions and system settings

This page explains which system permissions the desktop app needs on macOS and how to grant them, why model provider configuration is stored only on this machine, and how Agent CLIs are found when the app is launched from the Dock.

## Which system permissions are needed

System permissions are needed only when **Bots stream live views and members control them remotely**. Without them, everything else works: Bots still read code, edit files, run commands, and open web previews.

| Permission | Used for | Without it |
| --- | --- | --- |
| 屏幕录制 (Screen Recording) | Streaming live views of desktop apps and mini programs | Members see nothing |
| 辅助功能 (Accessibility) | Remote control of desktop apps and mini programs, and auto-trusting mini program projects | Remote clicks and typing do nothing |

These two permissions are granted to the Gonggong Space desktop app itself. The streaming component gg-cast is started by the desktop app and inherits the same grant, so it doesn't need a separate one. Windows doesn't need these permissions, and the related prompts never appear there.

## How to grant them

After binding, if any permission isn't granted, the desktop app opens the 「授予系统权限」 (Grant system permissions) page automatically. You can also get there later from the 「未授权：…」 ("Not granted: …") banner at the top of Overview, 「系统权限」 (System permissions) on the 「实时画面」 (Live views) page, or the diagnostic items on the 「日志与诊断」 (Logs & diagnostics) page; click 「去授权」 (Grant) in any of them.

1. On the 「授予系统权限」 (Grant system permissions) page, click 「去授权」 (Grant) next to a permission.
2. macOS shows a system prompt, or opens the matching page under 「系统设置 → 隐私与安全性」 (System Settings → Privacy & Security) (Screen Recording or Accessibility).
3. Find **共工空间** in the list, turn on its switch, and enter your password when prompted.
4. Return to the Gonggong Space window; the status refreshes to 「已授权」 (Granted) automatically.
5. **Screen Recording takes effect only after Gonggong Space restarts**: after granting Screen Recording, click 「重启共工空间」 (Restart Gonggong Space) on the page.
6. When everything is granted, click 「完成」 (Done). To skip for now, click 「稍后」 (Later).

::: tip Can't find 共工空间 in the list?
Click 「去授权」 (Grant) once in Gonggong Space first. The desktop app registers itself in the system's permission list, and then you can find it in System Settings.
:::

::: warning Permissions lost after an upgrade
macOS records these two grants by app signature. Installers signed with a Developer ID certificate keep the grants across upgrades; installers without a Developer ID signature have a different signature in every version, so **you need to grant them again after an upgrade**. If live views stop streaming after an upgrade, first check the permission status on the 「实时画面」 (Live views) page.
:::

::: details Permissions when using the `gg` command line
When you run `gg run` from the command line, macOS attributes the permissions to the program running `gg` (such as Terminal or iTerm), so you need to allow that terminal program under 「系统设置 → 隐私与安全性 → 屏幕录制 / 辅助功能」 (System Settings → Privacy & Security → Screen Recording / Accessibility). `gg doctor` shows whether these two are granted.
:::

## Provider config stays on this machine

A machine's model providers (third-party model service addresses, API keys, models, and providers used by individual Bots) are **stored only on that machine**:

- They're saved in `~/.gonggong/providers.json` on this machine, readable and writable only by you (0600).
- They're not uploaded to the server or synced to your other machines. Each machine needs its own configuration.
- API keys shown on the page are masked; when editing, leaving the API key empty keeps the saved key.
- At run time, keys are passed to the Agent only through local files or child-process environment variables, and never appear in command-line arguments, logs, or error messages.
- Adding and editing providers happens on the machine page on the web: the web only forwards the action to this machine's daemon, which reads and writes the local file; the server never stores keys. When the machine is offline, you can't manage its providers on the web. On the desktop app's 「Agent」 and 「Bot」 pages, you can switch this machine's default provider and the provider used by each Bot.

When you switch machines or reinstall the system, configure providers again on the new machine. For the web steps, see [Agent tools and providers](/en/user/agents-providers); for the command-line equivalents, see [Command reference](/en/cli/reference).

## Other system-related settings

- **Launch at login**: the 「开机启动」 (Launch at login) switch in 「设置」 (Settings). When on, the app starts in the background when you log in and can take tasks without opening a window.
- **Agent CLI not found**: apps opened from Finder or the Dock don't get your terminal's PATH. At startup, the desktop app reads the PATH from your login shell, and also looks in `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.npm-global/bin`, and the usual install directories of nvm, volta, fnm, asdf, pnpm, and bun. So Node.js and Agent CLIs installed with these tools are found even when the app is launched from the Dock. If it still can't find one, use 「手动指定路径…」 (Specify path…) on the 「Agent」 page.

## Related pages

- [Pages](/en/desktop/pages)
- [Previews](/en/user/previews)
- [Agent tools and providers](/en/user/agents-providers)
- [Local data and logs](/en/cli/local-data)
