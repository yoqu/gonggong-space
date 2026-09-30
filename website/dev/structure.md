# 仓库结构

本页说明仓库里每个目录负责什么，以及服务器领域模块、Web 功能目录和 daemon 模块的分工。

## 顶层目录

| 目录 | 职责 |
| --- | --- |
| `apps/web` | Web 客户端（React + Vite）。`src/ui/` 是设计系统组件，`src/features/<领域>/` 按领域组织页面与组件，`src/app/` 是应用外壳 |
| `apps/server` | 服务器（Fastify + Drizzle + PostgreSQL）。`src/modules/<领域>/` 按领域组织路由与服务；`src/db/schema.ts` 是唯一的表定义，迁移文件在 `drizzle/`；`src/daemon/` 是 daemon 的 WebSocket 网关，`src/realtime/` 是推给浏览器的实时通道 |
| `apps/desktop` | 桌面端 Gonggong（Tauri）。`src/` 是 React 界面，`src-tauri/` 是 Rust 壳，直接依赖 `crates/gonggong` 在进程内运行 daemon |
| `crates/gonggong` | 成员机器上的 daemon 与 `gg` 命令行（二进制名 `gg`），集成测试在 `tests/` |
| `packages/protocol` | 全部线上契约（zod）：Web ⇄ 服务器接口、daemon ⇄ 服务器消息、预览隧道帧、内置 MCP 工具。`fixtures/*.json` 是 daemon 协议的共享样例，TS 与 Rust 两边都要能往返；`cases/` 是其他跨语言共享用例 |
| `tools/mock-agent` | 可脚本化的 ACP Agent，daemon 测试与部分端到端测试用它代替真实 Agent，按提示词决定行为（如 `mock:echo`、`mock:slow`、`mock:crash`） |
| `tools/mcp-echo` | 最小的 stdio MCP 服务（只有一个 `echo` 工具），端到端测试用来验证 MCP 注入 |
| `e2e` | Playwright 端到端测试：真实服务器 + Web + daemon + Agent |
| `scripts` | 开发与运维脚本：`pg.sh`（项目内 PostgreSQL）、`dev-cert.sh`（自签开发证书）、`backup.sh` / `restore.sh`、`release.sh` 等 |
| `website` | 本帮助手册（VitePress） |
| `docs` | 需求与设计文档，作为背景参考；与代码冲突时以代码为准 |

## 服务器领域模块

位于 `apps/server/src/modules/`，每个目录一般包含 `routes.ts`（HTTP/WS 路由）和 `service.ts`（业务逻辑）。

| 模块 | 职责 |
| --- | --- |
| `admin` | 管理后台：系统参数（`params.ts`）、审计记录查询 |
| `agent-tools` | 内置 MCP 中由服务器应答的工具（读聊天记录、群信息、运行记录等），daemon 以正在进行的运行为凭据转发调用 |
| `approvals` | 权限审批：Agent 越权请求的创建、批准、拒绝与作废 |
| `attachments` | 消息附件的上传、存储与下载 |
| `auth` | 登录、会话、注册，以及首次启动时创建 `admin`（`bootstrap.ts`） |
| `bots` | Bot 的增删改、所在机器绑定、权限档位与 Agent 配置 |
| `candidates` | 输入框 @ 候选：向 Bot 的 daemon 取工作区文件列表，慢或离线时用缓存兜底 |
| `commands` | 群里的指令（`/cd`、停止、系统指令、Agent 命令）解析与执行 |
| `git-accounts` | 成员的 Git 托管平台账号（令牌），用于仓库访问 |
| `groups` | 群与私聊：成员、Bot、设置、仓库、标题 |
| `live` | 预览的实时画面（LiveKit）：观看、控制与 gg-cast 状态 |
| `machines` | 机器的绑定、登出、详情、网络测量，以及经 daemon 实时读写的 Agent 工具 |
| `mcp` | 管理员配置的全局 MCP 服务，建会话时注入（名称 `gonggong` 保留给内置服务） |
| `messages` | 消息发送、引用、撤回、运行中追加 |
| `notifications` | 通知中心与 Web Push 推送 |
| `previews` | 预览：隧道、网关代理、托管服务、公开分享链接 |
| `providers` | 机器的模型供应商：只实时转发给 daemon，不写数据库 |
| `questions` | Bot 向群成员提问的卡片与回答 |
| `reactions` | 消息表情回应 |
| `releases` | 客户端发布：上传 daemon 构建，供 daemon 自升级下载 |
| `repos` | 团队仓库历史与仓库可访问性探测 |
| `runs` | 运行的核心：触发、调度、接收 daemon 上报、脱敏、停止、对账与保留期清理 |
| `search` | 全局搜索（消息、改动过的文件） |
| `usage` | 用量统计 |
| `users` | 用户资料卡片、停用 |
| `workspaces` | 每个（群，Bot）的工作区：准备、`/cd`、文件浏览、diff 与状态 |

## Web 功能目录

位于 `apps/web/src/features/`。

| 目录 | 内容 |
| --- | --- |
| `admin` | 管理后台布局与各页（账号、群、机器、系统参数、客户端发布、审计） |
| `attachments` | 输入框附件、消息附件展示与查看器 |
| `auth` | 登录、注册、修改密码、头像菜单 |
| `bots` | 新建 Bot、Bot 设置、Agent 配置、Bot 私聊页、性格角色头像、后台 Bot 页 |
| `chat` | 群消息主视图：消息时间线、输入框与候选、Git 条、上下文占用、新建群 |
| `config` | 管理后台 · 配置中心 |
| `diff` | diff 面板 |
| `files` | 文件查看器 |
| `groups` | 群信息、群公告、群设置 |
| `machines` | 绑定新机器、机器详情、Agent 工具、供应商编辑与导入、解绑 |
| `notifications` | 通知中心与浏览器推送 |
| `previews` | 预览卡片、实时画面、分享链接、后台公开链接页 |
| `reactions` | 表情回应 |
| `repos` | 仓库选择与仓库访问检查 |
| `runs` | 运行卡片相关：过程面板、审批、提问、打断与追加 |
| `search` | 搜索浮层 |
| `settings` | 个人设置 |
| `usage` | 用量页 |
| `users` | 用户卡片（悬停资料） |
| `workbench` | 右侧工作台的标签页（运行、diff、文件、网页、小程序、实时画面） |
| `workspaces` | 工作区与目录选择 |

## daemon 主要模块

位于 `crates/gonggong/src/`，`main.rs` 是 `gg` 命令行入口，`lib.rs` 汇总模块供桌面端复用。

| 模块 | 职责 |
| --- | --- |
| `daemon.rs` | daemon 整体句柄（`gg run` 与桌面端共用）：单实例锁、服务与引擎、吊销清理、实时状态 |
| `service.rs` | 与服务器的 WebSocket 连接、收发与按字节限额的发送缓冲 |
| `engine.rs` | 执行服务器下发的运行；每个（群，Bot）一个 ACP 适配器进程，负责安装固定版本的适配器 |
| `session.rs` | 单个（群，Bot）会话：适配器进程、ACP 会话与轮次 |
| `turn.rs` | 每轮的纯逻辑：拼提示词、ACP 更新到运行事件的映射、权限档位策略 |
| `permission.rs` | macOS 屏幕录制、辅助功能权限检测（预览用） |
| `protocol.rs` | 与 `packages/protocol` 对应的线上类型 |
| `ask.rs` | 内置 `gonggong` MCP 服务（本机回环、每会话独立 URL）：向群成员提问、转发服务器工具、应答 daemon 工具 |
| `mcp_call.rs` | 解析 ACP 更新里的 MCP 工具调用（Claude 与 Codex 格式不同） |
| `agents.rs` | 检测本机已装的 Agent CLI 及版本 |
| `tools.rs` | 托管安装 Node.js、Claude Code、Codex（不用 sudo、不动全局 npm） |
| `manage.rs` | 服务器发来的 Agent 工具、供应商、CC Switch 请求的应答 |
| `providers.rs` | 本机模型供应商存储（`providers.json`，外发一律打码） |
| `provider_cli.rs` | `gg provider` 子命令 |
| `inject.rs` | 把运行使用的供应商注入适配器进程（密钥不进命令行参数和日志） |
| `ccswitch.rs` | 只读导入本机 CC Switch 的供应商 |
| `local.rs` | 本机设置（`local.json`）：Agent CLI 路径、命令审批规则、模型目录 |
| `configure.rs` | `gg agents`、`gg config` 子命令 |
| `config.rs` | 本地状态根目录（`~/.gonggong`，可用 `GONGGONG_HOME` 覆盖）与绑定信息 |
| `bind.rs` | 上报给服务器的本机信息与机器标识 |
| `bots.rs` | `gg bots`：列出绑定在本机的 Bot |
| `workspace.rs` | 每个（群，Bot）的工作区：托管克隆、`/cd` 绑定、目录选择 |
| `git.rs` | 工作区 git 操作（调用本机 `git`，沿用本机凭据） |
| `repo.rs` | 远程仓库标识与访问探测（ssh ⇄ https 回退） |
| `files.rs` | @ 文件候选 |
| `explorer.rs` | 工作区只读文件浏览与路径校验 |
| `attachments.rs` | 附件落盘到工作区 `.gonggong/attachments/` |
| `tunnel.rs` | 预览隧道二进制帧与转发 |
| `previews.rs` | 本机预览与托管服务列表（桌面端用） |
| `hosted.rs` | 托管服务（如开发服务器），由 daemon 持有进程，活得比单轮更久 |
| `static_site.rs` | 把工作区目录作为静态站点在回环地址上提供 |
| `snapshot.rs` | 用本机 Chrome 系浏览器渲染预览首屏截图 |
| `cast.rs` | 实时画面：按需启动 gg-cast 把窗口推到 LiveKit |
| `wechatide.rs` | 微信开发者工具：打开小程序项目并截模拟器画面 |
| `tls.rs` | 连接服务器的 HTTPS/WSS，按证书 SHA-256 指纹固定；明文 http 只允许回环地址 |
| `net.rs` | 测量到服务器的延迟与带宽 |
| `upgrade.rs` | 自升级：下载新版本、校验 sha256、替换自身并重启 |
| `revoke.rs` | 机器被吊销后清理托管工作区与令牌 |
| `diag.rs` | `gg doctor` 自检与脱敏诊断包 |
| `logs.rs` | daemon 日志（按天滚动 + 内存环形缓冲） |
| `status.rs` | 供界面读取的实时状态：连接、心跳、延迟、正在执行的运行 |
| `lock.rs` | 每个本地目录只允许一个 daemon（文件锁） |
| `coalesce.rs` | 相同键的并发请求合并为一次计算 |

## 相关页面

- [参与开发](/dev/)
- [协议](/dev/protocol)
- [系统架构](/guide/architecture)
