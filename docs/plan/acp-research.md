# ACP 客户端调研（2026-09-23）

依据：agentclientprotocol.com 文档、crates.io 源码（agent-client-protocol 2.2.0 / schema 1.9.1，已在 ~/.cargo/registry 中阅读）、npm tarball 源码（已解包到 scratchpad/pkgs/）。
[未验证] = 未在源码或文档中直接确认。

## 0. 本地环境

| 项目 | 值 |
|---|---|
| `claude --version` | 2.1.280 (Claude Code) |
| `codex --version` | codex-cli 0.156.1 |
| crate `agent-client-protocol` | **2.2.0**（2026-09-18），schema crate `=1.9.1` |
| crate `agent-client-protocol-tokio` | 0.11.1 |
| npm `@agentclientprotocol/sdk` | 1.5.0 |
| npm `@agentclientprotocol/claude-agent-acp` | **0.81.0**（当前包名） |
| npm `@zed-industries/claude-agent-acp` | 0.23.1，**已 deprecated**（已改名） |
| npm `@zed-industries/claude-code-acp` | 0.16.2，**已 deprecated** |
| npm `@agentclientprotocol/codex-acp` | **1.13.0**（当前包名） |
| npm `@zed-industries/codex-acp` | 0.16.0，**已 deprecated**（原 Rust 预编译二进制包） |

## 1. 协议

- 线上稳定版：**protocolVersion = 1**（整数，只表示主版本）。新特性通过 capabilities 增加。
- **ACP v2 已有文档，但标为 draft**：https://agentclientprotocol.com/protocol/v2/migration.md 。v2 的主要变化：prompt 响应只表示“已接受”（`{}`），完成信号改为 `state_update`（idle + stopReason）；删除 `session/load`（改用 `session/resume` + `replayFrom`）、`session/set_mode`、`fs/*`、`terminal/*`；`tool_call` 并入 `tool_call_update` upsert；`plan` 改为 `plan_update`。两个适配器目前都只返回 `protocolVersion: 1`。**建议只实现 v1**，并按 v1/v2 分层，后续再加 v2。
- 文档：overview https://agentclientprotocol.com/protocol/overview · schema https://agentclientprotocol.com/protocol/v1/schema.md · llms.txt https://agentclientprotocol.com/llms.txt

### v1 方法全集（来自 schema 1.9.1 源码常量）
Agent 侧（客户端调用）：`initialize`, `authenticate`, `logout`, `session/new`, `session/load`, `session/resume`, `session/list`, `session/close`, `session/delete`, `session/prompt`, `session/cancel`（通知）, `session/set_mode`, `session/set_config_option`；不稳定（需开 feature）：`session/fork`, `providers/list|set|disable`。
Client 侧（Agent 调用，客户端实现）：`session/request_permission`, `fs/read_text_file`, `fs/write_text_file`, `terminal/create|output|release|wait_for_exit|kill`, `elicitation/create`, `session/update`（通知）；不稳定：`mcp/connect|message|disconnect`。协议级：`$/cancel_request`。
v1 中 `session/resume`, `session/list`, `session/close`, `session/delete` **已稳定**，用 `agentCapabilities.sessionCapabilities.{resume,list,close,delete,additionalDirectories}: {}` 声明是否支持（对象形式）。

### initialize
```json
{"jsonrpc":"2.0","id":0,"method":"initialize","params":{
  "protocolVersion":1,
  "clientCapabilities":{"fs":{"readTextFile":true,"writeTextFile":true},"terminal":true},
  "clientInfo":{"name":"my-client","title":"My Client","version":"1.0.0"}}}
```
```json
{"jsonrpc":"2.0","id":0,"result":{
  "protocolVersion":1,
  "agentCapabilities":{
    "loadSession":true,
    "promptCapabilities":{"image":true,"audio":true,"embeddedContext":true},
    "mcpCapabilities":{"http":true,"sse":true},
    "sessionCapabilities":{"list":{},"resume":{},"close":{}},
    "auth":{"logout":{}}},
  "agentInfo":{"name":"my-agent","version":"1.0.0"},
  "authMethods":[]}}
```
基线要求：必须支持 Text 和 ResourceLink；`image`、`audio`、`embeddedContext`(=`resource`) 需要 capability 声明。stdio MCP 为必选，http/sse 为可选。

### authenticate
`{"method":"authenticate","params":{"methodId":"<authMethods[i].id>"}}`，结果为 `{}`。v1 还有 `type:"terminal"` 认证方法（客户端需声明 terminal auth 能力）。

### session/new
```json
{"method":"session/new","params":{"cwd":"/abs/path","additionalDirectories":["/abs/other"],
 "mcpServers":[
  {"name":"fs","command":"/abs/mcp","args":["--stdio"],"env":[{"name":"K","value":"V"}]},
  {"type":"http","name":"api","url":"https://x/mcp","headers":[{"name":"Authorization","value":"Bearer t"}]},
  {"type":"sse","name":"ev","url":"https://x/sse","headers":[]}],
 "_meta":{}}}
```
结果：`{"sessionId":"...","modes":{"currentModeId":"...","availableModes":[{"id","name","description"}]},"configOptions":[...],"models":...}`。其中 `modes` 和 `configOptions` 为可选。stdio 条目**没有** `type` 字段。

### session/load / session/resume / session/list / session/close
- load：params `{sessionId,cwd,mcpServers}`。Agent 先用 `session/update` 回放全部历史（`user_message_chunk`/`agent_message_chunk`/tool_call…），再返回 `null`。
- resume：参数相同，**不回放历史**，返回 `{}`，可能附带 modes、models、configOptions。
- list：`{"cwd"?, "cursor"?}` → `{"sessions":[{"sessionId","cwd","title"?,"updatedAt"?,"_meta"?}],"nextCursor"?}`。
- close：`{sessionId}` → `{}`，效果等同 cancel，并释放资源。

### session/prompt
```json
{"method":"session/prompt","params":{"sessionId":"s","prompt":[
 {"type":"text","text":"hi"},
 {"type":"image","mimeType":"image/png","data":"<base64>","uri":"optional"},
 {"type":"resource_link","uri":"file:///abs/a.rs","name":"a.rs","mimeType":"text/x-rust","size":123},
 {"type":"resource","resource":{"uri":"file:///abs/a.py","mimeType":"text/x-python","text":"..."}}
]}}
```
（`resource.resource` 也可以是 `{uri,mimeType,blob}`。）
结果：`{"stopReason":"end_turn|max_tokens|max_turn_requests|refusal|cancelled"}`。不稳定特性 `unstable_end_turn_token_usage` 还会附加 `"usage":{"totalTokens","inputTokens","outputTokens","thoughtTokens"?,"cachedReadTokens"?,"cachedWriteTokens"?}`，claude 适配器实际会返回这个字段。

### session/cancel 语义
`{"method":"session/cancel","params":{"sessionId":"s"}}`（通知）。发送后客户端应：把未完成的 tool call 标记为 cancelled；对所有挂起的 `session/request_permission` 回复 `{"outcome":{"outcome":"cancelled"}}`。Agent 必须以 `stopReason:"cancelled"` 结束原 prompt 请求，不能返回 error。cancel 之后仍可能收到 update，但都会在 prompt 响应之前到达。**cancel 之后可以在同一 session 继续发 prompt**：规范写明 “Once a prompt turn completes, the Client may send another session/prompt”。claude 适配器在下一轮 `activateTurn` 时会重置 `session.cancelled=false`，已在源码中确认。

### session/update 变体（v1 稳定）
`user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk`（都是 `{content: ContentBlock, messageId?}`），`tool_call`, `tool_call_update`, `plan`, `available_commands_update`, `current_mode_update`, `config_option_update`, `session_info_update`, `usage_update`。不稳定：`plan_update/plan_removed`, `notice`, `compaction_update`。
```json
{"sessionUpdate":"tool_call","toolCallId":"c1","title":"Read x","kind":"read|edit|delete|move|search|execute|think|fetch|switch_mode|other","status":"pending|in_progress|completed|failed","content":[{"type":"content","content":{"type":"text","text":"..."}},{"type":"diff","path":"/abs","oldText":null,"newText":"..."},{"type":"terminal","terminalId":"t1"}],"locations":[{"path":"/abs","line":42}],"rawInput":{},"rawOutput":{}}
{"sessionUpdate":"tool_call_update","toolCallId":"c1","status":"completed"}
{"sessionUpdate":"plan","entries":[{"content":"...","priority":"high|medium|low","status":"pending|in_progress|completed"}]}
{"sessionUpdate":"available_commands_update","availableCommands":[{"name":"web","description":"...","input":{"hint":"query"}}]}
{"sessionUpdate":"current_mode_update","currentModeId":"code"}
{"sessionUpdate":"usage_update","used":53000,"size":200000,"cost":{"amount":0.045,"currency":"USD"}}
{"sessionUpdate":"session_info_update","title":"...","updatedAt":"..."}
```
`tool_call_update` 除 `toolCallId` 外所有字段都可选（patch 语义）。注意：文档示例中 current_mode_update 写成 `"modeId"`，Rust schema 字段名为 `current_mode_id`，序列化后是 `currentModeId`（已在 schema 源码确认，**以 schema 为准**）。

### session/request_permission（Agent→Client 请求）
```json
{"id":5,"method":"session/request_permission","params":{"sessionId":"s",
 "toolCall":{"toolCallId":"c1","title":"...","kind":"edit"},
 "options":[{"optionId":"allow-once","name":"Allow once","kind":"allow_once"},
            {"optionId":"always","name":"Always","kind":"allow_always"},
            {"optionId":"rej","name":"Reject","kind":"reject_once"},
            {"optionId":"rej-all","name":"Never","kind":"reject_always"}]}}
```
回复有两种：`{"outcome":{"outcome":"selected","optionId":"allow-once"}}`，或 `{"outcome":{"outcome":"cancelled"}}`。

### fs / terminal（客户端实现，需在 clientCapabilities 中声明）
- `fs/read_text_file` `{sessionId,path,line?,limit?}` → `{content}`；`fs/write_text_file` `{sessionId,path,content}` → `null`（文件不存在时必须创建）。
- `terminal/create` `{sessionId,command,args?,env?[{name,value}],cwd?,outputByteLimit?}` → `{terminalId}`（立即返回）；`terminal/output` → `{output,truncated,exitStatus?{exitCode,signal}}`；`terminal/wait_for_exit` → `{exitCode,signal}`；`terminal/kill` → `{}`（terminal 仍有效）；`terminal/release` → `{}`（若进程还在运行则 kill）。
- 所有路径必须是绝对路径，行号从 1 开始。

### 模式 / 配置
- `session/set_mode` `{sessionId,modeId}` → `{}`。**已被 Session Config Options 取代**（未来会移除）。
- `session/set_config_option` `{sessionId,configId,value}` → `{configOptions:[完整列表]}`。configOption 结构为 `{id,name,description?,category?:"mode|model|model_config|thought_level|_x",type:"select"|"boolean",currentValue,options:[{value,name,description?}]}`。boolean 类型需要客户端声明 `clientCapabilities.session.configOptions.boolean:{}`。

## 2. Rust crate `agent-client-protocol` 2.2.0
- 仓库 https://github.com/agentclientprotocol/rust-sdk · 文档 https://docs.rs/agent-client-protocol/2.2.0 · mdbook https://agentclientprotocol.github.io/rust-sdk/
- **API 已完全重写**：`ClientSideConnection` 和 `Client`/`Agent` trait 风格已**移除**（2.2.0 源码中 grep 不到 `ClientSideConnection`）。现在的用法是基于角色的 builder：`agent_client_protocol::Client.builder().on_receive_notification(...).on_receive_request(...).connect_with(AcpAgent, async |cx: ConnectionTo<Agent>| { cx.send_request(InitializeRequest::new(ProtocolVersion::V1)).block_task().await? ... })`。
- 类型位于 `agent_client_protocol::schema::v1::*`。子进程由 `AcpAgent::from_args([...])` / `from_str("cmd args")` / `AcpAgentConfig{command,args,env}` 创建；在 Unix 上 drop 时会结束整个进程组。
- 另有 session 辅助：`cx.build_session(cwd)` → `SessionBuilder`，以及 `ActiveSession`；2.1.0 增加 `load_session*` / `resume_session*` 构建器，返回 `RestoredSession`。
- **运行时**：与具体 runtime 无关（futures + async-process/async-io/blocking），不依赖 tokio。handler、ConnectTo、spawn 的 task 都要求 **`Send + 'static`**，**不需要 LocalSet**（旧 0.x 版本的 `!Send` 限制已取消）。示例直接用 `#[tokio::main]`。
- Feature：`unstable`（end_turn_token_usage、session_fork、mcp_over_acp、plan_operations、session_compaction、session_notices、llm_providers），`unstable_protocol_v2`。
- 示例客户端：https://github.com/agentclientprotocol/rust-sdk/blob/main/src/agent-client-protocol/examples/yolo_one_shot_client.rs [路径未验证；本地位置 ~/.cargo/registry/src/*/agent-client-protocol-2.2.0/examples/yolo_one_shot_client.rs]

## 3. Claude 适配器 `@agentclientprotocol/claude-agent-acp` 0.81.0
- 仓库 https://github.com/agentclientprotocol/claude-agent-acp （原 zed-industries/claude-code-acp → claude-agent-acp，两个旧包都已 deprecated）
- 启动方式：`npx -y @agentclientprotocol/claude-agent-acp`，bin 为 `claude-agent-acp`（node `dist/index.js`，**Node ≥22**），走 stdio。依赖 `@anthropic-ai/claude-agent-sdk` 0.3.280，其 optional dep 自带 Claude 原生 CLI；设置 `CLAUDE_CODE_EXECUTABLE=$(which claude)` 可改用本机 claude。认证复用本机 Claude 登录（authMethods 为 terminal/gateway）。
- initialize（源码）：`loadSession:true`，`promptCapabilities{image:true,embeddedContext:true}`（无 audio），`mcpCapabilities{http:true,sse:true}`，`auth.logout`，`providers:{}`，`sessionCapabilities{additionalDirectories,close,delete,fork,list,resume,subagents}`；`_meta.claudeCode.promptQueueing:true`（turn 进行中也可以再发 prompt，会排队）。
- MCP 注入：`session/new.mcpServers` 中的 stdio、http、sse 都会转换为 SDK 的 mcpServers。
- 模式（modes 和 configOption `mode` 同时提供）：`default`(Manual)、`acceptEdits`、`plan`、`auto`、`bypassPermissions`（以 root 运行且不在沙箱时，或 `_meta.claudeCode.options.allowDangerouslySkipPermissions:false` 时不提供）。另外还有 model 和 `effort` 两个 config option。
- `available_commands_update` 在 session/new 之后异步发送。`usage_update` 带 `used/size/cost(USD)`。PromptResponse 附带 `usage`。
- `/compact [指令]`（首个文本块原样发送，已实测 2026-09-30）：未声明 `session.compaction` 时回退为 tool_call「Compact conversation」(kind think)，结束后补发 `usage_update`（29601→2831）；该轮 PromptResponse.usage 为 0，无文字回复。`used` 是当前上下文占用，`size` 是模型窗口（opus[1m] 为 1000000）。
- cancel 后可以继续：已确认（见上）。

## 4. Codex 适配器 `@agentclientprotocol/codex-acp` 1.13.0
- 仓库 https://github.com/agentclientprotocol/codex-acp 。**已从 Rust 改写为 TypeScript**：单文件 `dist/index.js`，bin 为 `codex-acp`。内部启动 **Codex App Server**（JSON-RPC：thread/start、thread/resume…），依赖 `@openai/codex ^0.155.1`（已打包进 npm 依赖）；可用 `CODEX_PATH` 指定本机 codex。启动：`npx -y @agentclientprotocol/codex-acp`。GitHub releases（v1.13.0，2026-09-22）**没有二进制附件**；旧的 `@zed-industries/codex-acp` 0.16.0（带平台预编译二进制）已 deprecated。
- initialize：`loadSession:true`，`promptCapabilities{image:true,embeddedContext:true}`，`mcpCapabilities{http:true,sse:false}`，`sessionCapabilities{resume,list,close,delete,fork,additionalDirectories,subagents}`，`auth.logout`，`providers`。认证方式：ChatGPT 登录、`CODEX_API_KEY`/`OPENAI_API_KEY`，或 gateway。
- MCP 注入：session/new 的 mcpServers 支持 stdio 和 http，会合并到 thread config 的 `mcp_servers`；与配置文件中同名的会去重。
- 模式：`read-only`（Ask for approval）、`agent`（默认，auto_review）、`agent-full-access`。env `INITIAL_AGENT_MODE` 可设初始模式。另有 config option `collaboration_mode`（default/plan），以及 model、reasoning effort、fast mode。
- 斜杠命令：/status /mcp /skills /goal /review /review-branch /review-commit /compact /logout，以及已配置的 skills。
- `usage_update`：只有 `{used,size}`，**没有 cost**。
- `/compact`：`thread/compact/start`，同样回退为 tool_call「Compact conversation」并补发 `usage_update`（25640→5215，size 258400，已实测 2026-09-30）。
- cancel：`interruptSessionTurn`。cancel 后能否继续 prompt 未单独测试，按规范应当可以 [未实测]。

## 5. 按 session 注入 system prompt
- **Claude**（源码 acp-agent.js createSession）：在 `session/new`（以及 load/resume，走同一个 createSession）的 `params._meta` 中设置：
  - `"_meta":{"systemPrompt":"完整替换的字符串"}`：整个替换掉 claude_code 预设（不推荐）。
  - `"_meta":{"systemPrompt":{"append":"额外指令"}}`：在 claude_code 预设后追加（推荐）。对象中的 type/preset 会被锁定为 `claude_code`，其余字段（如 `excludeDynamicSections`）会透传。
  - `"_meta":{"claudeCode":{"options":{...Agent SDK Options...}}}`：透传 SDK 选项（model、env、tools、settings、extraArgs、additionalDirectories、mcpServers…）。cwd、mcpServers 合并、permissionMode、canUseTool 由 ACP 控制。
- **Codex**：适配器**不读取** session/new 的 `_meta` 指令（源码只用 `_meta` 处理 additionalDirectories 和 fork）。可选方案：
  1. 进程级 env `CODEX_CONFIG='{"developer_instructions":"..."}'`：JSON 会合并进每个 thread 的 config。`developer_instructions` 是 Codex 官方配置键（https://developers.openai.com/codex/config-reference ），以 developer 消息形式注入。**只能按进程生效**，要做到每 session 不同，就得每个 session 起一个 codex-acp 进程。
  2. `model_instructions_file`：替换内置指令，官方不推荐。
  3. 在 cwd 中放 `AGENTS.md` 或 `.codex/config.toml`（project 级 `developer_instructions`）[project 级是否接受该键未验证]。
  4. 第一条 prompt 前置一段指令文本（最简单，但会进入对话历史）。

## 6. 测试用 mock agent
- 官方 TS SDK 自带示例 agent：`node node_modules/@agentclientprotocol/sdk/dist/examples/agent.js`（npm 包里就有）。它会流式输出 agent_message_chunk，发 tool_call 和 tool_call_update，发起 `session/request_permission`，支持 cancel（返回 `stopReason:"cancelled"`）；`loadSession:false`。**最适合做集成测试**。同目录还有 client.js、dual-version-agent.js、http-server.js。
- Rust：`examples/simple_agent.rs` 只处理 initialize，太简单；`simple_agent_v2.rs` 实现完整 v2 生命周期，需要开 `unstable_protocol_v2`。crate 的 `tests/` 目录有 jsonrpc 测试可参考。
- 没有找到官方的独立 mock/test-agent npm 包（npm search 中只有第三方 fork）。单元测试建议用 crate 的 `Agent.builder()` 在进程内搭一个 fake agent，通过 `Channel` 与客户端连接。
