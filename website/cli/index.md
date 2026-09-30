# 命令行安装

本页介绍如何在 macOS、Linux、Windows 上安装命令行 `gg`，以及校验、自动升级和常见安装问题。

命令行 `gg` 就是一个可执行文件，没有安装向导，放到 PATH 能找到的目录即可。它负责把这台机器绑定到团队服务器，并运行 daemon 接收群里派给本机 Bot 的任务。

::: tip Mac 用户
Mac 上更推荐 [桌面端](/desktop/)：自带 daemon，不需要再装 `gg`，关窗后菜单栏常驻。桌面端和 `gg` 同一台机器只能运行一个。
:::

## 准备

成员机器需要：

- **git**
- **Node.js 22 或更高**（含 npm）。没有的话，daemon 首次运行时会自动安装共工托管版 Node.js 到 `~/.gonggong/runtime`；也可以用 `gg agents install node` 提前安装。
- **Claude Code** 和/或 **Codex CLI**，并在终端里先登录好。也可以用 `gg agents install claude` / `gg agents install codex` 安装共工托管版。

daemon 首次运行时会用 npm 把 ACP 适配器安装到 `~/.gonggong/adapters/`，所以机器需要能访问 npm 源（默认淘宝镜像 npmmirror，可用 `gg agents mirror` 更换）。

## 选择安装包

向管理员索取安装包，文件名形如 `gonggong-<版本>-<系统>-<架构>`：

| 机器 | 文件 |
| --- | --- |
| Apple 芯片的 Mac（M1/M2/M3…） | `gonggong-<版本>-macos-aarch64` |
| Intel 芯片的 Mac | `gonggong-<版本>-macos-x86_64` |
| Linux x86_64 | `gonggong-<版本>-linux-x86_64` |
| Linux ARM64 | `gonggong-<版本>-linux-aarch64` |
| Windows x86_64 | `gonggong-<版本>-windows-x86_64.exe` |

不确定芯片：Mac 点左上角苹果菜单 →「关于本机」；Linux 执行 `uname -m`（`x86_64` 或 `aarch64`）。

Linux 版要求 glibc 2.31 或更高（Ubuntu 20.04+、Debian 11+、RHEL 9+）。

## macOS / Linux

放到 `~/.local/bin` 并改名为 `gg`：

```bash
mkdir -p ~/.local/bin
mv ~/Downloads/gonggong-0.1.0-macos-aarch64 ~/.local/bin/gg   # 换成你拿到的文件名
chmod +x ~/.local/bin/gg
```

如果 `~/.local/bin` 还不在 PATH 里，把它加进去（zsh 为例，bash 改成 `~/.bashrc`）：

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

::: warning 放在自己有写权限的目录
不要放 `/usr/local/bin` 这类需要 sudo 的目录。服务器发布新版本后，`gg` 会下载新版本并替换自己，没有写权限就无法升级。
:::

### macOS 提示「无法打开」

从网络下载的文件带有「来自互联网」标记，直接运行会被系统拦截。去掉标记即可：

```bash
xattr -d com.apple.quarantine ~/.local/bin/gg
```

自己从源码编译的文件没有这个标记，不需要这一步。

## Windows

1. 新建一个自己有写权限的文件夹，如 `C:\Users\<你>\gonggong\`。
2. 把 exe 改名为 `gg.exe` 放进去。
3. 把该文件夹加入「系统属性 → 环境变量 → Path」，重新打开终端。

Windows 上 daemon 会在 PATH、`%APPDATA%\npm` 和 `~/.local/bin` 中查找 `node.exe`、`claude.exe` 以及 npm 生成的 `*.cmd` 启动脚本。自动升级时会先把正在运行的 exe 改名，再放入新文件。

::: warning
Windows 版目前验证较少，遇到问题请反馈给管理员或在 GitHub 提交 issue。
:::

## 校验文件完整性

管理员发布时会一并提供 `SHA256SUMS`，每行是「sha256 值 + 两个空格 + 文件名」。对照你拿到的原始文件：

```bash
# macOS
shasum -a 256 gonggong-0.1.0-macos-aarch64
# Linux
sha256sum gonggong-0.1.0-linux-x86_64
```

```powershell
# Windows PowerShell
Get-FileHash .\gonggong-0.1.0-windows-x86_64.exe -Algorithm SHA256
```

输出的值应与 `SHA256SUMS` 中对应一行一致。

## 从源码编译

1. 安装 Rust（只需一次）：

   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source ~/.cargo/env
   rustup update stable
   ```

   项目使用 Rust 2024 edition，没有固定工具链版本，请使用最新的 stable 版本（官方发布构建使用 Rust 1.98）。

2. 安装 C 编译器（加密库要用）：macOS 执行 `xcode-select --install`；Debian/Ubuntu 执行 `sudo apt install build-essential`。

3. 在仓库根目录编译并安装：

   ```bash
   cargo build --release --locked -p gonggong
   mkdir -p ~/.local/bin
   cp target/release/gg ~/.local/bin/gg
   ```

PATH 设置同上。管理员批量打包各平台产物见 [升级与发布客户端](/deploy/upgrade)。

## 装好后检查

```bash
gg --version   # 打印版本号说明装好了
gg agents      # 列出 Node.js、Claude Code、Codex 的检测结果
```

然后按 [绑定机器](/user/bind-machine) 执行 `gg login` 并运行 `gg run`。绑定后再跑一次 `gg doctor`，检查连接、git 凭据、磁盘等。全部命令见 [命令参考](/cli/reference)。

提示 `command not found`：PATH 没配好，重新打开终端或检查上面的 PATH 设置。

### `gg` 打开了 git 图形界面

oh-my-zsh 的 git 插件把 `gg` 定义成了 `git gui citool` 的别名。在 `~/.zshrc` **末尾**加一行后重开终端：

```bash
unalias gg 2>/dev/null
```

临时绕过可以用 `command gg …`。

## 自动升级

- `gg run` 连上服务器后，如果管理员发布了更高版本，daemon 会在后台下载与本机系统、架构匹配的新版本，校验 sha256 后，等本机没有运行中的任务时替换自身并重启。
- 下载的文件先放在 `~/.gonggong/updates/`，校验通过后才替换；校验失败的版本不会再尝试。
- 服务器公布协议版本；版本不兼容时服务器会拒绝连接并提示升级。
- 关闭自动升级：设置环境变量 `GONGGONG_NO_AUTO_UPGRADE=1` 后运行 `gg run`，或在桌面端「设置」中关闭「自动升级」（两者共用 `~/.gonggong/settings.json`）。
- ACP 适配器的版本随 `gg` 一起锁定，升级 `gg` 时一并升级。

管理员如何发布新版本见 [客户端发布](/admin/releases) 和 [升级与发布客户端](/deploy/upgrade)。

## 相关页面

- [命令参考](/cli/reference)
- [本地数据与日志](/cli/local-data)
- [桌面端概览与安装](/desktop/)
- [绑定机器](/user/bind-machine)
