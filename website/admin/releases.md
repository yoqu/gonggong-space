# 客户端发布

本页说明如何在「客户端发布」页上传新版 daemon 与 gg-cast，文件名怎样决定平台与版本，以及成员机器如何自动升级。

![管理后台 · 客户端发布](/screenshots/web/admin-releases.webp)

## 这里发布什么

| 产物 | 文件名示例 | 用途 |
| --- | --- | --- |
| daemon | `gonggong-0.2.0-macos-aarch64` | 成员机器上的 `gg` 命令行程序。在线的 daemon 连上服务器后自动升级到这里的版本 |
| gg-cast | `gg-cast-0.2.0-windows-x86_64.exe` | 推送「实时画面」预览用的辅助程序。daemon 第一次推送实时画面时按需下载 |

产物由构建机运行 `scripts/release.sh` 生成，放在 `dist/<版本>/` 目录，见 [升级与发布客户端](/deploy/upgrade#构建客户端)。

::: tip
macOS 桌面端的 `.dmg` 不能在这里上传。桌面端内置 daemon 和 gg-cast，但内置的 daemon 不走这里的自动升级，新版桌面端需要重新下载安装，见 [桌面端](/desktop/)。
:::

## 上传

1. 在构建机上运行 `bash scripts/release.sh`（不带 `--publish`）。
2. 打开「客户端发布」页，把 `dist/<版本>/` 里的 `gonggong-*` 和 `gg-cast-*` 文件拖进「拖入发布产物」区域（可一次拖多个）。
3. 每个文件显示上传进度，完成后下方表格对应平台变为「已发布」。

![上传发布产物](/screenshots/web/admin-releases-upload.webp)

服务器边接收边计算 sha256，把文件存到数据目录下的 `downloads/`（`$GONGGONG_DATA_DIR/downloads`），通过 `/downloads/<文件名>` 提供下载。

### 文件名规则

文件名决定产物类型、版本和平台，格式为：

```text
gonggong-<版本>-<平台>[.exe]
gg-cast-<版本>-<平台>[.exe]
```

- 版本：三段数字，如 `0.2.0`。
- 平台：`macos-aarch64`、`macos-x86_64`、`linux-x86_64`、`linux-aarch64`、`windows-x86_64`。
- 只有 Windows 平台带 `.exe`，其他平台不能带。

不符合规则的文件（包括 `SHA256SUMS`、`manifest.json`、`.dmg`）在浏览器里就会被拒绝，提示「不是发布产物，文件名应形如 gonggong-0.2.0-macos-aarch64」。**不要改名**，直接拖 `release.sh` 的原始产物。

### 版本规则

服务器同一时间只保留一个发布版本：

| 上传文件的版本 | 结果 |
| --- | --- |
| 与当前版本相同 | 按平台合并：新增或替换该平台的文件，其他平台不变 |
| 高于当前版本 | 开始一个新发布，替换整个发布记录，并删除旧版本在本机托管的文件 |
| 低于当前版本 | 拒绝上传 |

因此发布新版本时，请把**所有平台**的文件都传一遍，否则没传的平台在新发布里就是「未发布」。

单个文件不能超过 300 MB。如果前面有反向代理，需要把请求体上限调到至少 300 MB，见 [反向代理](/deploy/reverse-proxy)。

## 平台表格

工具栏显示「当前版本 x.y.z」或「尚未发布」。表格每个平台一行：

| 列 | 说明 |
| --- | --- |
| 平台 / 标识 | 如「macOS aarch64」/ `macos-aarch64` |
| daemon | 「已发布」及 sha256 前 12 位；没有则为「未发布」。该平台有机器但未发布时标为警示色 |
| gg-cast（实时画面） | 同上 |
| 机器 | 该平台的机器数量 |

每行菜单可「移除 daemon…」或「移除 gg-cast…」：

- 移除 daemon：该平台的机器不再自动升级，直到重新上传。
- 移除 gg-cast：该平台的机器无法推送实时画面，直到重新上传。

上传与移除都会写入 [审计记录](/admin/audit)。

## 自动升级怎样进行

1. 成员机器上的 daemon（`gg run`）连上服务器时上报自己的系统、架构和版本。
2. 如果服务器发布的版本**更新**，且有该平台的 daemon 文件，就把下载地址和 sha256 发给 daemon。daemon 从不降级。
3. daemon 在后台下载并校验 sha256。校验不通过的版本会被拒绝，本次运行期间不再重试。
4. 等本机**没有运行中的轮次**时，替换自身可执行文件并重启，重启后以新版本重新上线。
5. 如果 daemon 的协议版本已经过旧、被服务器拒绝连接，则立即下载升级。

::: warning 需要写权限
daemon 要替换自己的可执行文件，所以 `gg` 应放在成员自己有写权限的目录（如 `~/.local/bin`），不要放 `/usr/local/bin` 这类需要 sudo 的位置。见 [安装](/cli/)。
:::

成员可以关闭自动升级：设置环境变量 `GONGGONG_NO_AUTO_UPGRADE=1`，或在桌面端「设置」里关闭「自动升级」（写入本机设置，对同一台机器上的 `gg` 同样生效）。见 [命令参考](/cli/reference)。

## 另一种方式：脚本发布

能在服务器上运行脚本时，也可以用 `scripts/release.sh --publish <服务器地址>` 一步完成构建和发布，见 [升级与发布客户端](/deploy/upgrade#脚本发布)。

## 相关页面

- [升级与发布客户端](/deploy/upgrade)
- [机器](/admin/machines)
- [结果预览](/user/previews)
