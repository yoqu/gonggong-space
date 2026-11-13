# 协议

本页介绍共工空间各组件之间的通信契约：`packages/protocol` 的组成、daemon 与服务器的消息与能力协商、ACP 与 Agent 适配器、内置 MCP 工具，以及预览隧道的二进制帧。

## 总览

```text
浏览器 ──REST /api + WS /ws/web──▶ 服务器 ◀──WS /ws/daemon（JSON）────────── daemon ──ACP（stdio）──▶ Agent 适配器 ──▶ Agent CLI
       ──WS /ws/terminals/:id────▶   ▲     WS /ws/daemon/tunnel（二进制帧）     │
                                     └──────── REST /api/daemon/* ◀─────────────┘
                                                                               daemon 内置 MCP（回环 HTTP）◀── Agent
```

所有 TypeScript 侧的契约都用 zod 定义在 `packages/protocol`，服务器、Web、桌面端直接引用；Rust 侧在 `crates/gonggong/src/protocol.rs` 手工镜像，并用共享 fixture 保证两边一致。

## packages/protocol 的组成

| 文件 | 内容 |
| --- | --- |
| `src/common.ts` | 两端共用的基础类型：Agent 类型（`claude`、`codex`、`gemini`、`codebuddy`、`pi`、`deepseek`）、权限档位、命令审批、运行状态、附件与提问上限、上下文占用等 |
| `src/web.ts` | Web ⇄ 服务器：REST 请求/响应 DTO（前缀 `/api`，会话用 httpOnly cookie），以及 `WS /ws/web` 上服务器推给浏览器的实时事件 |
| `src/daemon.ts` | daemon ⇄ 服务器：`DaemonToServer`、`ServerToDaemon` 两个按 `t` 字段区分的联合类型、`PROTOCOL_VERSION` 与可选能力 `DaemonFeature` |
| `src/tunnel.ts`、`src/terminal.ts` | 预览隧道的帧编解码与 `open` / `head` / `reset` 帧结构；网页终端的会话与控制消息 |
| `src/tools.ts`、`src/tool-titles.ts` | 内置 `gonggong` MCP 工具的入参定义（生成 `gonggong-tools.json` 与 `gonggong-daemon-tools.json`）与显示标题 |
| `src/agent-settings.ts` | 以控件形式提供的 Agent 设置项 |
| `src/plugins.ts`、`src/market.ts` | 插件清单 `gonggong-plugin.json` 与 Skill 市场 |
| `src/secrets.ts`、`src/schedules.ts`、`src/sync.ts`、`src/artifacts.ts`、`src/feishu.ts` | 密钥、定时任务、强制同步、托管产物、飞书联动各自的契约 |
| `src/ui-blocks.ts`、`src/html-render.ts` | Bot 回复里的富内容块与内嵌 HTML 页面 |
| `src/i18n.ts`、`src/i18n-en.ts`、`src/translate.ts` | 多语言核心（中文原文即 key）与跨端共用的英文文案 |
| `src/mentions.ts`、`src/repo.ts`、`src/notification-view.ts`、`src/version.ts` | `@Bot` 识别、仓库地址规范化、通知展示、版本比较等小工具 |
| `fixtures/*.json` | daemon 协议、隧道帧、终端控制与部分 daemon HTTP 接口的共享样例，TS 与 Rust 都要能往返 |
| `cases/*.json` | 其他跨语言共享用例（如隧道帧编码、仓库地址规范化） |

## daemon ⇄ 服务器

daemon 用机器令牌连接 `WS /ws/daemon`，每条消息是一个带 `t` 字段的 JSON 对象。

- **握手**：daemon 发 `hello`（协议版本、令牌、daemon 版本、机器信息、Agent 列表、仍在执行的运行与托管服务、终端会话、`features` 能力列表）；服务器回 `welcome`（机器 id、心跳间隔、可用的新版本、是否开启预览隧道、服务器是否发布了本平台的 daemon 构建），或回 `reject`（原因为 `protocol` / `revoked` / `unauthorized`，协议过旧时附带最低协议版本与升级信息）。
- **服务器 → daemon**（`s2d`）：运行（`run.start`、`run.cancel`、`run.append`、`run.tier`…）、审批与提问回复、工作区（`workspace.*`）、文件（`files.*`、`dir.*`）、Git（`git.*`、`gitaccess.cmd`）、预览与实时画面（`previews.sync`、`cast.*`）、Agent 工具与供应商（`tools.cmd`、`providers.cmd`、`ccswitch.*`）、托管服务、日志、诊断、升级（`upgrade.start`）等。
- **daemon → 服务器**（`d2s`）：`heartbeat`、`run.event`（文本、思考、工具调用、用量等流式事件）、`run.done`、`approval.request`、`question.ask`、`workspace.state`、`session.config`、`commands.update`、`agents.update`、各类 `*.result` 等。

另有一批请求走 REST（`/api/daemon/*`，机器令牌鉴权），如登录绑定与网页确认接入、内置 MCP 工具调用、附件与产物上传下载、Skill 与插件版本下载、强制同步的文件块、网络测量、升级包下载。

### 能力协商

协议版本 `PROTOCOL_VERSION` 只在不兼容时才提升，低于它的 daemon 会被 `reject`。日常的新功能通过 **`DaemonFeature` 能力**协商：daemon 在 `hello.features` 里声明自己支持的能力（如 `gitOps3`、`terminal-v2`、`storageAdmin`、`artifacts`、`upgrade`、`gemini`、`builtinReview`），服务器据此决定是否下发对应消息；daemon 不支持时，网页上的相关操作会被拒绝或隐藏，而不是发出旧版 daemon 读不懂的消息。

新增一类 daemon 消息或字段时，如果旧 daemon 会误解或丢弃它，就在 `DaemonFeature` 里加一项能力并在服务器侧判断。

### fixture 往返测试

每类消息在 `packages/protocol/fixtures/` 下至少有一个样例，文件名规则为 `<类别>.<名称>[.<变体>].json`。类别有：`d2s`、`s2d`（WebSocket 消息）、`tunnel`、`terminal`（帧与控制消息）、`http`（daemon REST 接口的请求与响应）、`data`（两边必须一致的数据表），如 `d2s.run.event.tool.json`、`s2d.run.start.json`。

两边各有一个测试遍历整个目录：

- TS：`packages/protocol/test/fixtures.test.ts` 用 zod 解析每个样例，并检查文件名与消息 `t` 字段一致。
- Rust：`crates/gonggong/tests/it/contract.rs` 把每个样例反序列化再序列化，要求与原文一致（忽略 `null` 字段），遇到不认识的类别直接失败；同时校验 `cases/tunnel-frames.json` 的帧编码。

所以协议有变化时，先改 `packages/protocol`，再为新消息或新字段加 fixture，最后更新 `protocol.rs`，`pnpm -r test` 与 `cargo test --workspace` 都通过才算完成。

## ACP 与 Agent 适配器

daemon 不直接调用各家 CLI，而是通过 [Agent Client Protocol（ACP）](https://agentclientprotocol.com) 驱动适配器。daemon 是 ACP 客户端（Rust crate `agent-client-protocol`），适配器是 ACP Agent，二者经 stdio 通信。

- **Claude Code 与 Codex**：适配器版本固定在 `crates/gonggong/src/engine.rs`（`@agentclientprotocol/claude-agent-acp`、`@agentclientprotocol/codex-acp`），首次使用时从配置的 npm 镜像安装到 daemon 本地目录。
- **Gemini CLI、CodeBuddy、pi、DeepSeek Harness**：由服务器内置插件 `apps/server/plugins/official/agent-*` 的清单（`contributes.agents`）声明怎么安装、启动和驱动，`crates/gonggong/src/adapters.rs` 在编译时把清单和启动脚本打进二进制。
- 每个（群，Bot）对应一个适配器进程和一个 ACP 会话（`session.rs`），同一时间只跑一轮；daemon 会尽量恢复之前的会话，恢复失败时开新会话并补发最近的群消息。
- `turn.rs` 负责拼提示词、把 ACP 的 `session/update` 映射为 `run.event`，并按 Bot 的权限档位与审批方式处理 `session/request_permission`。
- 调试时可用 `GONGGONG_ADAPTER_CMD` 替换所有 Agent 的适配器命令，例如指向 `tools/mock-agent/agent.js`（基于 `@agentclientprotocol/sdk` 的模拟 Agent）。

## 内置 MCP 工具

daemon 为每个会话在本机回环地址上开一个名为 `gonggong` 的 MCP 服务（Streamable HTTP，每个会话独立的密钥 URL，见 `ask.rs`），建会话时注入给 Agent。工具分三类：

| 类别 | 示例 | 由谁应答 |
| --- | --- | --- |
| 向群成员提问 | `ask_group_members` | daemon 转成提问卡片，等群成员回答或超时 |
| 服务器工具（`gonggong-tools.json`） | 聊天记录（`list_messages`、`search_messages`）、群与运行（`get_group_info`、`get_run`）、预览（`preview_expose`）、协作（`hand_off`、`thread_create`、`progress_card`）、定时任务（`schedule_*`）、Skill（`skill_*`）、市场（`market_*`）、知识库（`kb_*`）、群标签页（`tab_*`）、MCP 配置（`mcp_*`）、密钥（`secret_*`）、插件与创作（`plugin_catalog`、`creation_propose`）、产物（`artifact_checkout`）等 | daemon 带机器令牌转发到 `POST /api/daemon/runs/:runId/tools/:name`，由服务器查询、鉴权并返回文本 |
| daemon 工具（`gonggong-daemon-tools.json`） | `send_attachments`、`service_*`、`preview_static`、`preview_miniprogram`、`html_preview`、`html_render`、`feishu_send_card`、`client_release_publish`、`client_release_notes` | daemon 自己应答（附件、托管服务、静态站点、小程序、HTML 渲染等） |

要点：

- 工具的唯一来源是 `packages/protocol/src/tools.ts`（zod），两个 JSON 文件由它生成；daemon 用 `include_str!` 编译进二进制，服务器用 zod 校验入参。`packages/protocol/test/tools.test.ts` 断言 JSON 与 zod 定义一致，改了工具定义必须同步更新 JSON。
- 服务器工具以**正在进行的运行**为凭据：群和 Bot 都从运行推出，不信任参数；两轮之间调用会直接报错。写操作以本轮发起人的身份鉴权，管理类工具按发起人的角色裁剪；未绑定飞书或未启用插件的群不会列出相应工具。
- `service_start`、`preview_miniprogram`、`client_release_publish` 会执行代码或往成员机器分发程序，需要走 Bot 的命令审批，其余内置工具自动放行。
- 平台、团队、群配置的 MCP 服务也会在建会话时注入，名称 `gonggong` 保留给内置服务。

## 预览隧道

服务器把浏览器对预览的 HTTP 请求和升级连接（WebSocket、HMR）多路复用到一条二进制 WebSocket `/ws/daemon/tunnel` 上，由 daemon 转发到本机。网页终端、工作区文件读取与预览首屏截图也走这条隧道。

帧格式：

```text
[streamId: u32 大端][type: u8][payload]
```

| type | 名称 | payload |
| --- | --- | --- |
| 1 | `open` | JSON：方法、路径、请求头、是否升级，以及目标（预览端口、工作区只读文件、预览首屏截图、终端会话） |
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
