# 常见问题与排查

本页汇总使用中最常见的问题和处理办法。遇到没列出的问题，先按 [通用排查步骤](#通用排查步骤) 收集信息。

## 通用排查步骤

1. **看状态**：`gg status` 查看本机绑定的服务器、归属人，以及后台服务是否在运行（`service: running`）。
2. **自检**：`gg doctor` 依次检查服务器连接、Agent、git 凭据、磁盘、换行符，以及 macOS 上的屏幕录制与辅助功能权限。每行前的标记：`✓` 正常、`!` 警告、`✗` 错误、`-` 跳过；有错误时命令以非零状态退出。

   ```text
   ✓ 服务器连接	HTTPS 正常
   ✓ Agent	Claude Code 2.1.3 · Codex 0.160.1 可用
   ✓ git 凭据	SSH · 可访问 · todo-app × 后端助手
   ✓ 磁盘	工作区 1.8 GB · 剩余 212 GB
   ```

3. **看日志**：`gg logs` 显示最近的 daemon 日志，可用 `--level error|warn|info|debug` 和 `--lines 数量` 过滤。
4. **导出诊断包**：`gg logs --export` 生成一个 zip（默认放在桌面，名为 `gonggong-diag-日期-时间.zip`，也可 `gg logs --export 路径.zip` 指定），内含脱敏后的日志、自检结果、版本信息和去掉 token 的本机配置，可以直接发给管理员。

桌面端用户在「日志与诊断」页可以完成同样的操作，见 [功能页面](/desktop/pages)；在网页「机器与 Bot」里也能查看机器的自检结果和 daemon 日志，见 [我的机器与 Bot](/user/machines)。命令详情见 [命令参考](/cli/reference)。

## 接入机器

### 把那句话发给 Agent 后，它报错停下了

Agent 会把命令的原始输出告诉你，常见的有：

- 「on Windows use the desktop app」：一句话接入只支持 macOS 和 Linux。Windows 请在「绑定新机器」里展开「其他方式」，用桌面端绑定。
- 「no gg build for …」或「这个平台还没有发布 gg」：服务器还没有发布这个平台的 daemon。请管理员在「管理后台」→「客户端发布」上传，见 [客户端发布](/admin/releases)。
- 「this machine is already bound to …」：这台机器已经绑定到另一个服务器（可能是桌面端绑定的）。Agent 不会替你改动，确认要换服务器时，先在机器上执行 `gg logout`，再重新发那句话。
- 证书相关报错：服务器用的是自签证书，一句话接入需要受信任的证书。请改用桌面端或命令行绑定并带上证书指纹，见 [HTTPS 与证书](/deploy/https)。

### 接入码过期了，或提示要「在网页上确认这台机器」

接入码 30 分钟内有效，只能用一次。过期或已用过时，`gg login` 不会直接失败，而是发起一个接入申请，打印确认链接和 4 位核对码：

1. 在浏览器里打开确认链接（「绑定新机器」对话框开着时，申请也会直接出现在对话框里）；
2. 核对页面上的核对码与终端里的一致；
3. 点击「允许接入」。

只在你本人刚发起接入、且核对码一致时才允许。拒绝或长时间没人确认，`gg login` 会停止等待，准备好后重新运行即可。

### 其他接入报错

- 「接入链接尝试次数过多，已锁定，请稍后在 Web 端重新生成」：稍后在网页重新打开「绑定新机器」。
- 「接入链接中的代码格式应为 XXXX-XXXX」：检查复制是否完整。
- 「只允许通过 https:// 连接非本机服务器」：服务器地址要用 `https://`，只有连本机（`localhost`、`127.0.0.1`）时可以用 `http://`。

### 后台服务没在运行

用一句话接入或 `gg service install` 装好的后台服务，macOS 用 launchd，Linux 用 systemd 用户服务，登录后自动启动。

- `gg service status` 查看状态，`gg service install` 重新安装并启动。
- Linux 上希望注销后仍保持运行，需要执行一次 `loginctl enable-linger`。

## Bot 与运行

### Bot 显示「离线」，消息一直「离线等待」

Bot 所在机器的 daemon 没有连上服务器。

- 命令行用户：用 `gg service status` 确认后台服务在运行；没装后台服务的，确认 `gg run` 的终端还开着。
- 桌面端用户：确认 App 在运行（关掉窗口后仍在后台，选「退出」才会停止）。
- 运行 `gg doctor` 查看「服务器连接」一项的报错。

离线期间发给它的请求会等待上线，默认最多 30 分钟（群管理员可在群设置「群级参数」→「Bot 离线等待上线（分钟）」调整），超时后运行变为「已作废」，需要重新发起。

### 运行一直「排队中」

卡片上的步骤会写明原因，常见的有：

- 「本群上一轮未结束，排第 N」：同一个 Bot 在同一个群里一次只跑一轮，等上一轮结束即可，或用 `/stop` 停止上一轮。
- 工作区还在准备（如首次克隆仓库），克隆完成后自动开始。
- Bot 的并发已满：同时运行的轮次达到「并发上限」，其他群的任务结束后自动开始。

### 显示「无权触发」

你不在这个 Bot 的触发范围内。请 Bot 主人在 Bot 设置里把你加入「指定名单」，或把触发范围改为「任何群成员」。注意审批方式为「完全允许」的 Bot 只能由触发名单里的人触发。见 [Bot 设置与权限](/user/bot-settings)。

### 「还没有工作区，本次未执行」或「所在机器无法访问仓库」

Bot 用**归属人机器上自己的 git 凭据**访问仓库。请 Bot 主人在自己机器上确认能访问该仓库（例如 `git ls-remote <仓库地址>`，或看 `gg doctor` 的「git 凭据」一项），常见原因有「无权限或仓库不存在」「网络或证书问题」「连接超时」。也可以在网页「机器与 Bot」里给机器配置 Git 访问。配置好后，在群设置「仓库与同步」或群里的提示条上点击「重新检查」。见 [仓库与工作区](/user/repos-workspaces)。

### 新建 Bot 时看不到某个 Agent，或 Bot 显示「agent 缺失」

daemon 没有在这台机器上检测到对应的 CLI。

1. 在终端确认 CLI 能运行（如 `claude --version`、`codex --version`），且已登录。
2. 版本不能太旧，最低要求：

   | Agent | 最低版本 |
   | --- | --- |
   | Claude Code | 2.0.0 |
   | Codex | 0.160.1 |
   | Gemini CLI | 0.36.0 |
   | CodeBuddy | 2.182.0 |
   | pi | 1.0.0 |
   | DeepSeek Harness | 0.2.2 |

3. 运行 `gg agents` 查看 daemon 检测到的结果。装好后稍等片刻会自动上报；也可以在网页机器详情的「Agent 工具」里直接安装或升级。
4. CLI 装在非常规位置时，用 `gg config agent claude --path /完整/路径/claude`（其他 Agent 同理）指定。

见 [Agent 工具与供应商](/user/agents-providers)。

### 审批卡片太多

在 Bot 设置里把「审批方式」从「每次问我」改为「帮我审批」：构建、测试、本地 git、工作区内改文件等直接放行，只把其余操作交给你；还可以开启「AI 预审」进一步过滤。临时的大活可以在审批卡片上选「本次运行免审批」。见 [审批与提问](/user/approvals)。

## 连接与网络

### 连不上服务器

- 「无法连接服务器 …」：确认这台机器能访问服务器地址（防火墙、端口、内网/VPN）。
- 证书报错：daemon 会校验服务器证书。自签证书要在绑定时带上指纹（`gg login --server … --code … --fingerprint <指纹>`），私有 CA 用 `--ca-file`；证书换了之后，用指纹绑定的机器要带新指纹重新绑定。见 [HTTPS 与证书](/deploy/https)。

### 局域网内其他机器怎么访问

- **Web**：局域网成员可以直接用服务器的地址打开网页。用自签证书时浏览器会提示不受信任，确认继续即可。
- **daemon**：用 `https://` 地址绑定；自签证书需带证书指纹，见上一条。生成包含局域网 IP 的证书见 [HTTPS 与证书](/deploy/https)。
- 网页开发服务器默认只监听本机，对局域网开放需设置 `WEB_HOST=0.0.0.0`，见 [本地开发与测试](/dev/local)。

## 安装与系统

### 输入 `gg` 打开的是 git 图形界面

oh-my-zsh 的 git 插件把 `gg` 设成了 `git gui citool` 的别名。在 `~/.zshrc` 末尾加一行后重开终端：

```bash
unalias gg 2>/dev/null
```

临时绕过可以用 `command gg …`。

### macOS 拦截运行

- **下载的 `gg` 被拦截**：去掉「来自互联网」标记：

  ```bash
  xattr -d com.apple.quarantine ~/.local/bin/gg
  ```

  本机从源码编译的 `gg` 不会被拦截。
- **桌面端提示「无法打开」**：在「系统设置 → 隐私与安全性」底部点击「仍要打开」，或在「应用程序」里右键图标选「打开」。
- **实时画面、远程操作不可用**：需要在「系统设置 → 隐私与安全性」的「屏幕录制」「辅助功能」中允许运行 `gg` 的程序（终端或桌面端）。`gg doctor` 会提示缺哪项。见 [权限与系统设置](/desktop/permissions)。

### 下载 Agent 工具、适配器很慢或失败

daemon 首次运行会用 npm 下载 ACP 适配器，在 Web 或桌面端安装 Node.js 和 Agent 工具时也会下载。默认下载源是国内镜像 npmmirror，可以切换：

```bash
gg agents mirror                 # 查看当前下载源
gg agents mirror official        # 改用官方源
gg agents mirror https://registry.example.com --node-mirror https://example.com/node   # 自定义
gg agents mirror npmmirror       # 改回默认
```

共工空间只修改自己的配置，不会改动你的全局 npm 设置。

### `gg` 提示 `command not found`

`gg` 所在目录不在 PATH 里。一句话接入会把 `gg` 装到 `~/.local/bin/gg`，可以直接用完整路径运行，或把 `~/.local/bin` 加进 PATH。见 [安装](/cli/)。

### 工作区占了太多磁盘

在网页「机器与 Bot」里打开机器的空间管理，可以查看各工作区占用、瘦身或清理不再使用的工作区；命令行可用 `gg workspaces` 查看。见 [我的机器与 Bot](/user/machines)。

## 预览

### 预览卡片打不开

- 卡片显示「离线」：Bot 所在机器的 daemon 没有连上，预览流量经它转发，先让机器上线。
- 卡片显示「服务已停止」：预览背后的服务没在运行，在卡片上点击「启动服务」，或让 Bot 重新启动服务。
- 卡片显示「已关闭」：预览默认 24 小时无人访问会自动关闭（系统参数可调），让 Bot 重新发布即可。
- 局域网部署时每个预览占用服务器的一个端口（默认 41000–41099，可用 `GONGGONG_PREVIEW_PORTS` 调整）。服务器默认只监听本机，需要设置 `GONGGONG_PREVIEW_HOST=0.0.0.0` 让局域网能访问这些端口，防火墙也要放行。
- 正式部署建议用独立的预览域名（`GONGGONG_PREVIEW_DOMAIN`，必须是与主站不同的域名，并配置泛域名 DNS 与证书），同时设置 `GONGGONG_PUBLIC_URL` 为主站地址。

详见 [结果预览](/user/previews)、[反向代理与预览域名](/deploy/reverse-proxy)。

## 账号与机器

- **换机器或不再使用**：在旧机器上执行 `gg service uninstall` 停掉后台服务，再 `gg logout` 解除本机绑定。再次绑定同一台机器会恢复原有机器记录和其上的 Bot。
- **账号被停用或机器被吊销**：daemon 下次连接会被拒绝，并清除本机凭据和托管工作区（Bot 主人指定的本机目录不会被删除）。需要恢复请联系系统管理员。

## 相关页面

- [命令参考](/cli/reference)
- [本地数据与日志](/cli/local-data)
- [HTTPS 与证书](/deploy/https)
- [术语表](/guide/glossary)
