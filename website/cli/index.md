# 命令行安装

本页介绍如何在 macOS、Linux、Windows 上安装命令行 `gg`、让它在后台常驻，以及自动升级和常见安装问题。

命令行 `gg` 是一个单独的可执行文件，没有安装向导，放到 PATH 能找到的目录即可。它负责把这台机器绑定到团队服务器，并运行 daemon 接收群里派给本机 Bot 的任务。

::: tip Mac 和 Windows 用户
Mac（Apple 芯片与 Intel 都有安装包）和 Windows 上更推荐 [桌面端](/desktop/)：自带 daemon，不需要再装 `gg`，关窗后常驻。桌面端和 `gg` 同一台机器只能运行一个。
:::

## 最省事：交给你的 Agent 安装

macOS 和 Linux 上，如果这台机器已经装好 Claude Code、Codex 等 Agent，可以让它替你装：

1. 网页右上角头像 →「绑定新机器」，在「发给你的 Agent」里复制那句话。
2. 粘贴给这台机器上的 Agent。

Agent 会读取服务器上的安装说明并执行：下载与本机系统匹配的 `gg` 到 `~/.local/bin/gg` 并校验 sha256，用接入码绑定本机，自动建好一个使用该 Agent 的 Bot 和与它的私聊，再执行 `gg service install` 让 `gg` 在后台常驻、登录后自动启动。整个过程不需要 sudo，通常 1–3 分钟。详见 [绑定机器](/user/bind-machine)。

不想经过 Agent，也可以自己运行同一个安装脚本（把地址换成你们的服务器，接入码在「绑定新机器」对话框里）：

```bash
curl -fsSL https://gg.example.com/api/install.sh -o /tmp/gonggong-install.sh
sh /tmp/gonggong-install.sh --code K7QM-4X2P --agent claude
```

| 参数 | 说明 |
| --- | --- |
| `--code` | 接入码，必填 |
| `--agent` | 要建的 Bot 用哪个 Agent：`claude`、`codex`、`gemini`、`codebuddy`、`pi`、`deepseek`，必填 |
| `--no-service` | 不安装后台服务，之后自己运行 `gg run` |

脚本最后会执行 `gg status`，输出里同时有 `bound: yes` 和 `service: running` 才算接好。本机已经绑定到别的服务器时，脚本会停下，不会改动原有绑定。

## 手动安装

### 准备

成员机器需要：

- **git**
- **Node.js 22 或更高**（含 npm）。没有的话，daemon 首次运行时会自动安装共工空间托管版 Node.js 到 `~/.gonggong/runtime`；也可以用 `gg agents install node` 提前安装。
- 至少一个 Agent CLI（Claude Code、Codex、Gemini CLI、CodeBuddy、pi、DeepSeek Harness 或 Antigravity CLI），并在终端里先登录好。也可以用 `gg agents install <名称>` 安装共工空间托管版，见 [命令参考](/cli/reference#gg-agents-install)。

daemon 首次运行时会用 npm 把 ACP 适配器安装到 `~/.gonggong/adapters/`，所以机器需要能访问 npm 源（默认淘宝镜像 npmmirror，可用 `gg agents mirror` 更换）。

### 下载

管理员在后台发布过客户端时，Linux 版可以在「绑定新机器」→「其他方式」→「① 安装客户端」里直接下载；其他平台或服务器没有发布时，从 [GitHub Releases](https://github.com/yoqu/gonggong-space/releases/latest) 下载。文件名形如 `gonggong-<版本>-<系统>-<架构>`：

| 机器 | 文件 |
| --- | --- |
| Apple 芯片的 Mac（M1/M2/M3…） | `gonggong-<版本>-macos-aarch64` |
| Intel 芯片的 Mac | `gonggong-<版本>-macos-x86_64` |
| Linux x86_64 | `gonggong-<版本>-linux-x86_64` |
| Linux ARM64 | `gonggong-<版本>-linux-aarch64` |
| Windows x86_64 | `gonggong-<版本>-windows-x86_64.exe` |

不确定芯片：Mac 点左上角苹果菜单 →「关于本机」；Linux 执行 `uname -m`（`x86_64` 或 `aarch64`）。

Linux 版要求 glibc 2.31 或更高（Ubuntu 20.04+、Debian 11+、RHEL 9+）。

### macOS / Linux

放到 `~/.local/bin` 并改名为 `gg`：

```bash
mkdir -p ~/.local/bin
mv ~/Downloads/gonggong-0.4.20-linux-x86_64 ~/.local/bin/gg   # 换成你拿到的文件名
chmod +x ~/.local/bin/gg
```

如果 `~/.local/bin` 还不在 PATH 里，把它加进去（zsh 为例，bash 改成 `~/.bashrc`）：

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

::: warning 放在自己有写权限的目录
不要放 `/usr/local/bin` 这类需要 sudo 的目录。有新版本时 `gg` 会下载新版本并替换自己，没有写权限就无法升级。
:::

macOS 上从浏览器下载的文件带有「来自互联网」标记，直接运行会被系统拦截，去掉标记即可：

```bash
xattr -d com.apple.quarantine ~/.local/bin/gg
```

### Windows

1. 新建一个自己有写权限的文件夹，如 `C:\Users\<你>\gonggong\`。
2. 把 exe 改名为 `gg.exe` 放进去。
3. 把该文件夹加入「系统属性 → 环境变量 → Path」，重新打开终端。

`gg.exe` 是命令行程序，双击不会启动，只会显示用法；请在 PowerShell 或命令提示符里运行。Windows 上 daemon 会在 PATH、`%APPDATA%\npm` 和 `~/.local/bin` 中查找 `node.exe`、Agent 的 `.exe` 以及 npm 生成的 `.cmd` 启动脚本。`gg service` 和安装脚本不支持 Windows，需要常驻请用桌面端。

### 校验文件完整性

发布时会一并提供 `SHA256SUMS`，每行是「sha256 值 + 两个空格 + 文件名」。对照你拿到的原始文件：

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

输出的值应与 `SHA256SUMS` 中对应一行一致。安装脚本会自动做这一步。

### 从源码编译

1. 安装 Rust（只需一次）：

   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source ~/.cargo/env
   ```

   仓库根目录的 `rust-toolchain.toml` 固定了工具链版本，第一次编译时 rustup 会自动下载。

2. 安装 C 编译器（加密库要用）：macOS 执行 `xcode-select --install`；Debian/Ubuntu 执行 `sudo apt install build-essential`。

3. 在仓库根目录编译并安装：

   ```bash
   cargo build --release --locked -p gonggong
   mkdir -p ~/.local/bin
   cp target/release/gg ~/.local/bin/gg
   ```

管理员批量打包各平台产物见 [升级与发布客户端](/deploy/upgrade)。

## 绑定并运行

```bash
gg --version   # 打印版本号说明装好了
gg agents      # 列出 Node.js 与各 Agent CLI 的检测结果
```

然后在网页「绑定新机器」→「其他方式」→「使用命令行」里复制绑定命令执行，例如：

```bash
gg login --server https://gg.example.com --code K7QM-4X2P
```

接入码 30 分钟内有效。过期或已经用过也没关系：`gg` 会改为请你在网页上确认，见 [命令参考 · gg login](/cli/reference#gg-login)。

绑定后有两种运行方式：

- **后台常驻（推荐）**：`gg service install`，登录系统后自动运行，进程意外退出会自动拉起。见 [gg service](/cli/reference#gg-service)。
- **前台运行**：`gg run`，终端窗口要一直开着，关掉后本机 Bot 显示离线。

绑定后可以跑一次 `gg doctor`，检查连接、Agent、git 凭据、磁盘等。全部命令见 [命令参考](/cli/reference)。

::: tip 服务器地址必须是 https
连接非本机的服务器只能用 `https://`，`http://` 只允许 `localhost`、`127.0.0.1` 这类本机地址。服务器用自签证书或私有 CA 时，需要在 `gg login` 时显式信任，见 [gg login](/cli/reference#gg-login) 和 [HTTPS 与证书](/deploy/https)。
:::

## 在容器里运行

可以在一台服务器上用 Docker 跑成员机器：镜像里带好 `gg`、Node.js、Claude Code、Codex、git、Chromium 等，一个容器就是一台机器。仓库的 `docker/daemon/` 目录提供了 `Dockerfile` 和 `compose.yml`：

1. 在网页「绑定新机器」→「其他方式」→「在 Docker 中运行」里复制 `GONGGONG_BIND_URL='…'` 这一行。
2. 在 `docker/daemon/.env` 中写上这一行，再加上 `GG_VERSION`（要装的 `gg` 版本）和 `GONGGONG_MACHINE_ID`（每个容器固定且唯一，如 `openssl rand -hex 16` 生成的值）。
3. 执行 `docker compose up -d --build`。容器首次启动时自动用 `gg login --code-only` 绑定；绑定信息存在数据卷里，之后重启不再绑定。

容器里的 `gg` 运行在数据卷中，在网页上升级后重建容器也不会丢；镜像里的 `gg` 更新时会自动替换卷里的旧版本。部署细节见 [Docker 部署](/deploy/docker)。

## 常见问题

**提示 `command not found`**：PATH 没配好，重新打开终端或检查上面的 PATH 设置。

**`gg` 打开了 git 图形界面**：oh-my-zsh 的 git 插件把 `gg` 定义成了 `git gui citool` 的别名。在 `~/.zshrc` **末尾**加一行后重开终端：

```bash
unalias gg 2>/dev/null
```

临时绕过可以用 `command gg …`。

**后台服务找不到 Agent CLI**：`gg service install` 会读取你登录 shell 的 PATH（nvm、volta 等装的 Node.js 与 Agent 也能找到）写进服务配置。之后才装的工具不在这个 PATH 里时，重新执行一次 `gg service install` 即可。

**输出语言**：`gg` 的提示默认中文，加 `--lang en` 或设置环境变量 `GG_LANG=en` 改为英文。

## 自动升级

- 管理员在后台发布了更高版本时，daemon 会在后台下载与本机系统、架构匹配的新版本，校验 sha256 后，等本机没有运行中的任务时替换自身并重启，不会打断进行中的任务。
- 服务器没有发布本平台的版本时，daemon 每 6 小时检查一次 GitHub 上的最新正式版。
- 下载的文件先放在 `~/.gonggong/updates/`，校验通过后才替换；校验失败的版本不会再尝试。
- **网页上立即升级**：Linux 上的命令行 daemon（包括容器里的）开着自动升级时，机器详情里会出现「立即升级」，点击后马上下载，空闲时自动重启完成升级。其他机器按机器详情「如何升级」里的提示操作，命令行可以重启一次 `gg run`（或 `gg service install`），重连后自动升级。
- 服务器公布协议版本；版本过旧、协议不兼容时服务器会拒绝连接；开着自动升级时 daemon 会立即下载新版本并重启。
- 关闭自动升级：设置环境变量 `GONGGONG_NO_AUTO_UPGRADE=1` 后运行 `gg run`，或在桌面端「设置」中关闭「自动升级」（两者共用 `~/.gonggong/settings.json`）。只想关掉 GitHub 检查，设置 `GONGGONG_UPDATE=off`。
- ACP 适配器的版本随 `gg` 一起锁定，升级 `gg` 时一并升级。

管理员如何发布新版本见 [客户端发布](/admin/releases) 和 [升级与发布客户端](/deploy/upgrade)。

## 相关页面

- [命令参考](/cli/reference)
- [本地数据与日志](/cli/local-data)
- [桌面端概览与安装](/desktop/)
- [绑定机器](/user/bind-machine)
- [我的机器](/user/machines)
