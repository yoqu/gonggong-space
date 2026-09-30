# 协议

本页介绍共工空间各组件之间的通信契约：`packages/protocol` 的组成、daemon 与服务器的消息、ACP 与 Agent 适配器、内置 MCP 工具，以及预览隧道的二进制帧。

## 总览

```text
浏览器 ──REST /api + WS /ws/web──▶ 服务器 ◀──WS /ws/daemon（JSON）── daemon ──ACP（stdio）──▶ Agent 适配器 ──▶ Claude Code / Codex
                                     ▲       WS /ws/daemon/tunnel（二进制帧）   │
                                     └─────── REST /api/daemon/* ◀─────────────┘
                                                                              daemon 内置 MCP（回环 HTTP）◀── Agent
```

所有 TypeScript 侧的契约都用 zod 定义在 `packages/protocol`，服务器、Web、桌面端直接引用；Rust 侧在 `crates/gonggong/src/protocol.rs` 手工镜像，并用共享 fixture 保证两边一致。

## packages/protocol 的组成

| 文件 | 内容 |
| --- | --- |
| `src/common.ts` | 两端共用的基础类型：Agent 类型（`claude` / `codex`）、权限档位、命令审批、运行状态、附件与提问上限、上下文占用等 |
| `src/web.ts` | Web ⇄ 服务器：REST 请求/响应 DTO（前缀 `/api`，会话用 httpOnly cookie），以及 `WS /ws/web` 上服务器推给浏览器的实时事件（如 `message.new`、`run.updated`、`run.delta`） |
| `src/daemon.ts` | daemon ⇄ 服务器：`DaemonToServer`、`ServerToDaemon` 两个按 `t` 字段区分的联合类型，以及 `PROTOCOL_VERSION` |
| `src/tunnel.ts` | 预览隧道的帧编解码与 `open` / `head` / `reset` 帧的 JSON 结构 |
| `src/tools.ts` | 内置 `gonggong` MCP 工具的入参定义，生成 `gonggong-tools.json` 与 `gonggong-daemon-tools.json` |
| `src/mentions.ts` | 消息里 `@Bot` 的识别 |
| `src/repo.ts` | 仓库地址格式与规范化 |
| `src/notification-view.ts` | 通知的展示文案与跳转 |
| `fixtures/*.json` | daemon 协议与隧道帧的共享样例，TS 与 Rust 都要能往返 |
| `cases/*.json` | 其他跨语言共享用例（如隧道帧编码、仓库地址规范化） |

## daemon ⇄ 服务器

daemon 用机器令牌连接 `WS /ws/daemon`，每条消息是一个带 `t` 字段的 JSON 对象。

- **握手**：daemon 发 `hello`（协议版本、令牌、daemon 版本、机器信息、Agent 列表、仍在执行的运行）；服务器回 `welcome`（机器 id、心跳间隔、可用的新版本、是否开启预览隧道），或回 `reject`（原因为 `protocol` / `revoked` / `unauthorized`，协议不兼容时附带升级信息）。
- **服务器 → daemon**（`s2d`）：`run.start`、`run.cancel`、`run.append`、`run.tier`、`approval.decision`、`question.answer`、`workspace.ensure`、`workspace.cd`、`workspace.diff`、`files.*`、`dir.list`、`repo.probe`、`previews.sync`、`cast.*`、`tools.cmd`、`providers.cmd`、`ccswitch.*`、`service.*` 等。
- **daemon → 服务器**（`d2s`）：`heartbeat`、`run.event`（文本、思考、工具调用、用量等流式事件）、`run.done`、`approval.request`、`question.ask`、`workspace.state`、`session.config`、`commands.update`、`agents.update`、各类 `*.result` 等。

另有少量请求走 REST（`/api/daemon/*`，机器令牌鉴权），如登录绑定、内置 MCP 工具调用、网络测量、下载附件与升级包。

### fixture 往返测试

每类消息在 `packages/protocol/fixtures/` 下至少有一个样例，文件名规则为 `<方向>.<消息类型>[.<变体>].json`，方向是 `d2s`、`s2d` 或 `tunnel`，如 `d2s.run.event.tool.json`、`s2d.run.start.json`。

两边各有一个测试遍历整个目录：

- TS：`packages/protocol/test/fixtures.test.ts` 用 zod 解析每个样例，并检查文件名与消息 `t` 字段一致。
- Rust：`crates/gonggong/tests/contract.rs` 把每个样例反序列化再序列化，要求与原文一致（忽略 `null` 字段）；同时校验 `cases/tunnel-frames.json` 的帧编码。

所以协议有变化时，先改 `packages/protocol`，再为新消息或新字段加 fixture，最后更新 `protocol.rs`，`pnpm -r test` 与 `cargo test --workspace` 都通过才算完成。

## ACP 与 Agent 适配器

daemon 不直接调用 Claude Code 或 Codex，而是通过 [Agent Client Protocol（ACP）](https://agentclientprotocol.com) 驱动官方适配器。daemon 是 ACP 客户端（Rust crate `agent-client-protocol`），适配器是 ACP Agent，二者经 stdio 通信。

- 适配器版本固定在 `crates/gonggong/src/engine.rs` 的 `ADAPTERS` 中（`@agentclientprotocol/claude-agent-acp`、`@agentclientprotocol/codex-acp`），首次使用时从配置的 npm 镜像安装到 daemon 本地目录。
- 每个（群，Bot）对应一个适配器进程和一个 ACP 会话（`session.rs`），同一时间只跑一轮；daemon 会尽量恢复之前的会话，恢复失败时开新会话并补发最近的群消息。
- `turn.rs` 负责拼提示词、把 ACP 的 `session/update` 映射为 `run.event`，并按 Bot 的权限档位处理 `session/request_permission`。
- 调试时可用 `GONGGONG_ADAPTER_CMD` 替换所有 Agent 的适配器命令，例如指向 `tools/mock-agent/agent.js`（基于 `@agentclientprotocol/sdk` 的模拟 Agent）。

## 内置 MCP 工具

daemon 为每个会话在本机回环地址上开一个名为 `gonggong` 的 MCP 服务（Streamable HTTP，每个会话独立的密钥 URL，见 `ask.rs`），建会话时注入给 Agent。工具分三类：

| 类别 | 工具 | 由谁应答 |
| --- | --- | --- |
| 向群成员提问 | `ask_group_members` | daemon 转成提问卡片，等群成员回答或超时 |
| 服务器工具（`gonggong-tools.json`） | `list_messages`、`search_messages`、`get_group_info`、`get_run`、`list_questions`、`fetch_attachments`、`preview_expose`、`preview_gui`、`preview_close`、`hand_off` | daemon 带机器令牌转发到 `POST /api/daemon/runs/:runId/tools/:name`，由服务器查询、鉴权并返回文本 |
| daemon 工具（`gonggong-daemon-tools.json`） | `service_start`、`service_list`、`service_logs`、`service_stop`、`preview_static`、`preview_miniprogram` | daemon 自己应答（托管服务、静态站点、小程序） |

要点：

- 工具的唯一来源是 `packages/protocol/src/tools.ts`（zod），两个 JSON 文件由它生成；daemon 用 `include_str!` 编译进二进制，服务器用 zod 校验入参。`packages/protocol/test/tools.test.ts` 断言 JSON 与 zod 定义一致，改了工具定义必须同步更新 JSON。
- 服务器工具以**正在进行的运行**为凭据：群和 Bot 都从运行推出，不信任参数；两轮之间调用会直接报错。
- 除 `service_start` 和 `preview_miniprogram`（会执行代码）需要走 Bot 的命令审批外，其余内置工具自动放行。
- 管理员在配置中心添加的全局 MCP 服务也会在建会话时注入，名称 `gonggong` 保留给内置服务。

## 预览隧道

服务器把浏览器对预览的 HTTP 请求和升级连接（WebSocket、HMR）多路复用到一条二进制 WebSocket `/ws/daemon/tunnel` 上，由 daemon 转发到本机回环端口。

帧格式：

```text
[streamId: u32 大端][type: u8][payload]
```

| type | 名称 | payload |
| --- | --- | --- |
| 1 | `open` | JSON：方法、路径、请求头、是否升级，以及目标（预览端口、工作区只读文件、预览首屏截图） |
| 2 | `head` | JSON：响应状态与响应头 |
| 3 | `data` | 请求/响应体字节；升级（101）后是原始连接字节 |
| 4 | `end` | 空，表示该方向结束 |
| 5 | `reset` | JSON：中止原因，该流随即关闭 |

- 流只能由服务器发起；每台机器最多 64 个并发流（`TUNNEL_MAX_STREAMS`）。
- 单个流最多缓冲 16 MiB（`TUNNEL_STREAM_BUFFER`），读端跟不上时重置该流，而不是拖慢整条连接。
- daemon 只转发 `previews.sync` 列出的已开启预览端口，其余端口不可达。
- TS 实现在 `packages/protocol/src/tunnel.ts`，Rust 实现在 `crates/gonggong/src/tunnel.rs`，两者共用 `cases/tunnel-frames.json` 与 `fixtures/tunnel.*.json` 测试。

## 相关页面

- [仓库结构](/dev/structure)
- [贡献指南](/dev/contributing)
- [系统架构](/guide/architecture)
