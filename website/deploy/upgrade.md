# 升级与发布客户端

本页说明如何升级服务端，以及如何构建并发布成员机器上的客户端（daemon 与 gg-cast），让它们自动升级。

## 升级服务端

1. 先 [备份](/deploy/backup)：
   ```bash
   sudo -u gonggong env GONGGONG_BACKUP_DIR=… GONGGONG_DATA_DIR=… GONGGONG_DATABASE_URL=… bash scripts/backup.sh
   ```
2. 拉取新代码并安装依赖：
   ```bash
   cd /srv/gonggong
   sudo -u gonggong git pull
   sudo -u gonggong pnpm install --frozen-lockfile
   ```
3. 重新构建网页：
   ```bash
   sudo -u gonggong pnpm --filter @gonggong/web build
   ```
4. 重启 server：
   ```bash
   sudo systemctl restart gonggong
   curl -s http://127.0.0.1:8787/api/health
   ```

- server 启动时自动应用新的数据库迁移，无需手动操作。
- 网页是静态文件，构建完成即生效，Nginx 不用重载。已打开的页面刷新后加载新版本。
- 重启期间 daemon 和浏览器会断开并自动重连。

::: tip 协议版本
`/api/health` 返回的 `protocol` 是 server 与 daemon 之间的协议版本。新版 server 提高协议版本后，旧 daemon 会被拒绝连接，[机器](/admin/machines) 页会提示「daemon 协议版本过旧」。升级服务端时请同时发布配套的新版客户端，已开启自动升级的 daemon 会立即升级。
:::

## 构建客户端

客户端在构建机上用 `scripts/release.sh` 打包，版本号取自 `crates/gonggong/Cargo.toml`。默认要求工作区没有未提交的改动（`git status` 为空），否则加 `--allow-dirty`。

```bash
bash scripts/release.sh                                # 全部产物
bash scripts/release.sh --only macos-aarch64,desktop   # 只打部分产物
bash scripts/release.sh --daemon-only                  # 只打五个平台的 gg，不打桌面端
```

`--only` 可选值，逗号分隔：

| 值 | 产物 |
| --- | --- |
| `macos-aarch64`、`macos-x86_64`、`linux-x86_64`、`linux-aarch64`、`windows-x86_64` | 对应平台的 daemon（`gg`）与 gg-cast |
| `desktop` | macOS 桌面端，Apple 芯片与 Intel 各一个安装包 |
| `desktop-windows` | Windows 桌面端安装包（在 Docker 里交叉编译），只在 `--only` 里写明时才打 |

### 产物

输出到 `dist/<版本>/`：

| 文件 | 说明 |
| --- | --- |
| `gonggong-<版本>-<平台>[.exe]` | daemon（命令行 `gg`），各平台一个 |
| `gg-cast-<版本>-<平台>[.exe]` | 实时画面推送程序，各平台一个 |
| `Gonggong_<版本>_aarch64.dmg` / `Gonggong_<版本>_x86_64.dmg` | macOS 桌面端安装包（Apple 芯片 / Intel），内置 gg-cast |
| `Gonggong_<版本>_<架构>.app.tar.gz` 与 `.sig` | macOS 桌面端自动更新包及其签名 |
| `Gonggong_<版本>_x64-setup.exe` 与 `.sig` | Windows 桌面端安装包（也是它的更新包）及其签名 |
| `SHA256SUMS` | daemon 与 gg-cast 的 sha256 |
| `manifest.json` | 发布清单：版本、版本说明及各平台 daemon 与 gg-cast 的下载地址和 sha256 |

版本说明取自 `docs/release-notes/v<版本>.md`（或 `--notes <文件>`），会写进清单，客户端提示更新时显示。

### 构建机要求

| 产物 | 要求 |
| --- | --- |
| macOS 版 daemon | macOS 主机，通过 rustup 安装 `aarch64-apple-darwin`、`x86_64-apple-darwin` 两个 target |
| Linux / Windows 版 daemon | 本机装有 Docker，在容器内交叉编译。Linux 版需要 glibc ≥ 2.31（Ubuntu 20.04+、Debian 11+、RHEL 9+） |
| macOS 桌面端 | macOS 主机，先执行 `pnpm install`，装好 Rust 和 Xcode 命令行工具；需要自动更新签名私钥（`TAURI_SIGNING_PRIVATE_KEY`，默认读 `~/.tauri/gonggong.key`） |
| Windows 桌面端 | 本机装有 Docker，同样需要自动更新签名私钥 |

::: tip macOS 签名与公证
钥匙串里有 Developer ID Application 证书时，脚本会自动用它签名桌面端（也可用 `APPLE_SIGNING_IDENTITY` 指定）；没有则使用临时（ad hoc）签名并给出警告：这样每次升级后，macOS 授予的屏幕录制、辅助功能等权限都会失效，见 [权限与系统设置](/desktop/permissions)。配置了 Apple 公证所需的环境变量（`APPLE_API_KEY` / `APPLE_API_ISSUER` / `APPLE_API_KEY_PATH`，或 `APPLE_NOTARY_PROFILE` 钥匙串配置）时，还会公证 `.dmg`。
:::

## 发布客户端

### 后台上传

构建机和服务器分开时最方便：把 `dist/<版本>/` 里的文件拖进「管理后台 → 客户端发布」即可。daemon 与 gg-cast 用于安装和自动升级；桌面端的 `.dmg`、`setup.exe` 会出现在「绑定新机器」的下载里；桌面端更新包与签名都上传后，桌面端会优先从本服务器更新。文件名规则、版本规则见 [客户端发布](/admin/releases)。

### 脚本发布

能以管理员身份访问服务器时，可以用脚本一次上传整个目录：

```bash
GONGGONG_ADMIN_PASSWORD=<管理员密码> \
bash scripts/release/publish.sh server <版本> https://gg.example.com
```

它把 `dist/<版本>/` 里的 daemon、gg-cast 和桌面端文件逐个经后台上传接口传给服务器，最后上传版本说明；可以重复执行，已上传的文件会被替换。

在服务器上（或能访问服务器数据目录的机器上）也可以构建后直接发布 daemon：

```bash
GONGGONG_DATA_DIR=/var/lib/gonggong \
GONGGONG_ADMIN_PASSWORD=<管理员密码> \
bash scripts/release.sh --publish https://gg.example.com
```

它把 `gonggong-*`、`gg-cast-*` 复制到 `$GONGGONG_DATA_DIR/downloads/`（设置了该变量时），再以管理员身份把 `manifest.json` 提交给 server。桌面端文件不在其中，需要另行上传。

相关变量：

| 变量 | 说明 |
| --- | --- |
| `GONGGONG_ADMIN_PASSWORD` | 必填，发布用管理员的密码 |
| `GONGGONG_ADMIN_ACCOUNT` | 发布用的管理员账号，默认 `admin` |
| `GONGGONG_CACERT` | server 使用自签证书时，传入证书文件让 curl 信任 |
| `GONGGONG_DOWNLOAD_BASE` | 安装包放在 CDN 时的地址前缀，写进 `manifest.json`；默认 `/downloads`（由 server 提供下载） |

::: warning
`release.sh --publish` 会用 `manifest.json` 整体替换发布记录。`--only` 只打了部分平台时，清单里只有这些平台，其他平台会变成「未发布」。
:::

使用 CDN 时，daemon 用系统证书库校验 CDN 的 HTTPS，并始终校验文件 sha256。

## 客户端如何自动升级

**daemon（命令行 `gg`）**

- daemon 连上 server 时，如果服务器发布了**更高版本**且有它所在平台的文件，就在后台下载并校验 sha256，等本机没有运行中的轮次后替换自身并重启。
- 服务器没有发布它所在平台的文件时，每 6 小时检查一次 GitHub Releases。
- 从不降级；校验失败的版本本次运行期间不再尝试。协议版本过旧被 server 拒绝时，立即下载升级。
- Linux 命令行 daemon（含 [Docker 成员机器](/deploy/docker)）可以在网页机器页点「立即升级」，下载后在空闲时重启。
- 成员可以用 `GONGGONG_NO_AUTO_UPGRADE=1` 或桌面端「设置 → 自动升级」关闭。
- gg-cast 不随 daemon 自动下载，而是在第一次推送实时画面时从服务器按需下载。

**桌面端**

先向已绑定的服务器检查更新，服务器发布了本平台的更新包与签名就从服务器下载，否则检查 GitHub。Apple 芯片版与 Intel 版各自更新；久开跨多个版本时直接升到最新。

详见 [客户端发布 · 自动升级怎样进行](/admin/releases#自动升级怎样进行)。

## 相关页面

- [客户端发布](/admin/releases)
- [备份与恢复](/deploy/backup)
- [命令行安装](/cli/)
- [桌面端](/desktop/)
