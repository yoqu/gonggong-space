# 系统架构

本页说明共工空间由哪些部分组成、一条 @Bot 消息怎样变成机器上的实际操作，以及数据和密钥分别留在哪里。

## 组成

```text
浏览器 Web（React + Vite）· 桌面端 · 飞书
   │  HTTPS /api（请求）  ·  WSS /ws/web（实时推送）
   ▼
服务器（Fastify + PostgreSQL，附件与数据目录）
   │  WSS /ws/daemon（任务与事件）  ·  WSS /ws/daemon/tunnel（预览隧道）
   ▼
成员机器上的 daemon（gg 或桌面端）
   ├─ ACP ──→ Claude Code / Codex / Gemini CLI / CodeBuddy / pi / DeepSeek Harness / Antigravity CLI
   ├─ 内置 MCP（gonggong）
   └─ 工作区 ~/gonggong/workspaces/…
```

所有连接都由 daemon 主动发起到服务器，成员机器不需要对外开放端口。

| 部分 | 技术 | 职责 |
| --- | --- | --- |
| Web | React + Vite | 登录、群消息、@Bot、运行过程 / diff / Git / 文件、审批、预览与作品、市场、机器与 Bot、管理后台；适配手机浏览器 |
| 服务器 | Fastify + PostgreSQL | 账号与权限、群与消息、调度运行与定时任务、转发 daemon 事件、存附件与作品、预览入口、审计 |
| daemon | Rust，命令行 `gg` | 在成员机器上接活：准备工作区、启动 Agent、回传过程、执行审批决定、维持预览隧道、Git 操作与终端会话 |
| 桌面端 | Tauri（macOS、Windows） | 内置同一套 daemon，加上图形界面（概览、Agent、Bot、工作区、穿透与服务、实时画面、市场、日志与诊断、设置） |
| Agent 接入 | ACP | daemon 通过 [ACP](https://agentclientprotocol.com)（Agent Client Protocol）驱动各家 Agent，拿到结构化的思考、工具调用与权限请求 |
| 预览隧道 | daemon ↔ 服务器的 WebSocket | 把浏览器对预览的访问转发到成员机器的本地端口 |

### Agent 接入

daemon 不解析 CLI 的终端输出，而是通过 ACP 与 Agent 通信：

| Agent | 接入方式 |
| --- | --- |
| Claude Code | 固定版本的 ACP 适配器 `@agentclientprotocol/claude-agent-acp` |
| Codex | 固定版本的 ACP 适配器 `@agentclientprotocol/codex-acp` |
| Gemini CLI、CodeBuddy、DeepSeek Harness、Antigravity CLI | 内置 Agent 插件，用 CLI 自带的 ACP 模式 |
| pi | 内置 Agent 插件，经 `pi-acp` 适配器接入 |

适配器首次使用时由 npm 自动安装到 `~/.gonggong/adapters/`（默认走 npmmirror 镜像）。Agent 调用的是机器上已安装的 CLI，模型、登录方式、账号额度沿用本机配置，或使用在机器上配置的供应商。

每个「群 × Bot」对应一个 Agent 进程和一个 ACP 会话；空闲 10 分钟后进程回收，下一轮在新进程中恢复会话，Bot 仍记得之前的对话。

### 内置 MCP

daemon 为每个会话在本机回环地址上提供一个名为 `gonggong` 的 MCP 服务，Agent 通过它与群协作，例如：

- 读取、检索本群聊天记录，查看群信息、运行记录、历史提问与附件，发送附件；
- 向群成员提问（等待有人回答），请成员填写密钥；
- 发布预览（网页服务、静态页面、桌面应用、小程序）、管理托管服务、把网页渲染进聊天；
- 把任务交给另一个 Bot（接力）、开话题指派 Bot 接手、创建定时任务；
- 维护群知识库，管理 Skill、MCP 与市场条目。

可用的工具按发起人的身份和群的配置精简：没绑定飞书或没启用插件的群，不会向 Bot 列出相应工具。

## 一条消息的旅程

以李娜在群「todo-app」里发送 `@后端助手 给待办加一个截止日期字段` 为例：

1. **发消息**：Web 把消息发到服务器，服务器解析出被 @ 的 Bot。
2. **校验与建运行**：服务器检查李娜是否在后端助手的触发范围内——不在则运行卡片显示「无权触发」；在则创建一轮运行，状态「排队中」。
3. **调度**：Bot 所在机器在线、并发未满、本群上一轮已结束、工作区已就绪时，服务器把任务（含消息、群聊上下文、审批方式、本轮生效的 Skill 与 MCP 等）发给那台机器的 daemon；机器离线时运行显示「离线等待」，上线后再派发，超时作废。
4. **执行**：daemon 在该「群 × Bot」的工作区里，通过 ACP 让 Agent 开始这一轮；所需密钥只以环境变量注入。Agent 读代码、改文件、执行命令。
5. **过程回传**：Agent 的思考、工具调用、命令输出经 daemon 实时发回服务器，服务器脱敏后入库，并通过 `/ws/web` 推送给正在看的群成员。
6. **审批 / 提问**：Agent 请求需要把关的操作时，daemon 先按 Bot 的审批方式与规则在本机判断（「帮我审批」时可能交给 Agent 内置审核或 AI 预审）；需要人决定时群里出现审批卡片，Bot 主人批准或拒绝后结果再下发给 daemon。提问同理。
7. **结束**：daemon 回报最终回复与本轮 diff，运行卡片变为「已完成」。如果 Bot 通过「交给其他 Bot」工具把任务交给了其他 Bot，服务器会以它的名义发消息 @ 下一个 Bot，开始下一跳接力（链长受群设置「接力链长上限（跳）」限制）。

## 数据留在哪里

| 数据 | 位置 |
| --- | --- |
| 工作区（仓库克隆、Bot 的改动） | 成员机器 `~/gonggong/workspaces/` 或 Bot 主人指定的本机目录 |
| git 凭据 | 成员机器，Bot 用归属人自己的凭据访问仓库 |
| Agent 登录态、模型供应商的 Key 与地址 | 成员机器，只存本机，不上传服务器 |
| daemon 的本地配置、日志、适配器 | 成员机器 `~/.gonggong/` |
| 账号、群、消息、运行卡片、审批与提问记录 | 服务器数据库（入库前脱敏） |
| 运行过程的自由文本、本轮 diff | 服务器数据库，加密存储 |
| 附件 | 服务器数据目录，加密存储 |
| 平台 / 团队 / 群 / 个人密钥 | 服务器加密保存，运行时以环境变量注入 Bot，过程与回复里按值打码 |

::: tip
服务器只做调度与中继：代码的读写和命令执行都发生在成员机器上。服务器能看到的是 Agent 回传的过程、最终回复和本轮 diff（均经脱敏，diff 与过程加密存储）。完整说明见 [安全模型](/deploy/security)。
:::

## 连接与认证

- **daemon 认证**：daemon 用 Web「绑定新机器」生成的一次性接入码换取长期机器 token。接入码 30 分钟内有效；过期或已用过时，`gg login` 不会直接失败，而是发起接入申请，打印确认链接和 4 位核对码，机器主人在网页上核对后点「允许接入」即可完成绑定。
- **传输**：服务器配置证书（`GONGGONG_TLS_CERT` + `GONGGONG_TLS_KEY`）或放在 HTTPS 反向代理之后。daemon 连接非本机服务器必须用 `https://`，并校验服务器证书：默认按系统信任的 CA；自签证书用 `gg login --fingerprint`，私有 CA 用 `gg login --ca-file` 指定信任。
- **心跳**：daemon 连接后定期发送心跳（默认 15 秒），连续多次未收到即判定离线。
- **升级**：daemon 连上后会自动升级到服务器「客户端发布」里的版本，下载后在没有任务运行时重启，不打断正在运行的任务。
- **吊销**：管理员停用账号或吊销机器后，daemon 下次连接被拒绝，并清除本机凭据和托管工作区（Bot 主人指定的本机目录不会被删除）。

证书的生成与部署见 [HTTPS 与证书](/deploy/https)，协议细节见 [协议](/dev/protocol)。

## 相关页面

- [核心概念](/guide/concepts)
- [部署概览](/deploy/)
- [安全模型](/deploy/security)
- [仓库结构](/dev/structure)
