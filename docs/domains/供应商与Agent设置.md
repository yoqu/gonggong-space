# 供应商与 Agent 设置 · 现状

> 范围：Agent 工具（检测、安装、版本、内置 Agent 插件）、供应商（端点、密钥、模型、代理/环境变量）、Agent 设置层、模型与推理强度、权限档位映射。只写仍有效的决定，以代码为准，更新于 2026-11-16（Agent 管理重构后）。

## Agent 种类与注册表
- `AgentKind` 封闭枚举：claude、codex、gemini、codebuddy、pi、deepseek、antigravity、opencode、qwen、kimi、goose、copilot（`packages/protocol/src/common.ts`）。
- 注册表 `packages/protocol/src/agents.ts` `AGENT_META` 是 Agent 的唯一定义：名称、厂商、CLI 名、官方标与品牌色、安装方式（`managed` 托管 / `command` 给命令）、登录方式（`provider` 走供应商 / `own` 自己登录）、适配器来源（`bundled` / `cli`）、吃哪些接口协议、老客户端缺的能力位。web、桌面、服务端都从这里取，图标统一用 `ui/AgentIcon`；加一个 Agent = 注册表一条 + 内置插件清单（daemon 检测器）+ 登录命令与形象各一条。
- 接口协议 `API_PROTOCOLS`：anthropic、openai、gemini、codebuddy（后两种厂商专属）。claude→anthropic；codex、qwen→openai；kimi、goose、copilot→anthropic 或 openai；gemini、codebuddy 各吃自家协议；pi、antigravity、opencode 自己登录，不吃供应商。
- Claude、Codex 是代码适配器（ACP 适配器包随 daemon 锁定版本，`engine.rs` `ADAPTERS`）；其余十种是内置 Agent 插件 `apps/server/plugins/official/agent-*`，daemon 用 `include_str!` 编进二进制（`crates/gonggong/src/adapters.rs` `BUILT_IN`）。新加五种都是 CLI 自带 ACP：`opencode acp`、`qwen --acp`、`kimi acp`、`goose acp`、`copilot --acp`；goose 没有 npm 包，只给官方安装命令。
- 插件 Agent 吃供应商时按端点协议取清单 `provider.byProtocol` 的变量名、附加变量与参数（如 goose 设 `GOOSE_PROVIDER`、qwen 加 `--auth-type openai`）；`needsModel` 的（goose）没选模型就让这一轮失败并说明，不回退到它自己的登录（`inject::manifest_provider`）。
- 插件 Agent 的安装、ACP 启动、系统提示、MCP、Skill、档位、供应商变量、登录检测都写在清单 `contributes.agents`；Gemini 走 CLI 自带 `gemini --acp`，每（群，Bot）一个 `GEMINI_CLI_HOME`，由 `launch.mjs` 写设置与全局记忆。
- 老客户端：服务端按注册表的 `feature` 检查 daemon 能力位（`clientRunsAgent`），缺则运行停在「执行机器的共工客户端版本过低…」，升级重连后继续（`apps/server/src/modules/runs/scheduler.ts`）；新建 Bot 的 Agent 列表把这类 Agent 置灰标「客户端需升级」。

## Agent 工具（daemon `tools.rs`、`agents.rs`）
- 检测：本机 `local.json` 指定路径 > `<home>/tools/bin` 托管安装 > PATH 与常见目录（含 nvm、登录 shell PATH）；`--version`、登录态，每 60 秒复检（`daemon.rs` `REDETECT`），变化发 `agents.update`。
- 最低版本：claude 2.0.0、codex 0.160.1，插件 Agent 取清单 `minVersion`（`agents::min_version`），低于时 Bot 上告警。
- 状态合成一份：`AgentState`（检测 + 安装：版本、路径、最低版本、最新版、是否托管、升级/安装命令、模型目录）替代旧的 `AgentInfo` + `ToolStatus`，Node.js 单列为 `RuntimeState`（`packages/protocol/src/daemon/agent-state.ts`）；老 daemon 的旧格式由服务端用 `daemon/legacy.ts` 转换，web 只见新格式。
- `ToolKind`：node + 12 种 Agent（安装/升级目标）；`install: 'command'` 的（antigravity、goose）共工不装不升级，只给命令。
- 托管 Node：从镜像下载最新 ≥22 LTS，校验 SHASUMS256，解压到 `<home>/runtime/node-v*` 再原子切换 `current`；系统已有 ≥22 直接用；musl 无官方构建，拒绝托管。
- 托管 CLI：托管 Node 执行 `npm i -g --prefix <home>/tools --registry <镜像>`，不用 sudo、不碰全局 npm。
- 镜像源：`<home>/settings.json` 的 `mirror`，npmmirror（默认）/ official / custom（registry 与 Node 地址都要填）（`config.rs` `Mirror`）。
- 升级：托管的重装最新版；自装的按原方式升级（brew、`claude update`、npm 原前缀），无写权限时明确提示（`tools::upgrade`、`self_upgrade`）。
- 最新版本取镜像 `/<pkg>/latest` 与 Node `index.json`，缓存 6 小时（`tools-latest.json`）；每台机器同时只跑一个操作（`busy` 文件锁），进度逐行推送。
- 机器级额外环境变量 `settings.env`：传给 Agent 进程与 npm，只在桌面「设置」编辑。
- 协议：`tools.cmd`/`tools.progress`/`tools.result`（带 `node` 与 `agents`，能力位 `agentState`）、`ToolsSettings { mirror }`；服务端 `modules/machines/tools.ts`；管理后台机器列表只读显示「Agent 版本 / 可升级」。
- Agent 页（`apps/web/src/features/agents/`，web 与桌面共用，只换数据源 `AgentsSource`：web 走接口 `webSource.tsx`，桌面走 IPC `apps/desktop/src/agentsSource.tsx`）：顶部 Node.js 状态条；每个 Agent 一行，一个状态一个主操作（安装 / 升级到某版本 / 复制安装命令，最新则无）；未安装的归「可安装」；「全部升级」逐个升级、遇到第一个失败就停并保留日志；点开看详情（路径与更换、版本、来源、适配器、登录状态、可用模型、默认「供应商/模型」、官方登录设置与「登录…」、使用它的 Bot）。镜像源设置在「诊断」。

## 供应商（daemon `providers.rs`、`inject.rs`）
- 只存在机器本地 `<home>/providers.json`（0600、原子写）；服务端只经 `hub` 内存转发，不落库、不记日志，审计只记谁在哪台机器做了什么（`modules/providers/routes.ts`、`machines/relay.ts`）。
- 不跨机器共用；不修改 `~/.claude`、`~/.codex` 等用户级全局文件。
- 结构（v2）：`machine[agent] = {provider, model}` 本机默认、`bots[botId]` Bot 覆盖、`providers[]`、`official[agent]` 官方登录附加项、`agentSettings[agent]`、`sessions` 会话锁定。
- 供应商是厂商级，不绑 Agent：`{id, name, presetId, revision, apiKey, proxy, source, endpoints[]}`，每个端点一种协议：`protocol`、`baseUrl`、`apiKeyField`、`wireApi`、`model`、`models`（haiku/sonnet/opus）、`env`、`args`、`effort`、`configDir`/`executablePath`。同一个 Key 只登记一次，可以同时是多个 Agent 的默认。
- 能不能用：供应商有端点的协议在该 Agent 的 `protocols` 里才可选（`canUse`）；对不上的置灰并写明原因，如「该供应商只提供 OpenAI 兼容 接口，Claude Code 需要 Anthropic 兼容」（`features/agents/model.ts` `whyNot`）。不做网关和协议转换。
- 生效顺序：Bot 覆盖 > 本机默认 > 官方登录（`Store::effective`）。模型：消息临时 / 群 / Bot（服务端）> Bot 继承时机器默认的模型 > 端点 `model` > 适配器默认。
- Bot 的「供应商/模型」是一个选择（`features/agents/ProviderModelPicker.tsx`、`features/bots/BotProvider.tsx`）：默认「继承机器默认（当前：X）」，可覆盖，一次请求保存供应商与模型；换模型后原推理强度不可用就清空。新建 Bot 用同一个选择器。
- `providers.json` v1→v2 迁移（`crates/gonggong/src/providers_migrate/`）：daemon 启动、桌面启动、`gg provider` 时执行；原文件逐字节备份为 `providers.v1.json`（已有则 `providers.v1.<unix_ms>.json`），幂等。`(apiKey, 域名, proxy)` 相同的合并为一个厂商多个协议端点，同协议不同地址的拆开保留原 id，本机 Claude 配置目录不合并；pi、antigravity 名下的供应商（从未生效）丢弃，引用它们的默认与 Bot 改回官方登录或继承。
- 「该机器 Claude 配置目录」：`configDir`/`executablePath` 用独立 `CLAUDE_CONFIG_DIR` 和自己的登录，不填 Key（能力位 `claudeProfile`）。
- 官方登录也可设代理、环境变量、命令行参数（`Store.official`，`PUT /api/machines/:id/providers/official`）。
- 环境变量放开为任意变量，只校验变量名；代理密码打码 `user:****@`，传回打码值视为不变，`''` 为直连。
- 预设：`crates/gonggong/presets/providers.json` 由 `scripts/sync-provider-presets.mjs` 从 CC Switch 生成（只收直连、只填 Key 的主流厂商），按厂商合并（40 个厂商、60 个端点）；平台插件 `provider-presets` 经 `presets.sync` 叠加（`presets-overlay.json`），新旧两种格式都收。
- 新增流程：选厂商 → 只填 Key，按协议各一块端点；可勾选「设为默认」给哪些 Agent；保存时把预设值拷进本地，之后预设更新不改用户配置。
- 注入 Claude：写 flag settings 文件 `<home>/run/claude-*.json`，路径放进 `_meta.claudeCode.options.settings`，每次 new/resume/load 都带；复位冲突变量（用户 Key、`apiKeyHelper`、Bedrock/Vertex 等）防泄漏。
- 注入 Codex：`CODEX_CONFIG` 并入 `model_provider="gg"` 等，加 `MODEL_PROVIDER=gg`、`GG_PROVIDER_KEY`（`inject::codex_config`、`codex_env`）。
- 注入插件 Agent：按清单 `provider.env`（如 `GEMINI_API_KEY`、`GOOGLE_GEMINI_BASE_URL`、`GEMINI_MODEL`），端点协议有 `byProtocol` 时用它的变量名并加它的变量与参数，进进程环境，Key 不落盘。
- Key 只进 0600 文件或子进程环境，不进 argv、日志、错误；离开 daemon 一律脱敏（末 4 位），env 名含 KEY/TOKEN/SECRET/PASSWORD 的值打码（`isSecretEnv`）。
- 会话锁定：新会话把当时生效的供应商写入 `sessions`，续接始终用锁定值；每（群，Bot）保留最近 5 个，超 30 天的多余项删除（`PINS_KEPT`、`PIN_TTL_MS`）。
- 同一供应商编辑 → `revision` 加 1，重启该（群，Bot）adapter 并 resume；锁定的供应商被删 → 下一轮自动开新会话，`newSessionReason='provider_removed'`。
- 横条：daemon 在连上、每轮结束、Web 改动后上报 `bots.providerState`（只含会话 ≠ 生效的项），服务端按机器存内存、离线清空，群聊输入框上方显示「本会话使用 X；已切换为 Y…」（`modules/providers/state.ts`、`features/chat/ProviderBanner.tsx`）。
- CC Switch 导入：daemon 只读本机 `~/.cc-switch`（db → config.json v2 → .migrated），只取 claude/codex/gemini，跳过 official，按来源 id 与（agent, baseUrl, key）去重；也可粘贴 `ccswitch://` 链接（`ccswitch.rs`）。
- 维护入口：Web「我的机器 → Agent 与供应商」（机器主人，机器离线不可用）与桌面「Agent」页（同一套组件，桌面直接调用 daemon 处理服务端请求的同一份代码，可编辑）；桌面 Bot 页只读显示「供应商/模型」，旁边「在 Web 中管理」；CLI `gg provider *` 直接读写本地（`provider_cli.rs`）。
- 旧 daemon：Web 按 `hello.features`（`tools`、`providers`、`ccSwitch`、`agentSettings`、`claudeProfile`、`providerArgs`、`agentState`、`protocolProviders`…）置灰并提示升级。没有 `protocolProviders` 时服务端在新旧格式间转换，做不到的三件事回 409「请先升级该机器的客户端…」：一个供应商登记多种协议、一个供应商设为多个 Agent 的默认、机器默认指定模型。

## Agent 设置层（目前只有 Claude）
- 字段唯一来源 `packages/protocol/src/agent-settings.ts` `AGENT_SETTING_FIELDS`，与 `fixtures/agent-setting-fields.json`、`crates/gonggong/src/agent_settings.rs` 对齐。
- 供应商层（存在供应商或官方登录的 `env`）：上下文窗口、自动压缩窗口、输出上限、关闭思考、关闭实验性 beta、工具搜索、API 超时。
- 本机层（`providers.json` `agentSettings[agent]`）：语言、扩展思考、提交署名、内置 git 指令、自动记忆、自动压缩、Bash 超时与上限、非必要流量；加「继承本机 CLI 配置」开关（默认开）。
- Bot 层（服务端 `bots.agent_settings`，随 `RunStart.bot.agentSettings` 下发）：只限 `botOverride` 字段（语言、扩展思考、提交署名），只有 Bot 主人能改（`modules/bots/config.ts` `assertBotAgentSettings`）。
- 合成顺序：本机层 → Bot 层 → 供应商 env → 连接信息，写入 flag settings 文件；`permissions`、`model`、`mcpServers`、`enabledPlugins`、`apiKeyHelper` 由共工管理永不写（`LOCKED_CLAUDE_SETTINGS`）。
- 上下文窗口未显式设置时按实际模型取预设 `modelContext`（手工维护 `scripts/provider-model-context.json`）。
- 关闭继承：`settingSources = ["project","local"]`，个人 CLAUDE.md、记忆、hooks、用户 Skill 一并不加载（`session.rs`）。
- 来源标注：daemon 只读 `~/.claude/settings.json` 已知字段、冲突变量（`CLAUDE_CONFLICT_ENV`）、hooks 与权限规则条数、CLI 版本随 view 上报；界面标「默认 / 本机 CLI / Agent 设置 / 供应商 / 按模型 / Bot」（`SETTING_SOURCES`）。
- 改动下一轮生效（重启 adapter 并 resume）；每轮生效摘要记入 `session.config.settings`（`RunSettingsSnapshot`），`usage.context.compactAt` 标压缩点。
- Web：机器详情「Agent 设置」（`AgentSettingsPanel.tsx`）、Bot 设置覆盖行（`BotAgentSettings.tsx`）；桌面在 Agent 页详情里编辑。

## 模型与推理强度
- 存服务端：`bots.model/effort`（Bot 默认）、`group_bots.model/effort`（群内默认）、`runs.model/effort`（本轮）；本机 `local.json` 不再存。
- 优先级：单条临时（`SendMessageReq.runOptions`，只作用于本条直接触发的运行，不传给接力后续跳）> 群内默认 > Bot 默认 > 适配器默认（`resolveConfig`）。
- 可切换者：私聊为成员；群聊为 Bot 主人与群管理员；Bot 默认为 Bot 主人或系统管理员（`assertCanConfigure`）。群内默认 `PUT /api/groups/:id/bots/:botId/config`，改动发系统消息。
- 目录 `AgentCatalog`：官方登录由 daemon 开临时会话探测，缓存 `<home>/models.json`（按 CLI+适配器版本），随 `agents.update` 上报；可 `POST /api/bots/:id/catalog/refresh` 重新探测（`agents.reprobe`）。
- 第三方供应商目录取声明值（`model`、haiku/sonnet/opus 映射、预设 `modelOptions`），不探测、无推理强度档位（`manage.rs` `catalog`）；Bot 选供应商时经 `botCatalog` 校验模型。
- 推理强度按模型不同：不属于该模型时退回该模型起始档（`fitEffort`），服务端总是下发具体值；目录为空只允许「跟随默认」。
- daemon 每轮按下发值切换，并以 `session.config` 回报实际值；Gemini 没有推理强度。

## 权限档位映射
- 档位 `Tier`：`full` 完全允许、`workspace` 需要审批、`read-only` 只读；Bot 默认 `bots.tier`，群可覆盖 `group_bots.tier`；演示模式不许 full（`modules/bots/tier.ts`）。
- 档位改动对运行中的轮次立即生效（`run.tier`）；升到 full 时自动批准待审请求。
- ACP 模式映射（`turn.rs` `mode_for`）：Claude bypassPermissions / acceptEdits / default；Codex agent-full-access / workspace-write / read-only（不用 `agent`，它把审批交给 Codex 自己的审查模型）。
- 插件 Agent 取清单 `tiers`：Gemini yolo / autoEdit / default；CodeBuddy 同 Claude；Antigravity accept-edits / accept-edits / default；DeepSeek 用 `DSH_PERMISSION_MODE` 环境变量且改档重启；pi 无档位。
- 「帮我审批」（`aiReview`）且 workspace 档、官方服务时，Claude 用 `auto`、Codex 用 `agent`（`builtin_mode`），否则由共工规则处理（AI 预审已移除）。
- `bots.approval`/`allowlist` 为遗留列，恒为 `ask`（迁移 0106 起审批方式 = 档位 + aiReview），仍随 `RunStart.bot` 下发。

## 来源
- `docs/plan/Agent管理重构-施工设计.md`
- `docs/archive/2026-11/Agent工具与供应商统一管理-设计.md`
- `docs/archive/2026-11/模型与推理强度-开发计划.md`、`Gemini-CLI接入-开发计划.md`、`客户端一键接入与Bot管理收归服务端-开发计划.md`
- `docs/plan/插件体系-contributes-方案.md`
