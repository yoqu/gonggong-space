# 本地数据与日志

本页介绍 daemon 在本机保存了哪些数据、托管工作区放在哪里、日志与诊断包、可用的环境变量，以及自动清理的范围。

命令行 `gg` 和桌面端共用同一个数据目录，默认是 `~/.gonggong/`（Windows 为 `%USERPROFILE%\.gonggong\`），可用环境变量 `GONGGONG_HOME` 改到别处。托管工作区单独放在看得见的 `~/gonggong/workspaces/` 下。

## 托管工作区

Bot 在群里干活用的托管工作区放在：

```text
~/gonggong/workspaces/<群名>/<Bot 名>/<仓库名>
```

- 目录名取首次创建时的群名和 Bot 名，之后改名不会搬动目录；重名时自动加后缀区分。群没有仓库时最后一级为 `_empty`。
- 群有附加仓库时，附加仓库克隆在主仓库旁边。
- 旧版本放在 `~/.gonggong/workspaces/<群 ID>/<Bot ID>/…` 下的工作区，会在下次运行或绑定时自动搬到新位置，未提交的改动会保留。
- 设置了 `GONGGONG_HOME`（数据目录不是默认的 `~/.gonggong`）时，托管工作区放在 `<GONGGONG_HOME>/named/` 下，多份实例互不共用。
- `/cd` 绑定的本机目录不在这里，共工空间不会删除它们。

工作区占用、瘦身和清理可以在网页「机器与 Bot」→ 机器 →「工作区」页签里操作，见 [我的机器](/user/machines)；命令行用 [`gg workspaces`](/cli/reference#gg-workspaces)。

## 数据目录结构

```text
~/.gonggong/
├── config.json          绑定信息：服务器地址、机器凭据（token）、归属人、证书信任方式
├── settings.json        本机偏好：自动升级开关、镜像源（解除绑定后保留）
├── local.json           手动指定的 Agent CLI 路径
├── providers.json       本机模型供应商与 API Key、本机默认、Bot 单独设置、本机 Agent 设置
├── git-credentials      网页「Git 访问」里添加的 HTTPS 令牌
├── models.json          从各 Agent 探测到的可选模型，上报服务器供网页选择
├── tools-latest.json    Node.js 与各 Agent CLI 最新版本的查询缓存
├── workspaces.json      托管工作区的位置记录
├── pending-link.json    正在等待网页确认的接入申请（确认后删除）
├── adapters/            ACP 适配器（首次运行时用 npm 安装）
├── agent-pkgs/          插件 Agent 的程序包
├── runtime/             共工空间托管版 Node.js
├── tools/               共工空间托管版 Agent CLI
├── skill-sets/          下发给各「群 × Bot」的 Skill
├── plugin-sets/         插件的各个版本
├── plugin-links/        各「群 × Bot」启用的插件
├── artifacts/           托管产物的本地状态
├── sync/                多机同步工作区的本地状态
├── backups/             本机备份：被覆盖的本地修改、中断的半成品
├── logs/                daemon 日志：daemon.<日期>.log；后台服务（macOS）的 service.log
├── updates/             自动升级下载的新版本（校验通过后才替换）
├── bin/                 命令行使用实时画面时从服务器下载的 gg-cast
├── run/                 运行时生成的临时配置（含供应商设置）
├── probe/               探测可选模型时使用的临时目录
├── services.pids        Bot 启动的托管服务进程记录
└── *.lock               daemon.lock 等锁文件
```

说明：

- `config.json`、`providers.json`、`git-credentials`、`pending-link.json` 含凭据，文件权限仅本人可读写（0600），不要发给别人。
- 目录会按需创建，没用到的功能不会生成对应目录。
- `daemon.lock` 保证同一个数据目录只运行一个 daemon（`gg run`、后台服务或桌面端）。
- 工作区里的 `.gonggong/` 子目录存放消息附件和托管服务日志，属于工作区的一部分。
- 网页「Git 访问」里添加的 SSH 密钥放在系统的 `~/.ssh/` 下，不在数据目录里。

## 自动清理

daemon 运行时每天清理一次，只清理可以重新生成的内容：

- 已不在本机的群或 Bot 留下的状态（Skill、插件启用记录、同步状态等），且已超过一天；
- 30 天没有被任何运行用到的插件版本；
- 已被新版本替代、没有进程在用的托管 Node.js 和 gg-cast。

**工作区和本机备份不会被自动删除**，只能在网页机器的「工作区」页签或用 `gg workspaces --delete` 手动清理。无法从服务器获取群与 Bot 列表时，本次清理跳过。

## 本机备份

Bot 运行时如果要覆盖工作区里未提交的本地修改，或者一轮运行被中断留下半成品，daemon 会先把它们存到 `~/.gonggong/backups/`：

- 只保存在本机，**不上传服务器**。
- 查看：`gg workspaces` 输出末尾的「本机备份 · 不上传」，或桌面端「工作区」页下方同名区域。
- `gg logout`、桌面端「解除绑定…」、机器被吊销时都**不会**删除备份目录；不需要时手动删除即可。

## 解除绑定时会删除什么

| 操作 | `config.json` | 托管工作区 | `/cd` 绑定的目录 | 本机备份 | 其他设置与供应商 |
| --- | --- | --- | --- | --- | --- |
| `gg logout` | 删除 | 保留 | 保留 | 保留 | 保留 |
| 桌面端「解除绑定…」 | 删除 | 删除 | 保留 | 保留 | 保留 |
| 机器被吊销 / 账号停用 | 删除 | 删除 | 保留 | 保留 | 保留 |

吊销时的删除是尽力而为，不保证彻底。`gg logout` 不会卸载后台服务，不再使用时执行 `gg service uninstall`。

## 日志

- daemon（`gg run`、后台服务或桌面端）的日志按天写入 `~/.gonggong/logs/daemon.<日期>.log`，保留最近 7 个文件。
- macOS 上用 `gg service` 运行时，进程的标准输出与错误另写到 `~/.gonggong/logs/service.log`；Linux 上可用 `journalctl --user -u gonggong` 查看。
- 查看：`gg logs`（默认最近 200 行 info 及以上），桌面端「日志与诊断」页的「最近日志」，或网页机器详情里的日志。
- 日志写入前会按规则脱敏：token、密码、API Key、Authorization 等形似凭据的内容会被替换为 `[REDACTED]`，运行中注入给 Agent 的密钥值也会被打码。
- `gg run` 同时把日志输出到终端（标准错误），输出级别由 `GONGGONG_LOG` 控制；`gg doctor` 等一次性命令只输出到终端，不写日志文件。

## 诊断包

遇到问题需要找管理员排查时，导出诊断包：

- 命令行：`gg logs --export`（默认保存到桌面，文件名 `gonggong-diag-<日期-时间>.zip`），或 `gg logs --export 路径.zip`。
- 桌面端：「日志与诊断」→「导出诊断包…」，选择保存位置。

诊断包是一个 zip，内容如下：

| 文件 | 内容 |
| --- | --- |
| `logs/daemon.<日期>.log` | 各日志文件的末尾部分，已脱敏 |
| `diag.json` | 导出时 `gg doctor` 各项检测的结果 |
| `versions.json` | daemon 版本、协议版本、系统与架构、检测到的 Agent |
| `config.json` | 绑定信息，已去掉 token 等凭据 |
| `local.json` | 本机设置，已去掉形似凭据的字段 |

诊断包不包含 `providers.json`、`git-credentials` 和工作区内容。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `GONGGONG_HOME` | 数据目录，默认 `~/.gonggong`。可用于在一台机器上隔离多份数据 |
| `GG_LANG` | 命令输出语言 `zh` / `en`，同 `--lang`。不设置时依次看 `LC_ALL`、`LC_MESSAGES`、`LANG`，默认中文 |
| `GONGGONG_LOG` | 终端日志的输出级别，写法同 Rust `tracing` 的过滤规则，如 `info`、`debug`、`gonggong=debug`。不设置时终端只输出 error 级别 |
| `GONGGONG_NO_AUTO_UPGRADE` | 设为 `1` 时不自动升级，效果同在设置里关闭「自动升级」 |
| `GONGGONG_UPDATE` | 设为 `off` 时不检查 GitHub 上的新版本（服务器发布的版本照常升级） |
| `GONGGONG_UPDATE_REPO` | 检查新版本用的 GitHub 仓库，默认 `yoqu/gonggong-space` |
| `GONGGONG_BROWSER` | 生成网页截图、渲染 HTML 用的浏览器可执行文件路径。不设置时自动查找本机的 Chrome / Edge / Chromium |
| `GONGGONG_MACHINE_ID` | 覆盖用于识别机器的硬件 ID。在一台主机上运行多份相互隔离的实例（各自一个 `GONGGONG_HOME`），或在容器里运行时使用；同一台机器要保持不变，服务器靠它在重建后认出这台机器 |
| `GONGGONG_CONTAINER` | 设为 `1` 表示运行在容器里，网页会按容器给出升级提示。官方 daemon 镜像已设置 |

示例：

```bash
GONGGONG_LOG=debug gg run                 # 终端输出 debug 日志
GONGGONG_HOME=/data/gonggong gg status    # 使用另一个数据目录
gg --lang en doctor                       # 英文输出
```

::: warning GONGGONG_INSECURE_DEV
`GONGGONG_INSECURE_DEV=1` 会关闭服务器证书校验，连接可被中间人冒充，只用于本地开发，不要在正式环境设置。自签证书请用 `gg login --fingerprint` 或 `--ca-file`，见 [gg login](/cli/reference#gg-login)。
:::

## 备份与迁移

- **需要备份的**：`settings.json`、`local.json`、`providers.json`（含 API Key，妥善保管）、`git-credentials`（含令牌）。它们都是本机配置，服务器上没有副本。
- **不需要备份的**：`adapters/`、`runtime/`、`tools/`、`models.json` 等可以重新下载或探测；托管工作区可从仓库重新克隆（未推送的改动要先推送或另行备份）。
- **换机器**：在新机器上重新 `gg login`（或在桌面端绑定），再重新配置供应商与 Git 访问。同一台机器 `gg logout` 后重新 `gg login` 会恢复原有机器记录和 Bot 绑定。
- 不要把 `config.json` 复制到别的机器使用。

## 相关页面

- [命令参考](/cli/reference)
- [命令行安装](/cli/)
- [我的机器](/user/machines)
- [功能页面 · 日志与诊断](/desktop/pages#日志与诊断)
- [常见问题与排查](/guide/faq)
