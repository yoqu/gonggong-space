# Command-line installation

This page explains how to install the `gg` command line on macOS, Linux, and Windows, keep it running in the background, and covers auto-upgrades and common installation issues.

The `gg` command line is a single executable with no installer; just put it in a directory on your PATH. It binds this machine to the team server and runs the daemon that receives tasks groups dispatch to Bots on this machine.

::: tip Mac and Windows users
On Mac (installers exist for both Apple silicon and Intel) and Windows, the [desktop app](/en/desktop/) is recommended: it has a built-in daemon, so you don't need to install `gg`, and it keeps running after you close the window. Only one of the desktop app and `gg` can run on a machine.
:::

## The easiest way: let your Agent install it

On macOS and Linux, if this machine already has an Agent such as Claude Code or Codex, you can have it do the install for you:

1. On the web, click your avatar in the top-right corner → 「绑定新机器」 (Bind new machine), and copy the sentence under 「发给你的 Agent」 (Send to your agent).
2. Paste it to the Agent on this machine.

The Agent reads the install instructions from the server and runs them: it downloads the `gg` build matching this machine's OS to `~/.local/bin/gg` and verifies its sha256, binds this machine with the connect code, automatically creates a Bot that uses this Agent plus a direct chat with it, then runs `gg service install` so `gg` stays in the background and starts automatically at login. No sudo is needed, and it usually takes 1–3 minutes. See [Bind a machine](/en/user/bind-machine) for details.

If you'd rather not go through an Agent, you can run the same install script yourself (replace the address with your server's; the connect code is in the 「绑定新机器」 (Bind new machine) dialog):

```bash
curl -fsSL https://gg.example.com/api/install.sh -o /tmp/gonggong-install.sh
sh /tmp/gonggong-install.sh --code K7QM-4X2P --agent claude
```

| Option | Description |
| --- | --- |
| `--code` | Connect code, required |
| `--agent` | Which Agent the new Bot uses: `claude`, `codex`, `gemini`, `codebuddy`, `pi`, `deepseek`; required |
| `--no-service` | Don't install the background service; run `gg run` yourself later |

The script ends by running `gg status`. Setup is complete only when the output shows both `bound: yes` and `service: running`. If this machine is already bound to another server, the script stops and leaves the existing binding untouched.

## Manual installation

### Prerequisites

Member machines need:

- **git**
- **Node.js 22 or later** (with npm). If it's missing, the daemon installs a Node.js managed by Gonggong Space into `~/.gonggong/runtime` on first run; you can also install it in advance with `gg agents install node`.
- At least one Agent CLI (Claude Code, Codex, Gemini CLI, CodeBuddy, pi, DeepSeek Harness, or Antigravity CLI), already signed in in the terminal. You can also install a version managed by Gonggong Space with `gg agents install <name>`; see the [Command reference](/en/cli/reference#gg-agents-install).

On first run, the daemon uses npm to install the ACP adapters into `~/.gonggong/adapters/`, so the machine needs access to an npm registry (the Taobao mirror npmmirror by default; change it with `gg agents mirror`).

### Download

If your admin has published clients in the admin console, you can download the Linux build directly from 「绑定新机器」 (Bind new machine) → 「其他方式」 (Other ways) → 「① 安装客户端」 (① Install the client). For other platforms, or if the server hasn't published one, download from [GitHub Releases](https://github.com/yoqu/gonggong-space/releases/latest). File names look like `gonggong-<version>-<os>-<arch>`:

| Machine | File |
| --- | --- |
| Mac with Apple silicon (M1/M2/M3…) | `gonggong-<version>-macos-aarch64` |
| Mac with Intel chip | `gonggong-<version>-macos-x86_64` |
| Linux x86_64 | `gonggong-<version>-linux-x86_64` |
| Linux ARM64 | `gonggong-<version>-linux-aarch64` |
| Windows x86_64 | `gonggong-<version>-windows-x86_64.exe` |

Not sure which chip you have? On a Mac, click the Apple menu in the top-left corner → 「关于本机」 (About This Mac); on Linux, run `uname -m` (`x86_64` or `aarch64`).

The Linux build requires glibc 2.31 or later (Ubuntu 20.04+, Debian 11+, RHEL 9+).

### macOS / Linux

Put it in `~/.local/bin` and rename it to `gg`:

```bash
mkdir -p ~/.local/bin
mv ~/Downloads/gonggong-0.4.20-linux-x86_64 ~/.local/bin/gg   # use the file name you received
chmod +x ~/.local/bin/gg
```

If `~/.local/bin` isn't on your PATH yet, add it (zsh shown; for bash use `~/.bashrc`):

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

::: warning Use a directory you can write to
Don't put it in a directory that needs sudo, such as `/usr/local/bin`. When a new version is available, `gg` downloads it and replaces itself; without write permission, it can't upgrade.
:::

On macOS, files downloaded in a browser carry a "downloaded from the internet" flag, and the system blocks running them directly. Remove the flag:

```bash
xattr -d com.apple.quarantine ~/.local/bin/gg
```

### Windows

1. Create a folder you can write to, such as `C:\Users\<you>\gonggong\`.
2. Rename the exe to `gg.exe` and put it there.
3. Add that folder to 「系统属性 → 环境变量 → Path」 (System Properties → Environment Variables → Path), then reopen your terminal.

`gg.exe` is a command-line program: double-clicking it doesn't start anything, it only shows usage. Run it in PowerShell or Command Prompt. On Windows, the daemon looks for `node.exe`, the Agents' `.exe` files, and the `.cmd` launcher scripts generated by npm in PATH, `%APPDATA%\npm`, and `~/.local/bin`. `gg service` and the install script don't support Windows; if you need it to keep running, use the desktop app.

### Verify file integrity

Each release comes with a `SHA256SUMS` file. Each line is "sha256 value + two spaces + file name". Check the original file you received against it:

```bash
# macOS
shasum -a 256 gonggong-0.4.20-macos-aarch64
# Linux
sha256sum gonggong-0.4.20-linux-x86_64
```

```powershell
# Windows PowerShell
Get-FileHash .\gonggong-0.4.20-windows-x86_64.exe -Algorithm SHA256
```

The output should match the corresponding line in `SHA256SUMS`. The install script does this step automatically.

### Build from source

1. Install Rust (only once):

   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source ~/.cargo/env
   ```

   `rust-toolchain.toml` in the repository root pins the toolchain version; rustup downloads it automatically on the first build.

2. Install a C compiler (needed by the crypto library): on macOS run `xcode-select --install`; on Debian/Ubuntu run `sudo apt install build-essential`.

3. Build and install from the repository root:

   ```bash
   cargo build --release --locked -p gonggong
   mkdir -p ~/.local/bin
   cp target/release/gg ~/.local/bin/gg
   ```

For admins building packages for all platforms in bulk, see [Upgrading and releasing clients](/en/deploy/upgrade).

## Bind and run

```bash
gg --version   # prints the version number if installed correctly
gg agents      # lists detection results for Node.js and each Agent CLI
```

Then copy the bind command from 「绑定新机器」 (Bind new machine) → 「其他方式」 (Other ways) → 「使用命令行」 (Use the command line) on the web and run it, for example:

```bash
gg login --server https://gg.example.com --code K7QM-4X2P
```

The connect code is valid for 30 minutes. It's fine if it has expired or was already used: `gg` will ask you to confirm on the web instead; see [Command reference · gg login](/en/cli/reference#gg-login).

After binding, there are two ways to run it:

- **Background service (recommended)**: `gg service install`. It runs automatically after you log in to the system and is restarted if the process exits unexpectedly. See [gg service](/en/cli/reference#gg-service).
- **Foreground**: `gg run`. The terminal window has to stay open; once you close it, this machine's Bots show as offline.

After binding, run `gg doctor` once to check the connection, Agents, git credentials, disk, and more. For all commands, see the [Command reference](/en/cli/reference).

::: tip The server address must be https
Connecting to a server that isn't on this machine requires `https://`; `http://` is allowed only for local addresses such as `localhost` and `127.0.0.1`. If the server uses a self-signed certificate or a private CA, you need to trust it explicitly when running `gg login`; see [gg login](/en/cli/reference#gg-login) and [HTTPS and certificates](/en/deploy/https).
:::

## Run in a container

You can run member machines on a server with Docker: the image comes with `gg`, Node.js, Claude Code, Codex, git, Chromium, and more, and each container is one machine. The repository's `docker/daemon/` directory provides a `Dockerfile` and `compose.yml`:

1. On the web, go to 「绑定新机器」 (Bind new machine) → 「其他方式」 (Other ways) → 「在 Docker 中运行」 (Run in Docker) and copy the `GONGGONG_BIND_URL='…'` line.
2. Put that line in `docker/daemon/.env`, then add `GG_VERSION` (the `gg` version to install) and `GONGGONG_MACHINE_ID` (fixed and unique per container, e.g. a value generated with `openssl rand -hex 16`).
3. Run `docker compose up -d --build`. On first start the container binds automatically with `gg login --code-only`; the binding is stored in a volume, so later restarts don't bind again.

`gg` in the container runs from the volume, so an upgrade done from the web survives rebuilding the container; when the `gg` in the image is updated, it automatically replaces the older one in the volume. For deployment details, see [Docker deployment](/en/deploy/docker).

## Common issues

**`command not found`**: PATH isn't set up correctly. Reopen your terminal or check the PATH setup above.

**`gg` opens the git GUI**: the oh-my-zsh git plugin defines `gg` as an alias for `git gui citool`. Add this line to the **end** of `~/.zshrc` and reopen your terminal:

```bash
unalias gg 2>/dev/null
```

To work around it temporarily, use `command gg …`.

**The background service can't find an Agent CLI**: `gg service install` reads the PATH of your login shell (so Node.js and Agents installed with nvm, volta, etc. are found too) and writes it into the service configuration. If you install tools later that aren't on that PATH, just run `gg service install` again.

**Output language**: `gg` messages are in Chinese by default. Add `--lang en` or set the environment variable `GG_LANG=en` to switch to English.

## Automatic upgrades

- When your admin publishes a newer version in the admin console, the daemon downloads the build matching this machine's OS and architecture in the background, verifies its sha256, and replaces itself and restarts once no tasks are running on this machine, so tasks in progress aren't interrupted.
- If the server hasn't published a build for this platform, the daemon checks GitHub for the latest stable release every 6 hours.
- Downloads go to `~/.gonggong/updates/` first and replace the current binary only after verification passes; a version that fails verification isn't retried.
- **Upgrade now from the web**: for command-line daemons on Linux (including those in containers) with auto-upgrade on, the machine details show 「立即升级」 (Upgrade now). Click it to download right away; the daemon restarts to finish the upgrade when idle. For other machines, follow the instructions under 「如何升级」 (How to upgrade) in the machine details; on the command line, restart `gg run` once (or `gg service install`), and it upgrades automatically after reconnecting.
- The server announces its protocol version. If the version is too old and the protocol is incompatible, the server refuses the connection; with auto-upgrade on, the daemon immediately downloads the new version and restarts.
- To turn off auto-upgrade: set the environment variable `GONGGONG_NO_AUTO_UPGRADE=1` before running `gg run`, or turn off 「自动升级」 (Auto upgrade) in the desktop app's 「设置」 (Settings) (both use `~/.gonggong/settings.json`). To turn off only the GitHub check, set `GONGGONG_UPDATE=off`.
- The ACP adapter versions are locked together with `gg` and are upgraded when `gg` is upgraded.

For how admins publish new versions, see [Client releases](/en/admin/releases) and [Upgrading and releasing clients](/en/deploy/upgrade).

## Related pages

- [Command reference](/en/cli/reference)
- [Local data and logs](/en/cli/local-data)
- [Desktop app overview and installation](/en/desktop/)
- [Bind a machine](/en/user/bind-machine)
- [My machines](/en/user/machines)
