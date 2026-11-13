# 客户端发布

本页说明如何在「客户端发布」页上传新版 daemon、gg-cast 和桌面端，文件名怎样决定平台与版本，以及成员机器和桌面端如何从这里升级。

![管理后台 · 客户端发布](/screenshots/web/admin-releases.webp)

## 这里发布什么

| 产物 | 文件名示例 | 用途 |
| --- | --- | --- |
| daemon | `gonggong-0.4.20-linux-x86_64` | 成员机器上的 `gg` 命令行程序。在线的 daemon 连上服务器后自动升级到这里的版本；Linux 版也供成员在「绑定新机器」中下载 |
| gg-cast | `gg-cast-0.4.20-windows-x86_64.exe` | 推送「实时画面」用的辅助程序。daemon 第一次推送实时画面时按需下载 |
| 桌面端安装包 | `Gonggong_0.4.20_aarch64.dmg`、`Gonggong_0.4.20_x86_64.dmg`、`Gonggong_0.4.20_x64-setup.exe` | 供成员在「绑定新机器」中下载 |
| 桌面端更新包 | `Gonggong_0.4.20_aarch64.app.tar.gz`、`Gonggong_0.4.20_x86_64.app.tar.gz` | macOS 桌面端自动更新用（Windows 直接用安装包更新） |
| 桌面端更新签名 | 上面更新包或 Windows 安装包加 `.sig` | 桌面端校验更新包用 |
| 版本说明 | `RELEASE_NOTES.md` | 本版本的更新内容，升级提示里显示 |

macOS 桌面端分 Apple 芯片（`aarch64`）和 Intel（`x86_64`）两个包，各自签名、各自更新。产物由构建机运行 `scripts/release.sh` 生成，放在 `dist/<版本>/` 目录，见 [升级与发布客户端](/deploy/upgrade)。

## 上传

1. 在构建机上运行 `bash scripts/release.sh`。
2. 打开「客户端发布」页，把 `dist/<版本>/` 里的 `gonggong-*`、`gg-cast-*`、`Gonggong_*`（安装包、更新包与 `.sig` 签名）和 `RELEASE_NOTES.md` 拖进「拖入发布产物」区域（可一次拖多个）。
3. 每个文件显示上传进度，完成后下方表格对应平台变为「已发布」。

![上传发布产物](/screenshots/web/admin-releases-upload.webp)

服务器边接收边计算 sha256，把文件存到数据目录下的 `downloads/`（`$GONGGONG_DATA_DIR/downloads`），通过 `/downloads/<文件名>` 提供下载。

### 文件名规则

文件名决定产物类型、版本和平台：

```text
gonggong-<版本>-<平台>[.exe]
gg-cast-<版本>-<平台>[.exe]
Gonggong_<版本>_aarch64.dmg | x86_64.dmg | x64-setup.exe[.sig]
Gonggong_<版本>_aarch64.app.tar.gz[.sig] | x86_64.app.tar.gz[.sig]
```

- 版本：三段数字，如 `0.4.20`。
- daemon / gg-cast 的平台：`macos-aarch64`、`macos-x86_64`、`linux-x86_64`、`linux-aarch64`、`windows-x86_64`；只有 Windows 带 `.exe`。

不符合规则的文件（如 `SHA256SUMS`、`manifest.json`）在浏览器里就会被拒绝，提示「不是发布产物，文件名应形如 gonggong-0.2.0-macos-aarch64 或 Gonggong_0.2.0_aarch64.dmg」。**不要改名**，直接拖 `release.sh` 的原始产物。

### 版本规则

服务器同一时间只保留一个发布版本：

| 上传文件的版本 | 结果 |
| --- | --- |
| 与当前版本相同 | 按平台合并：新增或替换该平台的该类文件，其他不变 |
| 高于当前版本 | 开始一个新发布，替换整个发布记录 |
| 低于当前版本 | 拒绝上传 |

因此发布新版本时，请把**所有平台**的文件都传一遍，否则没传的平台在新发布里就是「未发布」。

单个文件不能超过 300 MB。如果前面有反向代理，需要把请求体上限调到至少 300 MB，见 [反向代理](/deploy/reverse-proxy)。

## 版本说明

有发布版本后，页面上方显示「版本说明」：

- 上传 `RELEASE_NOTES.md` 会作为本版本的说明（不超过 1 MB）。
- 也可以点「编辑版本说明」直接修改（支持 Markdown），点「保存版本说明」。
- 没有版本说明时会提示「未填写版本说明。桌面端和 daemon 升级时不会显示具体更新内容。」上传产物时也会提醒补充。

## 平台表格

工具栏显示「当前版本 x.y.z」或「尚未发布」。表格每个平台一行：

| 列 | 说明 |
| --- | --- |
| 平台 / 标识 | 如「macOS aarch64」/ `macos-aarch64` |
| daemon | 「已发布」及 sha256 前 12 位；没有则为「未发布」。该平台有机器但未发布时标为警示色 |
| gg-cast（实时画面） | 同上 |
| 桌面端安装包 | 同上 |
| 桌面端自动更新 | 更新包与签名都齐时为「已发布」；只缺一样时提示「缺少签名」或「缺少更新包」 |
| 机器 | 该平台的机器数量 |

每行菜单可移除该平台已发布的各类文件（「移除 daemon…」「移除 gg-cast…」「移除 桌面端…」等）：

| 移除 | 影响 |
| --- | --- |
| daemon | 该平台的机器不再自动升级，直到重新上传 |
| gg-cast | 该平台的机器无法推送实时画面，直到重新上传 |
| 桌面端安装包 | 成员无法在「绑定新机器」中下载该平台的安装包，直到重新上传 |
| 桌面端更新包 / 签名 | 该平台的桌面端改从 GitHub 检查更新，直到重新上传 |

上传、移除和修改版本说明都会写入 [审计记录](/admin/audit)。

## 自动升级怎样进行

### 命令行 daemon

1. 成员机器上的 daemon（`gg run`）连上服务器时上报自己的系统、架构和版本。
2. 如果服务器发布的版本**更新**，且有该平台的 daemon 文件，就把下载地址和 sha256 发给 daemon。daemon 从不降级。
3. daemon 在后台下载并校验 sha256，校验不通过的版本会被拒绝。
4. 等本机**没有运行中的轮次**时，替换自身可执行文件并重启，重启后以新版本重新上线。
5. 如果 daemon 的协议版本已经过旧、被服务器拒绝连接，则立即下载升级。

Linux 命令行 daemon 的主人还可以在网页机器页点「立即升级」，见 [机器](/admin/machines#怎样让机器升级)。

::: warning 需要写权限
daemon 要替换自己的可执行文件，所以 `gg` 应放在成员自己有写权限的目录（如 `~/.local/bin`），不要放 `/usr/local/bin` 这类需要 sudo 的位置。见 [命令行安装](/cli/)。
:::

成员可以关闭自动升级：设置环境变量 `GONGGONG_NO_AUTO_UPGRADE=1`，或在桌面端「设置」里关闭「自动升级」（写入本机设置，对同一台机器上的 `gg` 同样生效）。见 [命令参考](/cli/reference)。

### 桌面端自动更新

桌面端内置 daemon 和 gg-cast，作为应用整体更新：

- 桌面端**优先向已绑定的服务器**检查更新：本平台的更新包（Windows 为安装包）和签名都已发布，就从服务器下载。
- 服务器没有发布本平台的签名更新包时，改查 GitHub。
- 久开跨了多个版本时，一次升到最新。

## 其他发布方式

- **脚本发布**：能在服务器上运行脚本时，也可以用 `scripts/release.sh --publish <服务器地址>` 一步完成构建和发布，见 [升级与发布客户端](/deploy/upgrade)。
- **让 Bot 发布**：系统管理员发起的运行里，Bot 可以用内置 MCP 工具 `client_release_publish` 把它所在机器上构建好的产物（可以是整个发布目录）发布到当前服务器，需要审批一次。

## 相关页面

- [升级与发布客户端](/deploy/upgrade)
- [机器](/admin/machines)
- [桌面端](/desktop/)
