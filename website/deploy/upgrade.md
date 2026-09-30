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

客户端在构建机上用 `scripts/release.sh` 打包，版本号取自 `crates/gonggong/Cargo.toml`。

```bash
bash scripts/release.sh                                # 全部平台 + 桌面端
bash scripts/release.sh --only macos-aarch64,desktop   # 只打部分产物
```

`--only` 可选值：`macos-aarch64`、`macos-x86_64`、`linux-x86_64`、`linux-aarch64`、`windows-x86_64`、`desktop`，逗号分隔。

### 产物

输出到 `dist/<版本>/`：

| 文件 | 说明 |
| --- | --- |
| `gonggong-<版本>-<平台>[.exe]` | daemon（命令行 `gg`），各平台一个 |
| `gg-cast-<版本>-<平台>[.exe]` | 实时画面推送程序，各平台一个 |
| `Gonggong_<版本>_<架构>.dmg` | macOS 桌面端安装包，内置 gg-cast |
| `SHA256SUMS` | 各文件的 sha256 |
| `manifest.json` | 发布清单：版本及各平台文件的下载地址与 sha256 |

### 构建机要求

| 产物 | 要求 |
| --- | --- |
| macOS 版 | macOS 主机，通过 rustup 安装 `aarch64-apple-darwin`、`x86_64-apple-darwin` 两个 target |
| Linux / Windows 版 | 本机装有 Docker，在容器内交叉编译。Linux 版需要 glibc ≥ 2.31（Ubuntu 20.04+、Debian 11+、RHEL 9+） |
| 桌面端 `.dmg` | macOS 主机，先执行 `pnpm install`，装好 Rust 和 Xcode 命令行工具 |

::: tip 桌面端签名
钥匙串里有 Developer ID Application 证书时，脚本会自动用它签名桌面端（也可用 `APPLE_SIGNING_IDENTITY` 指定）；没有则使用临时（ad hoc）签名并给出警告：这样每次升级后，macOS 授予的屏幕录制、辅助功能等权限都会失效。见 [权限与系统设置](/desktop/permissions)。
:::

## 发布客户端

### 后台上传

构建机和服务器分开时最方便：把 `dist/<版本>/` 里的 `gonggong-*`、`gg-cast-*` 拖进「管理后台 → 客户端发布」即可，文件名规则、版本规则见 [客户端发布](/admin/releases)。

### 脚本发布

能在服务器上（或能访问服务器数据目录的机器上）运行脚本时，可以一步完成构建和发布：

```bash
GONGGONG_DATA_DIR=/var/lib/gonggong \
GONGGONG_ADMIN_PASSWORD=<管理员密码> \
bash scripts/release.sh --publish https://gg.example.com
```

脚本会：

1. 按上文构建产物；
2. 把 `gonggong-*`、`gg-cast-*` 复制到 `$GONGGONG_DATA_DIR/downloads/`（设置了该变量时）；
3. 以管理员身份登录，把 `manifest.json` 提交给 server，生成新的发布记录。

相关变量：

| 变量 | 说明 |
| --- | --- |
| `GONGGONG_ADMIN_PASSWORD` | 必填，发布用管理员的密码 |
| `GONGGONG_ADMIN_ACCOUNT` | 发布用的管理员账号，默认 `admin` |
| `GONGGONG_CACERT` | server 使用自签证书时，传入证书文件让 curl 信任 |
| `GONGGONG_DOWNLOAD_BASE` | 安装包放在 CDN 时的地址前缀，写进 `manifest.json`；默认 `/downloads`（由 server 提供下载） |

::: warning
脚本发布会用 `manifest.json` 整体替换发布记录。`--only` 只打了部分平台时，清单里只有这些平台，其他平台会变成「未发布」。
:::

使用 CDN 时，daemon 用系统证书库校验 CDN 的 HTTPS，并始终校验文件 sha256。

### 分发桌面端

`.dmg` 不经服务器发布，把文件直接发给使用桌面端的成员，重新安装即可升级。见 [桌面端](/desktop/)。

## daemon 如何自动升级

- daemon 每次连上 server 时，如果服务器发布了**更高版本**且有它所在平台的文件，就在后台下载并校验 sha256。
- 下载完成后，等本机没有运行中的轮次，替换自身可执行文件并重启。
- 从不降级；校验失败的版本本次运行期间不再尝试。
- 协议版本过旧被 server 拒绝时，立即下载升级。
- 成员可以用 `GONGGONG_NO_AUTO_UPGRADE=1` 或桌面端「设置 → 自动升级」关闭。
- gg-cast 不随 daemon 自动下载，而是在第一次推送实时画面时按需下载。

详见 [客户端发布 · 自动升级怎样进行](/admin/releases#自动升级怎样进行)。

## 相关页面

- [客户端发布](/admin/releases)
- [备份与恢复](/deploy/backup)
- [命令行安装](/cli/)
- [桌面端](/desktop/)
