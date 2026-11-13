# 仓库结构

本页说明仓库里每个目录负责什么，以及服务器领域模块、Web 功能目录、桌面端和 daemon 模块的分工。

## 顶层目录

| 目录 | 职责 |
| --- | --- |
| `apps/web` | Web 客户端（React + Vite）。`src/ui/` 是设计系统组件，`src/features/<领域>/` 按领域组织页面与组件，`src/app/` 是应用外壳（侧栏、布局、工作台），`src/i18n/` 是多语言 |
| `apps/server` | 服务器（Fastify + Drizzle + PostgreSQL）。`src/modules/<领域>/` 按领域组织路由与服务；`src/db/schema.ts` 是唯一的表定义，迁移文件在 `drizzle/`；`src/daemon/` 是 daemon 的 WebSocket 网关，`src/realtime/` 是推给浏览器的实时通道；`plugins/official/` 是内置插件；`install/` 是成员机器的安装脚本与「发给你的 Agent」接入说明 |
| `apps/desktop` | 桌面端「共工空间」（Tauri）。`src/` 是 React 界面（直接引用 Web 的源码与组件），`src-tauri/` 是 Rust 壳，依赖 `crates/gonggong` 在进程内运行 daemon |
| `crates/gonggong` | 成员机器上的 daemon 与 `gg` 命令行（二进制名 `gg`）。`presets/` 是内置的模型供应商预设，`skills/` 是内置 Skill，集成测试在 `tests/` |
| `crates/gg-cast` | 实时画面的推流组件 gg-cast，不在 Cargo 工作区里，单独构建 |
| `packages/protocol` | 全部线上契约（zod）：Web ⇄ 服务器接口、daemon ⇄ 服务器消息、预览隧道帧、内置 MCP 工具、插件清单、多语言核心。`fixtures/*.json` 是 daemon 协议的共享样例，TS 与 Rust 两边都要能往返；`cases/` 是其他跨语言共享用例 |
| `tools/mock-agent` | 可脚本化的 ACP Agent，daemon 测试与部分端到端测试用它代替真实 Agent，按提示词决定行为（如 `mock:echo`、`mock:slow`、`mock:crash`） |
| `tools/mcp-echo` | 最小的 stdio MCP 服务（只有一个 `echo` 工具），测试用来验证 MCP 注入 |
| `examples/plugins` | 插件示例（`dashboard`），演示 `gonggong-plugin.json` 清单与插件自带的 Skill |
| `e2e` | Playwright 端到端测试：真实服务器 + Web + daemon + Agent |
| `scripts` | 开发与运维脚本：`pg.sh`（项目内 PostgreSQL）、`check.sh`（推送前自检）、`dev-cert.sh`（自签开发证书）、`backup.sh` / `restore.sh`、`release.sh` 与 `release/`（打包发布）、`docker/`（服务端镜像的 nginx 与启动脚本）、`gui-e2e.sh` / `linux-e2e.sh` 等 |
| `docker/daemon` | 在容器里运行成员机器（daemon）的镜像与 Compose 文件 |
| `Dockerfile`、`docker-compose.yml` | 服务端镜像与一键部署 |
| `videos` | 宣传片与功能讲解视频的源工程（HTML 动画，用 hyperframes 渲染），各目录自带说明 |
| `website` | 本帮助手册（VitePress），`scripts/` 下是截图脚本 |
| `docs` | 需求、设计与发版说明（`release-notes/`），作为背景参考；与代码冲突时以代码为准 |

## 服务器领域模块

位于 `apps/server/src/modules/`，每个目录一般包含 `routes.ts`（HTTP/WS 路由）和 `service.ts`（业务逻辑）。

| 模块 | 职责 |
| --- | --- |
| `admin` | 管理后台：系统参数（`params.ts`）、审计记录等 |
| `agent-tools` | 内置 MCP 中由服务器应答的工具（读聊天记录、群信息、运行记录、市场、知识库等），daemon 以正在进行的运行为凭据转发调用 |
| `approvals` | 权限审批：Agent 越权请求的创建、批准、拒绝与作废 |
| `artifacts` | 托管产物与多屏画布：版本、批注、分享 |
| `attachments` | 消息附件的上传、存储与下载 |
| `auth` | 登录、会话、注册，以及首次启动时创建 `admin`（`bootstrap.ts`） |
| `avatars` | 头像上传（含使用飞书头像） |
| `bots` | Bot 的增删改、所在机器、权限档位、审批方式与 Agent 配置、共享 |
| `candidates` | 输入框 @ 候选：向 Bot 的 daemon 取工作区文件列表，慢或离线时用缓存 |
| `commands` | 群里的指令（`/cd`、停止、系统指令、Agent 命令）解析与执行 |
| `conversation-stats` | 会话统计 |
| `feishu` | 飞书应用、登录、群绑定、卡片与消息同步 |
| `git` | 网页上的 Git 管理（分支、日志、提交、差异、冲突等），转发给 Bot 所在机器执行 |
| `git-accounts` | 成员的 Git 托管平台账号（令牌），用于仓库访问 |
| `group-tabs` | 群顶部的自定义标签页 |
| `groups` | 群与私聊：成员、Bot、设置、仓库 |
| `knowledge` | 群知识库条目与版本 |
| `live` | 实时画面（LiveKit）：观看、控制与 gg-cast 状态 |
| `machines` | 机器的绑定、接入确认、详情、升级、Git 访问、网络测量，以及经 daemon 实时读写的 Agent 工具 |
| `market` | Skill 市场：上架、审核、引入与封禁 |
| `mcp` | 平台、团队、群三层的 MCP 服务配置，建会话时注入（名称 `gonggong` 保留给内置服务） |
| `messages` | 消息发送、引用、撤回、运行中追加 |
| `notifications` | 通知中心与 Web Push 推送 |
| `pins` | 群置顶消息 |
| `plugins` | 插件的上传、启用、机器授权、内置插件与创作 |
| `previews` | 预览：隧道、网关代理、托管服务、公开分享链接 |
| `providers` | 机器的模型供应商：只实时转发给 daemon，不写数据库 |
| `questions` | Bot 向群成员提问的卡片与回答 |
| `reactions` | 消息表情回应 |
| `releases` | 客户端发布：上传 daemon 与桌面端构建，供自动升级下载 |
| `repos` | 团队仓库历史与仓库可访问性探测 |
| `runs` | 运行的核心：触发、调度、接收 daemon 上报、脱敏、停止、对账与保留期清理 |
| `saved` | 「稍后处理」：收藏的消息与提醒 |
| `schedules` | 定时任务 |
| `search` | 全局搜索（消息、改动过的文件） |
| `secrets` | 平台、团队、群、个人四层密钥 |
| `sidebar` | 会话列表的自定义分组 |
| `skills` | 团队、群、仓库、个人 Skill 与版本 |
| `sync` | 强制同步：同一个群多台机器共享一份工作区的版本、文件块与冲突处理 |
| `team-sections` | 团队目录与加入申请 |
| `teams` | 团队与成员 |
| `terminals` | 网页终端会话 |
| `threads` | 话题 |
| `usage` | 用量统计 |
| `users` | 用户资料卡片、停用 |
| `workspaces` | 每个（群，Bot）的工作区：准备、`/cd`、文件浏览、diff 与状态 |

## Web 功能目录

位于 `apps/web/src/features/`，每个目录带自己的英文词典 `en.ts`。

| 目录 | 内容 |
| --- | --- |
| `admin` | 管理后台布局与各页（账号、团队、群、机器、定时任务、系统参数、客户端发布、审计） |
| `artifacts` | 产物与原型画布 |
| `attachments` | 输入框附件、消息附件展示与查看器（含视频播放器） |
| `auth` | 登录、注册、修改密码、头像菜单 |
| `bots` | 新建 Bot、Bot 设置、Agent 配置、Bot 页、头像 |
| `chat` | 群消息主视图：消息时间线、输入框与候选、Git 条、上下文占用、新建群 |
| `config` | 管理后台 · 配置中心 |
| `conversation-stats` | 会话统计 |
| `diff` | diff 面板 |
| `feishu` | 飞书相关设置与绑定 |
| `files` | 文件查看器 |
| `git` | Git 面板：提交、日志、分支、冲突解决、贮藏 |
| `group-tabs` | 群顶部的标签页 |
| `groups` | 群信息、群公告、群设置 |
| `knowledge` | 知识库 |
| `machines` | 我的机器与 Bot、绑定新机器、机器详情、Agent 工具、供应商、空间管理 |
| `market` | Skill 市场 |
| `notifications` | 通知中心与浏览器推送 |
| `onboarding` | 新用户上手引导 |
| `plugins` | 插件管理与创作面板 |
| `previews` | 预览卡片、实时画面、分享链接、后台公开链接页 |
| `reactions` | 表情回应 |
| `repos` | 仓库选择与仓库访问检查 |
| `rich` | Bot 回复里的富内容（HTML 页面、Mermaid 图、操作按钮） |
| `runs` | 运行卡片与运行详情：过程、上下文、审批、提问、打断与追加 |
| `saved` | 稍后处理 |
| `schedules` | 定时任务 |
| `search` | 搜索浮层 |
| `secrets` | 密钥 |
| `settings` | 个人设置 |
| `sync` | 强制同步状态条、同步面板与冲突处理 |
| `teams` | 团队 |
| `terminal` | 终端 |
| `usage` | 用量页 |
| `users` | 用户卡片（悬停资料） |
| `workbench` | 右侧工作台的标签页（运行、diff、文件、网页、小程序、实时画面等） |
| `works` | 作品库 |
| `workspaces` | 工作区与目录选择 |

## 桌面端

| 位置 | 内容 |
| --- | --- |
| `apps/desktop/src/pages/` | 各页面：概览、Agent、Bot、工作区、穿透与服务、实时画面、市场、日志与诊断、设置，以及运行详情 |
| `apps/desktop/src/onboarding/` | 首次引导（绑定） |
| `apps/desktop/src/shell/`、`providers/` | 窗口外壳、供应商编辑 |
| `apps/desktop/src-tauri/src/commands/` | 每个页面对应的 Tauri 命令，调用 `crates/gonggong` |
| `apps/desktop/test/` | 桌面端界面测试（Vitest，IPC 用 `ipc-mock.ts` 模拟） |

## daemon 主要模块

位于 `crates/gonggong/src/`，`main.rs` 是 `gg` 命令行入口，`lib.rs` 汇总模块供桌面端复用。

| 模块 | 职责 |
| --- | --- |
| `daemon.rs` | daemon 整体句柄（`gg run` 与桌面端共用）：单实例锁、服务与引擎、吊销清理、实时状态 |
| `service.rs` | 与服务器的 WebSocket 连接、收发与按字节限额的发送缓冲 |
| `engine.rs` | 执行服务器下发的运行；每个（群，Bot）一个 ACP 适配器进程，安装固定版本的 Claude Code / Codex 适配器 |
| `adapters.rs` | 由内置 Agent 插件清单声明的适配器（Gemini CLI、CodeBuddy、pi、DeepSeek Harness），清单编译进二进制 |
| `session.rs` | 单个（群，Bot）会话：适配器进程、ACP 会话与轮次 |
| `turn.rs` | 每轮的纯逻辑：拼提示词、ACP 更新到运行事件的映射、权限档位策略 |
| `review.rs` | 「帮我审批」的 AI 预审 |
| `ledger.rs` | 估算会话上下文的构成（运行详情的「上下文」页签） |
| `web_call.rs` | 识别运行里的联网搜索与网页抓取 |
| `ask.rs` | 内置 `gonggong` MCP 服务（本机回环、每会话独立 URL）：向群成员提问、转发服务器工具、应答 daemon 工具 |
| `mcp_call.rs` | 解析 ACP 更新里的 MCP 工具调用（各 Agent 格式不同） |
| `protocol.rs` | 与 `packages/protocol` 对应的线上类型 |
| `agents.rs` | 检测本机已装的 Agent CLI 及版本 |
| `tools.rs` | 托管安装 Node.js 与 Agent CLI（不用 sudo、不动全局 npm） |
| `manage.rs` | 服务器发来的 Agent 工具、供应商、CC Switch 请求的应答 |
| `providers.rs`、`provider_cli.rs` | 本机模型供应商存储（`providers.json`，外发一律打码）与 `gg provider` 子命令 |
| `inject.rs` | 把运行使用的供应商注入适配器进程（密钥不进命令行参数和日志） |
| `agent_settings.rs`、`claude_args.rs` | Agent 设置项、Claude Code 命令行参数 |
| `ccswitch.rs` | 只读导入本机 CC Switch 的供应商 |
| `skills.rs`、`plugins.rs` | 把运行用到的 Skill、插件版本落到本机并交给 Agent |
| `local.rs` | 本机设置（`local.json`）：Agent CLI 路径、命令审批规则、模型目录 |
| `configure.rs` | `gg agents`、`gg config` 子命令 |
| `config.rs` | 本地状态根目录（`~/.gonggong`，可用 `GONGGONG_HOME` 覆盖）、绑定信息与证书信任 |
| `bind.rs` | 绑定登录、网页确认接入、上报给服务器的本机信息与机器标识 |
| `autostart.rs` | `gg service`：用 launchd（macOS）或 systemd 用户单元（Linux）常驻并开机启动 |
| `bots.rs` | `gg bots`：列出绑定在本机的 Bot |
| `workspace.rs`、`layout.rs` | 每个（群，Bot）的工作区：托管克隆、`/cd` 绑定、目录选择；托管工作区放在 `~/gonggong/workspaces/<群>/<Bot>/<仓库>` |
| `janitor.rs` | 后台清理已不存在的群与 Bot 留下的状态、久未使用的插件版本和旧的运行时 |
| `git.rs`、`git_ops.rs`、`git_write.rs`、`git_console.rs` | 工作区 Git 状态、只读视图、网页发起的写操作及其命令记录（调用本机 `git`） |
| `git_access.rs` | 网页管理的机器 Git 访问：SSH 密钥、HTTPS 令牌、访问测试 |
| `repo.rs` | 远程仓库标识与访问探测（ssh ⇄ https 回退） |
| `sync.rs`、`sync/`、`replicas.rs` | 强制同步：清单、文件块传输、三方合并，以及在运行前后追平与提交 |
| `artifacts.rs` | 托管产物在本机的同步与提交 |
| `files.rs`、`explorer.rs` | @ 文件候选、工作区只读文件浏览与路径校验 |
| `attachments.rs` | 附件落盘到工作区 `.gonggong/attachments/` |
| `terminal.rs` | 网页终端的 PTY 会话 |
| `tunnel.rs` | 预览隧道二进制帧与转发 |
| `previews.rs`、`hosted.rs`、`static_site.rs` | 本机预览与托管服务（由 daemon 持有进程，活得比单轮更久）、静态站点 |
| `html_render.rs`、`snapshot.rs` | 用本机 Chrome 系浏览器渲染 HTML 页面与预览首屏截图 |
| `cast.rs`、`wechatide.rs` | 实时画面（按需启动 gg-cast 推流）、微信开发者工具 |
| `open_apps.rs` | 用本地应用打开工作区 |
| `tls.rs` | 连接服务器的 HTTP(S)/WS(S)：按系统 CA、`--ca-file` 或 `--fingerprint` 校验证书；`http://` 只允许本机地址 |
| `net.rs` | 测量到服务器的延迟与带宽 |
| `upgrade.rs` | 自升级：下载新版本、校验 sha256、替换自身并在空闲时重启 |
| `revoke.rs` | 机器被吊销后清理托管工作区与令牌 |
| `diag.rs` | `gg doctor` 自检与脱敏诊断包 |
| `logs.rs` | daemon 日志（按天滚动 + 内存环形缓冲） |
| `status.rs` | 供界面读取的实时状态：连接、心跳、延迟、正在执行的运行 |
| `lock.rs` | 每个本地目录只允许一个 daemon（文件锁） |
| `proc.rs` | 子进程启动（Windows 上不弹控制台窗口） |
| `i18n.rs`、`i18n/en.rs` | 多语言：`t!` 宏与英文词典 |

## 相关页面

- [参与开发](/dev/)
- [协议](/dev/protocol)
- [系统架构](/guide/architecture)
