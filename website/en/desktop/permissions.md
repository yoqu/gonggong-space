# Local config and system settings

This page explains why model provider configuration is stored only on this machine, plus system-related settings such as launch at login and how Agent CLIs are found when the app is launched from the Dock.

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
