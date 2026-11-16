# Agent 管理重构 施工设计（2026-11-16，姜维川批准）

方案原文：群话题里顶级fable 顾问的「Agent 管理重构」（一期统一定义与界面、二期数据与供应商、三期扩 Agent）。本文是可施工的细化，事实基于代码（文件:行号以 main 939ae0b94 为准）。

## 0. 已拍板（姜维川 2026-11-16）
- D1 协议四种：`anthropic | openai | gemini | codebuddy`（后两种厂商专属）。已在 `packages/protocol/src/agents.ts` 的 `API_PROTOCOLS`；zod 枚举用 `z.enum(API_PROTOCOLS)`，不要另立一份。
- D2 迁移合并口径：`(apiKey, host(baseUrl), proxy)` 相同且协议不冲突 → 合并成一个厂商多个协议端点；同协议不同 URL 的拆出保留原 id。本机 profile（configDir）从不合并。
- D3 桌面 Bot 页只读显示「供应商/模型」+「在 Web 中管理」；桌面 Agent 页的供应商与默认值可编辑（推翻 10-08「桌面只读」）。
- D4 providers.json 原地升级 v2，原文件逐字节备份为 `providers.v1.json`（已存在则 `providers.v1.<unix_ms>.json`），发版说明写明旧版需手动恢复。
- 配置合并的真实顺序（低→高）：本机 CLI 配置（只补共工没设的字段）< 用户 `--settings` 文件 < 机器默认 agentSettings < Bot 覆盖 < 预置上下文窗口 < 供应商/官方 env 与 proxy < 连接项（BASE_URL/KEY/MODEL）。见 `crates/gonggong/src/inject.rs:71-254`。不改变这个顺序。

## 1. 现状事实
- providers.json：`crates/gonggong/src/providers.rs`（Store 553-569、Provider 159-198、load/save/update 576-619、get_for 625-636、same_connection 285-290、effective 766-771、resolve_run 774-786）。预置 `crates/gonggong/presets/providers.json`（61 条，19 个 id 跨 agent 重复）由 `scripts/sync-provider-presets.mjs` 生成；插件可贡献预置 `packages/protocol/src/plugins.ts:296`，server 汇总 `apps/server/src/modules/plugins/presets.ts`。
- 注入：入口 `session.rs:89-145`；进程 `engine.rs:1066-1154`；Codex 走 `CODEX_CONFIG`（`inject.rs:309-326`）；manifest 类 agent `engine.rs:1208-1284`，manifest 在 `apps/server/plugins/official/agent-*/gonggong-plugin.json`。
- 协议对应：claude→anthropic；codex→openai（responses）；gemini→gemini；codebuddy→codebuddy；deepseek→anthropic（预置 baseUrl api.deepseek.com/anthropic）；pi、antigravity 自己登录。
- 模型：server 端 消息临时 → 群级 → Bot（`apps/server/src/modules/bots/config.ts:114-123`）下发 `RunBot.model`；daemon `session.rs:2226-2236` + `inject.rs:329-334`。
- AgentInfo 由 `agents.rs` 检测，hello/agents.update 上报，server 存 `machines.agents` jsonb；ToolStatus 由 `tools.rs` 在 tools.cmd 时实时取（server `machines/tools.ts`）。
- desktop：Tauri 命令直接链接 gonggong crate 读本机文件（`apps/desktop/src-tauri/src/commands/{providers,agents,tools}.rs`），与 daemon 同版本，不做兼容。前端 `apps/desktop/src/ipc.ts` 手写类型。
- Bot→供应商存在 daemon providers.json `bots`；Bot 模型/推理强度存在 server DB。

## 2. 新契约（packages/protocol）
新文件 `src/daemon/agent-state.ts`：
```ts
export const ApiProtocol = z.enum(API_PROTOCOLS)
/** One agent on a machine: detection + install (replaces AgentInfo and ToolStatus). Superset of AgentInfo. */
export const AgentState = z.object({
  kind: AgentKind, available: z.boolean(), version: z.string().nullable(), path: z.string().nullable(),
  minVersion: z.string().nullable().default(null), catalog: AgentCatalog.nullable().default(null),
  latest: z.string().nullable().default(null), managed: z.boolean().default(false),
  upgradeCommand: z.string().nullable().default(null), installCommand: z.string().nullable().default(null),
})
/** Node.js, the runtime, listed apart. */
export const RuntimeState = z.object({ installed, version, latest, managed, path })
```
agent-tools.ts：
- DaemonFeature 加 `agentState`（tools.result 带 node+agents）、`protocolProviders`（providers.* 用协议端点 v2，use 带 model，catalog 带 agent）。
- ToolKind 保留（install/upgrade 目标）；ToolStatus 改名 LegacyToolStatus 移到 legacy.ts。
- ToolsResult：`tools: LegacyToolStatus[] default []`（老 daemon）、`node: RuntimeState|null`、`agents: AgentState[]`、`settings`。
- ProviderPreset 改为厂商结构：`{id,name,group,websiteUrl,apiKeyUrl, endpoints: PresetEndpoint[] (min 1)}`，PresetEndpoint = `{protocol, baseUrl, apiKeyField, wireApi, model, models, modelOptions, env, effort, modelContext}`。
- ProviderView：`{id,name,presetId,revision,apiKey(masked),proxy,source, endpoints: ProviderEndpoint[], agents?: AgentKind[]}`；ProviderEndpoint = `{protocol, baseUrl, apiKeyField, wireApi, model, models, effort, env(masked), args, configDir, executablePath, modelOptions}`。`agents` 仅老 daemon 转换来的才有（限定只能给原 agent 用）。
- AgentDefault = `{provider: string, model: string|null}`；ProviderStoreView.machine 改为 `partialRecord(AgentKind, AgentDefault)`，其余字段不变（bots 仍 botId→providerId|official）。
- ProviderInput：`{id?, presetId?, name?, apiKey?, proxy?, endpoints?: EndpointInput[], removeProtocols?: ApiProtocol[]}`（同协议的端点替换，其他保留）。
- CcSwitchCandidate 加 `protocol`。
- machine.ts 删 AgentInfo，d2s hello/agents.update 用 AgentState。
- s2d：ProvidersCmd `use` 加 `model?: string|null`，`provider` 收 `ProviderInput | LegacyProviderInput`（实际 server 只给新 daemon 发新格式），`catalog` 带 `agent`；PresetsSync 收新旧两种预置。
- plugins.ts：贡献的 providers 收新旧两种；PluginAgent.provider 加 `protocols`。
- web/machines-bots.ts：MachineDto.agents → AgentState[]；`ToolsStateDto` → `MachineAgentsDto {node, agents, settings}`（ws `machine.tools.result.state` 同步）；UseProviderReq 加 `model`；BotProviderReq 加 `model, effort`；SaveProviderReq = ProviderInput.omit({id}) + `setDefault: AgentKind[]`；CreateBot 加 `model`。
新文件 `src/daemon/legacy.ts`（纯函数，web 不 import；server 用）：LegacyToolStatus/LegacyProviderPreset/LegacyProviderView/LegacyProviderStoreView/LegacyProviderInput（现 schema 原样搬）、`agentStatesFromLegacy(tools, reported)`、`storeViewFromLegacy(v)`、`presetsFromLegacy(list)`、`presetsToLegacy(list)`、`providerInputToLegacy(input, agent)`（多端点抛错）。
共用：`canUse(p: ProviderView, agent)`（有端点协议在 agentMeta(agent).protocols 里；configDir 端点只给 claude；有 `p.agents` 时须包含）与 `normalizeStoreView`。

## 3. providers.json v1→v2 迁移（daemon，新文件 `crates/gonggong/src/providers_migrate.rs`）
v2：`{version:2, machine:{agent→{provider,model}}, official, agentSettings, sessions, bots, providers:[{id,name,presetId,revision,apiKey,proxy,source,endpoints:[...]}]}`
1. LegacyStore 解析 v1；每条 protocol = 注册表首个协议；pi/antigravity 的（无协议）丢弃并记报告。
2. 分组键：configDir 的 → 自身 id；其余 `(apiKey, host(baseUrl), proxy)`（D2）。
3. 组内优先级：被机器默认引用 > 被 bots 引用 > 有会话钉住 > claude/codex 先于 manifest 类 > revision 高 > 文件顺序。
4. 合并：id/name/presetId(首个非空)/source/apiKey/proxy 取胜者；revision = max+1；端点按优先级加入、同协议只留一个；同协议同 URL 时用败者补空字段（model/models/apiKeyField/wireApi/effort，env 只补缺的键）；同协议不同 URL → 拆出保留原 id。
5. 别名表 old→merged 改写 machine（包成 {provider, model:null}）、bots、sessions[*].provider。
6. `Store::migrate_file(home)`：持 providers.lock，已是 v2 直接返回；`create_new`+0600 写逐字节备份并 fsync；原子 save；tracing 记合并/丢弃/别名（不打 key）。调用点：daemon 启动、desktop Host 启动、`gg provider`。`Store::load` 读到 v1 只在内存迁移不写盘。幂等。
7. 迁移测试必须含旧格式样例（真实形态：同 key 的 claude+codex kimi、deepseek 重复、configDir profile、pi 供应商、bots/sessions 引用败者）。
运行时：`endpoint_for(agent)` 取首个 canUse 端点；`use_machine(agent, choice, model)`；`Selection::Provider{provider, endpoint}`；模型链 消息/群/Bot(server) → Bot 继承时机器默认 model → 端点 model → adapter 默认。

## 4. 兼容（新 server/web 对接老 daemon）
- AgentState 是 AgentInfo 超集，新字段有 default，hello 解析不分支；`bots/dto.ts` 用 AgentState parse。DB 不迁移。
- `GET /machines/:id/tools` 返回 MachineAgentsDto：有 `agentState` 直用；否则 `agentStatesFromLegacy(res.tools, m.agents)`。实时事件同样转换。
- 供应商：server 包一层，返回的 view 全部 normalize（老 daemon 的 1:1 转换并带 agents=[原 agent]）。写给老 daemon：新增只允许单端点（否则 409「请先升级该机器的客户端才能为一个供应商登记多种协议」），agent 取请求可选 `agent` 或按协议映射（anthropic→claude、openai→codex、gemini→gemini、codebuddy→codebuddy）；编辑先 list 查旧 agent；机器默认带非空 model 回 409，web 按能力位隐藏模型。预置：老 daemon 返回的 presetsFromLegacy；presets.sync 按能力位发新/旧格式。
- 老 server 配新 daemon 不支持（server 先上线）。
- fixtures：`fixtures/` 只放新格式（TS/Rust 往返）；旧格式放 `packages/protocol/fixtures-legacy/` 只给 TS `provider-compat.test.ts`；新增 `fixtures/data.agent-protocols.json`，TS 与 Rust 契约测试都断言与各自注册表一致。

## 5. 分工
- WT-A protocol（先合入）：agent-state.ts、legacy.ts、agent-tools.ts、machine.ts、d2s.ts、s2d.ts、plugins.ts、web/machines-bots.ts、web/ws.ts、web/git.ts（CreateBot model）、fixtures 与测试。
- WT-B daemon（Rust）：protocol 镜像、providers.rs v2 + providers_migrate.rs、inject.rs、engine.rs、session.rs、manage.rs（能力位、Save/Use(model)/Catalog(agent)/Presets）、ccswitch.rs、provider_cli.rs、agent_settings.rs、adapters.rs、agents.rs/tools.rs（AgentState/RuntimeState）、预置重生成、官方 agent manifest 加 provider.protocols、i18n、测试。
- WT-C server：machines/tools.ts、providers/routes.ts、bots/config.ts、bots/routes.ts、bots/dto.ts、gateway.ts、machines/routes.ts、plugins/presets.ts 与测试。
- WT-D web：features/agents（新一套 Agent 页组件，web/desktop 共用，只换数据源）、供应商机器级列表与按协议端点编辑、Bot「供应商/模型」一体选择、删旧 AgentsPanel/ToolsPanel 重复。
- WT-E desktop：Tauri 命令适配 v2 与 migrate_file、ipc.ts 改用 protocol 类型、用 features/agents 组件替换 pages/Agents.tsx 与 providers/ 目录、Bots 页按 D3。
- 三期：注册表加 opencode/qwen/kimi/goose/copilot 各一条 + daemon 检测器 + ACP 启动 manifest（见 §6）。
- 集成：e2e（Agent 页列表/安装/升级/详情、供应商增改与协议不匹配提示、Bot 继承与覆盖），`pnpm check --all`，docs/domains。

## 6. 三期候选（调研结论，均原生 ACP、stdio）
| Agent | ACP 启动 | 安装 | bin | 登录/端点 | 协议 |
|---|---|---|---|---|---|
| OpenCode | `opencode acp` | npm `@opencode/cli`（V2；旧包 opencode-ai 为 V1） | opencode | `opencode auth login`；第三方端点需写配置文件 | own（一期先自己登录） |
| Qwen Code | `qwen --acp` | npm `@qwen-code/qwen-code`（Node 22+） | qwen | Qwen OAuth；`OPENAI_API_KEY/BASE_URL/MODEL` | openai |
| Kimi Code | `kimi acp` | npm `@moonshot-ai/kimi-code` | kimi | `/login`；`KIMI_MODEL_NAME/API_KEY/BASE_URL/PROVIDER_TYPE`(kimi/openai/anthropic) | anthropic, openai |
| Goose | `goose acp` | 无 npm：`curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh \| CONFIGURE=false bash` | goose | `GOOSE_PROVIDER/GOOSE_MODEL` + `OPENAI_API_KEY/OPENAI_HOST` 或 `ANTHROPIC_API_KEY/ANTHROPIC_HOST` | anthropic, openai |
| Copilot CLI | `copilot --acp`（公开预览） | npm `@github/copilot`（Node 22+） | copilot | `copilot login`/`COPILOT_GITHUB_TOKEN`；BYOK `COPILOT_PROVIDER_BASE_URL/TYPE/API_KEY`+`COPILOT_MODEL` | anthropic, openai |
Lobe Icons 单色 path（24×24）与主色见调研记录（opencode #000、qwen #082dff、kimi #000、goose 白底黑标、githubcopilot #000；注意 copilot.svg 是微软 Copilot，用 githubcopilot.svg）。

### 三期图标 path（lobe-icons packages/static-svg/icons，原文）
- opencode: `M16 6H8v12h8V6zm4 16H4V2h16v20z`
- qwen: `M19.713 2.825h-5.907c0-.251-.066-.503-.196-.728L12.819.728A1.46 1.46 0 0 0 11.559 0h-1.58c-.52 0-1 .275-1.26.728l-2.42 4.19a1.45 1.45 0 0 0 0 1.453l.791 1.37c.26.448.74.727 1.26.727h11.36c.52 0 1-.275 1.26-.728l.79-1.37a1.45 1.45 0 0 0 0-1.451l-.79-1.37a1.46 1.46 0 0 0-1.26-.728zM.195 9.905l2.951 5.115a1.46 1.46 0 0 0-.531.531l-.791 1.37a1.45 1.45 0 0 0 0 1.452l.79 1.37c.26.448.74.727 1.26.727h4.84c.52 0 1-.275 1.26-.728l.79-1.37a1.45 1.45 0 0 0 0-1.451L5.086 7.083a1.46 1.46 0 0 0-1.26-.728h-1.58c-.52 0-1 .276-1.26.728l-.79 1.37a1.45 1.45 0 0 0 0 1.452m15.888 13.367 2.951-5.115c.217.125.469.196.728.196h1.582c.52 0 1-.275 1.26-.728l.79-1.37a1.45 1.45 0 0 0 0-1.451l-2.42-4.191a1.46 1.46 0 0 0-1.259-.728h-1.582c-.52 0-1 .276-1.259.728l-5.678 9.838a1.45 1.45 0 0 0 0 1.452l.79 1.37c.26.448.74.727 1.26.727h1.582c.52 0 1-.275 1.26-.728z`
- kimi（两条）: `M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z` 与 `M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.770c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z`
- goose / githubcopilot：path 较长，施工时从 https://github.com/lobehub/lobe-icons/tree/master/packages/static-svg/icons 的 goose.svg、githubcopilot.svg 原样取。
