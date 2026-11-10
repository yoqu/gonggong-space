# Gemini CLI 接入 — 开发计划

目标：在 Claude Code、Codex 之外新增第三种 Agent「Gemini CLI」，让 Bot 可以选 Gemini，机器「供应商」里可以配 Gemini 协议（Google AI Studio 的 Key，或兼容 Gemini 协议的网关）。

起因：供应商没有「协议」选项。协议由 Agent 决定（Claude Code 只说 Anthropic Messages，Codex 只说 OpenAI Responses），共工不做协议转换（见 `Agent工具与供应商统一管理-设计.md` 过滤规则），所以要支持 Gemini 协议就得接入说这种协议的 Agent。供应商编辑页同时只读显示「协议」，免得误以为功能不全。

## 1. 事实（S0，2026-11-09，解包 `@google/gemini-cli@0.67.0` 并用真实 CLI 对本地假 Gemini API 实测）

| 项 | 结论 |
|---|---|
| 包 / 命令 | `@google/gemini-cli` 0.67.0，bin `gemini`（npm 安装时是指向 `bundle/gemini.js` 的链接）；本机 0.36.0 也能跑通 |
| ACP | **CLI 自带**：`gemini --acp`，不需要适配器包 |
| 能力 | `loadSession: true`，没有 `sessionCapabilities.resume` / `fork`；`session/load` 会重放历史 |
| 模型 | 不走 config option：新建 / 载入会话的结果里带 `models`（`availableModels`、`currentModelId`），用 `session/set_model` 切换；没有推理强度选项 |
| 模式 | `default`、`autoEdit`、`yolo`、`plan` |
| 指令 | 不读 `session/new` 的 `_meta`。`GEMINI_SYSTEM_MD` 会整段替换系统提示词；系统级设置文件（`GEMINI_CLI_SYSTEM_SETTINGS_PATH`）要求目录属于 root，不可用。**全局记忆 `$GEMINI_CLI_HOME/.gemini/GEMINI.md` 会进系统提示词**（实测命中） |
| 认证 | 设置里的 `security.auth.selectedType` 决定；`gemini-api-key` 读 `GEMINI_API_KEY`，并认 `GOOGLE_GEMINI_BASE_URL`（网关也能用）。个人 Google 账号登录已停用（报「This client is no longer supported for Gemini Code Assist for individuals」） |
| 工具调用 | 没有 `rawInput`；shell 的标题就是命令；MCP 调用标题为 `<tool> (<server> MCP Server)`，权限请求的 `_meta["gemini-cli"].mcp` 带 server / tool 名 |
| MCP | ACP 下发的同名服务器会整个替换设置里的；默认超时 10 分钟 |
| 信任 | 不受信任的目录不加载项目 skill 和设置：`GEMINI_CLI_TRUST_WORKSPACE=true` |
| Skill | 读 `~/.gemini/skills`、`~/.agents/skills` 和项目的 `.gemini/skills`、`.agents/skills` |

## 2. 决策

- D1 走 CLI 自带的 ACP：`engine.rs` 对 Gemini 直接启动 CLI（npm 的脚本用共工选的 Node 跑），不进 `ADAPTERS`。
- D2 权限档位：完全 → `yolo`；工作区 → `autoEdit`（工作区内改文件由 Gemini 自己放行，命令仍走审批）；只读 → `default`，由共工的规则拒绝写入。不用 `plan`，它会改变 Agent 的工作方式。
- D3 每个（群，Bot）一个 `GEMINI_CLI_HOME`（`<home>/gemini/<群>-<Bot>`，`gemini.rs`），每轮写一次：
  - `settings.json`：用户自己的 `~/.gemini/settings.json`（支持注释），用供应商时把登录方式改成 `gemini-api-key`，再加上内置 gonggong MCP 服务器（超时 25 小时，够「向群成员提问」等人）；文件 0600。
  - 全局记忆：Bot 指令在前，用户自己的全局 `GEMINI.md`（或 `context.fileName` 指定的名字）在后。
  - 用户的登录、MCP OAuth、扩展、skill、命令、策略文件和 `~/.agents` 用链接共享。
  - 会话也存在这里，所以同一个（群，Bot）换进程后能 `session/load` 续接。
- D4 供应商只做「填 Key」：进程环境注入 `GEMINI_API_KEY`、`GOOGLE_GEMINI_BASE_URL`、`GEMINI_MODEL`，Key 不落盘。预设：Google AI Studio（手工维护）+ OpenRouter（CC Switch，只留 Gemini 模型）。CC Switch 导入与链接放开 `gemini`。Vertex 不做。
- D5 托管安装：`ToolKind` 加 `gemini`（`@google/gemini-cli`），自装的按 npm / Homebrew 升级。
- D6 内置 gonggong MCP 不经 ACP 下发（经设置文件，见 D3）；权限请求按 `_meta` 改名为 `mcp__<server>__<tool>`，内置工具照旧免审批；没有 `rawInput` 的 execute 调用用标题当命令。
- D7 老客户端：daemon 能力位 `gemini`；服务端遇到没有该能力的机器，Gemini Bot 的运行停在「执行机器的共工客户端版本过低，升级后才能运行 Gemini CLI Bot」，升级重连后自动继续。网页上没有该能力的机器不显示 Gemini。
- D8 首期不做：Gemini 扩展管理、sandbox、Vertex、会话分支（Gemini 不支持 fork）。

## 3. 切片

- S1 协议：`AgentKind` / `ToolKind` 加 `gemini`，`DaemonFeature` 加 `gemini`；fixture（agents.update、tools.result）；`protocol.rs`；服务端调度拦截老客户端。
- S2 daemon 运行：`agents.rs`（命令、最低版本 0.36.0、登录状态读配置）、`engine.rs`、`gemini.rs`、`turn.rs::mode_for`、`session.rs`（`models` / `session/set_model`、MCP 命名、命令兜底、探测模型）、`diag.rs`（没装 Gemini 不算告警）。
- S3 供应商：`providers.rs`（预设、`GOOGLE_GEMINI_URL`）、`ccswitch.rs`、`provider_cli.rs`、`scripts/sync-provider-presets.mjs`。
- S4 Skill / 插件：与 Codex 一样链接到工作区 `.agents/skills`（`AgentKind::links_skills`）；`mcp_call.rs` 认 Gemini 的 MCP 标题。
- S5 Web / desktop：Agent 列表与标签、新建 Bot、机器的 Agent 工具与供应商、登录说明、供应商编辑页的「协议」行、MCP 标题显示、相关文案。
- S6 测试：`tests/it/gemini.rs`（mock agent 带 `GEMINI_CLI_HOME` 时按 Gemini 的方式应答）、`e2e/gemini.spec.ts`；真实 CLI 0.67 对本地假 Gemini API 手工跑通（改文件自动放行、命令转审批、gonggong 工具免审批、续接会话、指令进系统提示）。

## 4. 上线

- 没有数据库迁移；服务端先上线，然后发新客户端（主体在 daemon）。
- 没在真实 Google Key 上跑过（本机没有 Key），上线后用真 Key 跑一次「改代码 → 跑测试 → 提交」。
