# Permissions and system settings

This page explains which system permissions the desktop app needs on macOS, how to grant them, and why model provider configuration is stored only on this machine.

## Which system permissions are needed

System permissions are needed only when **Bots stream live views and members control them remotely**. Not granting them doesn't affect anything else: Bots still read code, edit files, run commands, and open web previews as usual.

| Permission | Used for | If not granted |
| --- | --- | --- |
| 屏幕录制 (Screen Recording) | Streaming live views of desktop apps and mini programs | Members can't see the view |
| 辅助功能 (Accessibility) | Remote control of desktop apps and mini programs; automatically trusting mini program projects | Remote clicks and typing have no effect |

Both permissions are granted to the Gonggong Space desktop app itself. The streaming component gg-cast is launched by the desktop app and inherits the same authorization, so it doesn't need to be granted separately. Windows and Linux don't need these permissions, and the related prompts don't appear there.

## How to grant them

After binding, if any permission isn't granted, the desktop app automatically opens the 「授予系统权限」 (Grant system permissions) page. You can also get there later from: the 「未授权：…」 ("Not granted: …") banner at the top of the Overview page, 「系统权限」 (System permissions) on the 「实时画面」 (Live view) page, or the diagnostic items on the 「日志与诊断」 (Logs & diagnostics) page. Click 「去授权」 (Grant) in any of them.

1. On the Grant system permissions page, click 「去授权」 (Grant) to the right of a permission.
2. macOS shows a system prompt, or directly opens the matching page under 「系统设置 → 隐私与安全性」 (System Settings → Privacy & Security): Screen Recording or Accessibility.
3. Find **共工空间** in the list, turn its switch on, and enter your password when prompted.
4. Return to the 共工空间 window; the status refreshes to 「已授权」 (Granted) automatically.
5. **Screen Recording takes effect only after restarting 共工空间**: after granting Screen Recording, click 「重启共工空间」 (Restart 共工空间) on the page.
6. Once everything is granted, click 「完成」 (Done). If you don't want to grant them yet, click 「稍后」 (Later).

::: tip Can't find 共工空间 in the list?
Click 「去授权」 (Grant) once in 共工空间 first. The desktop app then registers itself in the system's permission list, and you can find it in System Settings.
:::

::: warning Permissions lost after upgrading
macOS records these two permissions by app signature. For installers signed with a Developer ID certificate, the permissions persist across upgrades; installers without a Developer ID signature have a different signature for every version, so **you need to grant them again after upgrading**. If views stop streaming after an upgrade, check the permission status on the Live view page first.
:::

::: details Permissions when using the `gg` command line
When running the command-line `gg run`, macOS attributes the permissions to the program running `gg` (such as Terminal or iTerm), so you need to allow that terminal app under 「系统设置 → 隐私与安全性 → 屏幕录制 / 辅助功能」 (System Settings → Privacy & Security → Screen Recording / Accessibility). `gg doctor` lists whether these two are granted.
:::

## Provider config stays on this machine

Model providers configured on the 「Agent」 and 「Bot」 pages (third-party model service URLs, API keys, models, and providers used by individual Bots) **are stored only on this machine**:

- They're saved in `~/.gonggong/providers.json` on this machine, readable and writable only by you (0600).
- They're not uploaded to the server and not synced to your other machines. Each machine must be configured separately.
- API keys shown on the page are masked; when editing, leaving the API key empty keeps the saved key.
- At run time, keys are passed to the Agent only through local files or child process environment variables; they never appear in command-line arguments, logs, or error messages.
- Machine details on the web can also manage providers: the web app just forwards the operation to this machine's daemon, which reads and writes the local file. The server doesn't store keys. When the machine is offline, you can't manage its providers on the web.

When you switch machines or reinstall the OS, you need to configure providers again on the new machine. For the command-line equivalents, see [Command reference · provider](/en/cli/reference#gg-provider); for the web, see [Agent tools and providers](/en/user/agents-providers).

## Other system-related settings

- **Launch at login**: the 「开机启动」 (Launch at login) switch in 「设置」 (Settings). When on, the app starts in the background at login and can take tasks without opening a window.
- **PATH**: apps opened from Finder or the Dock don't get the PATH from your terminal. On startup, the desktop app reads the PATH from your login shell, so Node.js and Agent CLIs installed with nvm, volta, asdf, and similar tools can be found; it also looks in `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, and `~/.npm-global/bin`. If it still can't find them, use 「手动指定路径…」 (Specify path manually…) on the Agent page.

## Related pages

- [Pages](/en/desktop/pages)
- [Previews](/en/user/previews)
- [Agent tools and providers](/en/user/agents-providers)
- [Local data and logs](/en/cli/local-data)
