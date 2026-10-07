# 系统架构

本页说明共工空间由哪些部分组成、一条 @Bot 消息怎样变成机器上的实际操作，以及数据和密钥分别留在哪里。

## 组成

```text
浏览器 Web（React + Vite）
   │  HTTPS /api（请求）  ·  WSS /ws/web（实时推送）
   ▼
服务器（Fastify + PostgreSQL，附件与数据目录）
   │  WSS /ws/daemon（任务与事件）  ·  WSS /ws/daemon/tunnel（预览隧道）
   ▼
成员机器上的 daemon（gg run 或桌面端）
   ├─ ACP 适配器 ──→ Claude Code / Codex（本机已登录的 CLI）
   ├─ 内置 MCP（gonggong）
   └─ 工作区 ~/.gonggong/workspaces/…
```

所有连接都由 daemon 主动发起到服务器，成员机器不需要对外开放端口。

| 部分 | 技术 | 职责 |
| --- | --- | --- |
| Web | React + Vite | 登录、群消息、@Bot、查看运行过程 / diff / 文件、审批、预览、管理后台 |
| 服务器 | Fastify + PostgreSQL | 账号与权限、群与消息、调度运行、转发 daemon 事件、存附件、预览入口、审计 |
| daemon | Rust，命令行 `gg` | 在成员机器上接活：准备工作区、启动 Agent、回传过程、执行审批决定、维持预览隧道 |
| 桌面端 | Tauri（macOS） | 内置同一套 daemon，加上图形界面（概览、Agent、Bot、工作区、穿透与服务、实时画面、日志与诊断、设置） |
| ACP 适配器 | npm 包 | 把 Claude Code / Codex 包装成 [ACP](https://agentclientprotocol.com)（Agent Client Protocol）接口，daemon 通过它驱动 Agent |
| 预览隧道 | daemon ↔ 服务器的 WebSocket | 把浏览器对预览的访问转发到成员机器的本地端口 |

### ACP 适配器

daemon 不直接解析 CLI 的输出，而是通过 ACP 与 Agent 通信。它使用两个固定版本的适配器，首次运行时用 npm 自动安装到 `~/.gonggong/adapters/`（默认走 npmmirror 镜像）：

| Agent | 适配器 |
| --- | --- |
| Claude Code | `@agentclientprotocol/claude-agent-acp` |
| Codex | `@agentclientprotocol/codex-acp` |

适配器调用的是机器上已安装、已登录的 `claude` / `codex` CLI，因此模型、登录方式、账号额度都沿用本机配置。每个「群 × Bot」对应一个适配器进程和一个 ACP 会话；空闲 10 分钟后进程回收，下一轮在新进程中恢复会话，Bot 仍记得之前的对话。

### 内置 MCP

daemon 为每个会话在本机回环地址上提供一个名为 `gonggong` 的 MCP 服务，Agent 通过它：

- 读取、检索本群聊天记录，查看群信息、运行记录、历史提问与附件；
- 向群成员提问（等待有人回答）；
- 发布预览（网页服务、静态页面、桌面应用、小程序）和管理托管服务；
- 把任务交给群里另一个 Bot（接力）。

## 一条消息的旅程

以李娜在群「todo-app」里发送 `@后端助手 给待办加一个截止日期字段` 为例：

1. **发消息**：Web 把消息发到服务器，服务器解析出被 @ 的 Bot。
2. **校验与建运行**：服务器检查李娜是否在后端助手的触发范围内——不在则运行卡片显示「无权触发」；在则创建一轮运行，状态「排队中」。
3. **调度**：Bot 所在机器在线、并发未满、本群上一轮已结束、工作区已就绪时，服务器把任务（`run.start`，含消息、上下文、权限档位、命令审批规则等）发给那台机器的 daemon；机器离线时运行显示「离线等待」，上线后再派发，超时作废。
4. **执行**：daemon 在该「群 × Bot」的工作区里，通过 ACP 让 Agent 开始这一轮；Agent 读代码、改文件、执行命令。
5. **过程回传**：Agent 的思考、工具调用、命令输出经 daemon 以 `run.event` 实时发回服务器，服务器脱敏后入库，并通过 `/ws/web` 推送给正在看的群成员。
6. **审批 / 提问**：Agent 请求超出权限档位的操作时，daemon 先按 Bot 的命令审批规则在本机判断；需要人决定时发 `approval.request`，群里出现审批卡片，Bot 主人批准或拒绝后结果再下发给 daemon。提问同理。
7. **结束**：daemon 发 `run.done`，附带最终回复与本轮 diff；运行卡片变为「已完成」。如果 Bot 通过「交给其他 Bot」工具把任务交给了其他 Bot，服务器会以它的名义发消息 @ 下一个 Bot，开始下一跳接力（链长受群设置「接力链长上限（跳）」限制）。

## 数据留在哪里

| 数据 | 位置 |
| --- | --- |
| 工作区（仓库克隆、Bot 的改动） | 成员机器 `~/.gonggong/workspaces/` 或 `/cd` 绑定的本机目录 |
| git 凭据 | 成员机器，Bot 用归属人自己的凭据访问仓库 |
| Agent 登录态、模型供应商的 Key 与地址 | 成员机器，只存本机，不上传服务器 |
| daemon 的本地配置、日志 | 成员机器 `~/.gonggong/` |
| 账号、群、消息、运行卡片、审批与提问记录 | 服务器数据库（入库前脱敏） |
| 运行过程的自由文本、本轮 diff | 服务器数据库，加密存储 |
| 附件 | 服务器数据目录，加密存储 |

::: tip
服务器只做调度与中继：代码的读写和命令执行都发生在成员机器上。服务器能看到的是 Agent 回传的过程、最终回复和本轮 diff（均经脱敏，diff 与过程加密存储）。完整说明见 [安全模型](/deploy/security)。
:::

## 连接与认证

- **daemon 认证**：成员在 Web「绑定新机器」生成一次性接入链接（`gonggong://bind?…`）或 `gg login` 命令，daemon 用它换取长期机器 token。
- **传输**：daemon 可用 `http://` 或 `https://` 连接任意服务器。服务器配置证书（`GONGGONG_TLS_CERT` + `GONGGONG_TLS_KEY`）后只提供 HTTPS / WSS；daemon 接受服务器出示的任何证书（含自签），不校验证书指纹，绑定即用，换证书也不用重新绑定。
- **心跳**：daemon 连接后定期发送心跳（默认 15 秒），连续多次未收到即判定离线。
- **吊销**：管理员停用账号或吊销机器后，daemon 下次连接被拒绝，并清除本机凭据和托管工作区。

证书的生成与部署见 [HTTPS 与证书](/deploy/https)，协议细节见 [协议](/dev/protocol)。

## 相关页面

- [核心概念](/guide/concepts)
- [部署概览](/deploy/)
- [安全模型](/deploy/security)
- [仓库结构](/dev/structure)
