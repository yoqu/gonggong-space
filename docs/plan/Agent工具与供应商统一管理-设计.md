# Agent 工具与供应商统一管理 · 设计

状态：**v5，S0–S6 已实现（未提交），遗留见 §11**（2026-09-30）。依据：现有代码、CC Switch v3.20.4 源码、npmmirror 实测。§4.4 的注入方式已按 §10 的 S0 实测结论定稿。

## 1. 背景与现状

| 能力 | 现状 | 位置 |
|---|---|---|
| 检测 claude/codex | 已有：PATH＋常见目录、`--version`、登录态，每 60s 复检 | `crates/gonggong/src/agents.rs` |
| 安装/升级 CLI | **无**。桌面端只给出一条可复制的 `npm i -g` 命令；Web 端只显示版本 | `apps/desktop/src/lib/labels.ts` |
| Node / ACP 适配器 | 需要系统自带 Node ≥22；适配器锁定版本后自动 `npm install`（走默认源） | `engine.rs:33-37,441` |
| 供应商 / API Key | **无**。agent 进程继承 daemon 环境，鉴权全靠 CLI 自己的登录 | `engine.rs:420-437` |
| 会话 | 按 `groupBots.sessionId` 续接，`/new` 通过 `newSessionReason` 开新会话 | `apps/server/src/db/schema.ts:277-281` |
| 远程操作机器 | 只有 requestId 形式的 RPC，每个模块各写一遍 | `modules/workspaces/routes.ts:41` |

## 2. 目标与非目标

目标

1. 统一管理 claude、codex、Node 的状态查看、一键安装、一键升级，**默认走淘宝镜像（npmmirror）**。
2. 供应商配置**按机器各自维护、只存在该机器本地**：可选官方登录或第三方（Base URL＋Key＋模型）。机器上为每个 agent 设一个默认供应商，每个 Bot 可单独覆盖，不覆盖就继承机器的。
3. 在客户机上读取本机 CC Switch 配置，导入**本机**的供应商列表。
4. CLI、桌面 GUI、Web 三端能力一致；云主机的操作可以全部在 Web 完成（Web 通过 RPC 实时读写该机器）。
5. 切换供应商不影响进行中的会话，开新会话后才生效，并且提醒到位。

非目标（已定）

- **供应商配置禁止存储到云端**：server 数据库、日志、审计里都不存供应商的任何配置（名称、Base URL、Key、模型映射、绑定关系都不存）。
- **不跨机器共用**：每台机器各自一份，不提供机器之间复制或同步。
- **禁止修改用户级全局文件**（`~/.claude/`、`~/.codex/` 等）；用户本机 CLI 的切换由用户自己用 CC Switch 或手改配置完成。
- 不做 CC Switch 的其余功能（代理、故障转移、用量、MCP/Prompt/Skill 同步、Gemini 等）。
- 服务端不能向机器下发任意命令。

## 3. 总体架构

```
 gg CLI ──┐                                   Web（机器详情 / Bot 设置 / 群聊横条）
 桌面 GUI ─┼─ 直接读写本地 ─┐                         │ 只经 WSS 实时转发，不落库
          │                ▼                         ▼
          │   ┌──────────── daemon（每台机器）────────────────┐
          │   │ providers.rs  ~/.gonggong/providers.json 0600 │ ← 供应商、机器默认、Bot 覆盖、会话锁定
          │   │ ccswitch.rs   只读本机 ~/.cc-switch            │
          │   │ engine.rs     启动 adapter 时本地决定用哪个供应商 │
          │   │ tools.rs      Node/claude/codex 安装与升级       │
          │   └───────────────────────────────────────────────┘
```

- **daemon 是唯一真相，供应商配置只保存在本机**。`run.start` 不带任何供应商信息，由 daemon 在本地决定用哪一个。
- server 只做两件事：
  - 转发 Web 与 daemon 之间的 RPC，只经过内存；
  - 在内存里缓存各会话的供应商提示状态，用于展示横条，不写入数据库（§4.3）。
- 机器离线时，Web 上看不到也改不了这台机器的供应商，页面提示「机器离线」。

## 4. 设计

### 4.1 工具管理（daemon `tools.rs`）

管理对象：`node`、`claude`、`codex`。ACP 适配器仍跟随 daemon 版本锁定，但安装也走镜像。

**镜像源**：属于机器级设置，存放在 `~/.gonggong/settings.json` 的 `mirror`。

| 选项 | npm registry | Node 二进制 |
|---|---|---|
| `npmmirror`（**默认**） | `https://registry.npmmirror.com` | `https://npmmirror.com/mirrors/node/` |
| `official` | `https://registry.npmjs.org` | `https://nodejs.org/dist/` |
| `custom` | 自填 | 自填 |

2026-09-30 实测：npmmirror 上有 `@anthropic-ai/claude-code@2.1.285` 和 `@openai/codex@0.159.2`，各平台的原生二进制都以 npm `optionalDependencies` 发布，因此走镜像可以装全；`mirrors/node/index.json` 和 `SHASUMS256.txt` 都可以访问。

**安装与升级**

- **Node**：从镜像下载最新的 ≥22 LTS，**校验 SHASUMS256**，解压到 `~/.gonggong/runtime/node-<ver>`，再原子切换 `current`。系统已有 ≥22 的 Node 时直接用系统的。
- **claude / codex**：用托管 Node 执行 `npm i -g --prefix ~/.gonggong/tools --registry <mirror> <pkg>@<ver|latest>`。不需要 sudo，也不碰全局 npm 目录。
- **查找顺序**：`local.json` 里手动指定的路径 > `~/.gonggong/tools/bin` > 现有的 PATH 与常见目录。
- **用户自装版本**：只显示版本和「有更新」，并提供「安装共工托管版」。不代为执行 `claude update`，因为它要访问外网，国内经常失败。
- **最新版本**：从镜像的 `/<pkg>/latest` 和 Node 的 `index.json` 获取，缓存 6 小时。
- **执行方式**：每台机器同一时间只跑一个操作，输出逐行推送。完成后重新检测并发送 `agents.update`。
- **有 run 在进行时**：先装到新目录，等空闲再切换（复用 `upgrade.rs` 的空闲判断），不影响正在运行的 adapter。
- **自动升级**：每个工具一个开关，默认关闭，开启后在空闲时执行。

### 4.2 供应商存储（daemon `providers.rs`）

`~/.gonggong/providers.json`，权限 0600，采用原子写（写临时文件后 rename）。每次 run 开始时读取，因此 CLI 或 GUI 改完后立即生效。

```json
{
  "machine": { "claude": "kimi-1727", "codex": "official" },
  "bots": { "<botId>": "official" },
  "providers": [
    { "id": "kimi-1727", "agent": "claude", "name": "Kimi", "presetId": "kimi", "revision": 1,
      "baseUrl": "https://api.moonshot.cn/anthropic", "apiKey": "sk-…",
      "model": "kimi-k2.7-code", "models": { "haiku": "…", "sonnet": "…", "opus": "…" },
      "env": {}, "source": { "kind": "cc-switch", "id": "…" } },
    { "id": "…", "agent": "codex", "name": "…", "revision": 1, "baseUrl": "https://…/v1",
      "apiKey": "sk-…", "model": "…", "wireApi": "responses", "extraToml": "" }
  ],
  "sessions": { "<acpSessionId>": { "provider": "kimi-1727" } }
}
```

- **生效的供应商** = `bots[botId]` ?? `machine[agent]` ?? `official`。`bots` 里没有某个 Bot，表示它继承机器设置。Bot 的覆盖项必须与 `bot.agentKind` 属于同一个 agent。
- **`official`**：不注入任何配置，行为与现在相同，沿用本机 CLI 自己的登录和用户级配置。
- **Bot 被解绑或删除**：daemon 收到 bots 变更后清理对应条目。
- **会话记录**：会话结束后不主动清理，只在保留期满时连同工作区清理一并删除。

### 4.2.1 内置厂商预设（仿 CC Switch）

用户新增供应商时**先选厂商，再只填 Key**。厂商名称、Base URL、模型列表、额外参数都来自内置预设。

**来源与同步**

- 预设数据取自 CC Switch 的 `src/config/claudeProviderPresets.ts` 和 `codexProviderPresets.ts`（MIT 许可，本次基线为 v3.20.4 之后的 main `36d9504`）。
- 由脚本 `scripts/sync-provider-presets.mjs` 生成 `crates/gonggong/presets/providers.json`，用 esbuild 打包 TS 后取数据，过滤、精选后输出。
- daemon 用 `include_str!` 把预设内置进二进制，三端共用同一份：CLI 和 GUI 在本地直接读取；Web 通过 RPC `providers.cmd {action:"presets"}` 获取。
- 预设文件头部写明来源版本；仓库 `THIRD_PARTY_NOTICES` 附上 CC Switch 的 MIT 声明。
- 更新预设 = 重跑脚本并审阅 diff，随 daemon 发版。

**过滤规则**（只保留共工能直接使用的预设）

| 规则 | 原因 |
|---|---|
| claude 只收 `apiFormat` 为空或 `anthropic` 的预设 | `openai_chat`、`gemini_native` 等格式要靠 CC Switch 的本地代理做协议转换，共工不做代理 |
| codex 只收直连的 Responses 预设（`apiFormat` 不是 `openai_chat`） | 原因同上 |
| 排除 `requiresOAuth`、`providerType`（GitHub Copilot、ChatGPT 反代、xAI OAuth） | 这些需要 OAuth 托管登录 |
| 排除带 `templateValues` 的预设（Bedrock AKSK、KAT-Coder 等） | 首期只支持「只填 Key」 |
| 排除 `official` 类 | 对应的就是「官方登录」 |
| URL 去掉 `aff`、`ref` 等推广参数 | 不替第三方带推广 |
| **精选白名单**：只收主流厂商，不收小型中转站和赞助商 | 满足「市面主流厂商」的要求 |

**首期白名单**（按分组展示；括号内为 CC Switch 中的名称，✓ 表示该 agent 有可用预设）

| 分组 | 厂商 | claude | codex |
|---|---|---|---|
| 国内厂商 | Kimi（Kimi / Kimi For Coding，含 Global 版） | ✓ | ✓ |
| | DeepSeek | ✓ | ✓ |
| | 智谱 GLM（Zhipu GLM / Zhipu GLM en） | ✓ | ✓ |
| | 通义千问（千问AI平台、Coding Plan / QwenCloud 国际版） | ✓ | ✓（仅 Responses 版） |
| | 火山方舟（火山 Coding Plan / Agent Plan / Volcengine Doubao / BytePlus） | ✓ | ✓ |
| | MiniMax（含 en） | ✓ | ✓ |
| | 阶跃星辰（StepFun / StepFun API，含 en） | ✓ | ✓（仅 API 版） |
| | 百度千帆（Coding Plan / Baidu Qianfan） | ✓ | ✓（仅 Qianfan） |
| | 腾讯（Tencent Token Plan / Tencent Hunyuan） | ✓ | ✓（仅 Hunyuan） |
| | 小米 MiMo | ✓ | ✓ |
| | 美团 LongCat | ✓ | ✓ |
| | 蚂蚁百灵（BaiLing） | ✓ | — |
| | 讯飞星辰（Astron Coding Plan） | — | ✓ |
| 聚合平台 | OpenRouter | ✓ | ✓ |
| | 硅基流动（SiliconFlow，含 en） | ✓ | — |
| | 魔搭（ModelScope） | ✓ | — |
| | AiHubMix | ✓ | ✓ |
| | PPIO | ✓ | — |
| | Novita AI | ✓ | — |
| 海外 | xAI Grok（API Key 版） | — | ✓ |

**预设结构**（`presets/providers.json`）

```json
{ "source": "cc-switch@36d9504", "presets": [
  { "id": "kimi-coding", "agent": "claude", "name": "Kimi For Coding", "group": "cn",
    "websiteUrl": "https://www.kimi.com/code/", "apiKeyUrl": "…",
    "baseUrl": "https://api.kimi.com/coding/", "apiKeyField": "ANTHROPIC_AUTH_TOKEN",
    "model": "kimi-for-coding", "models": { "haiku": "…", "sonnet": "…", "opus": "…" },
    "modelOptions": ["kimi-for-coding"],
    "env": { "CLAUDE_CODE_MAX_CONTEXT_TOKENS": "262144", "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "262144" } },
  { "id": "zhipu", "agent": "codex", "name": "智谱 GLM", "group": "cn",
    "baseUrl": "https://open.bigmodel.cn/api/v1", "wireApi": "responses",
    "model": "glm-5.3", "modelOptions": ["glm-5.3", "glm-5.3-flash", "glm-5-turbo"], "effort": "high" }
] }
```

- 字段来源：
  - claude 的 `modelOptions` 是 `ANTHROPIC_MODEL` 与 `DEFAULT_*` 去重后的并集；
  - codex 的 `modelOptions` 取自 `modelCatalog`，`model`、`effort` 取自 `config` TOML；
  - claude 的 `env` 只保留白名单内的额外变量：`CLAUDE_CODE_MAX_CONTEXT_TOKENS`、`CLAUDE_CODE_AUTO_COMPACT_WINDOW`、`CLAUDE_CODE_MAX_OUTPUT_TOKENS`、`CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`、`ENABLE_TOOL_SEARCH`、`ANTHROPIC_SMALL_FAST_MODEL`。
- 显示名：国内厂商用中文名（例如「智谱 GLM」「通义千问」），`id` 保持稳定，供升级比对。

**创建流程**（三端一致）

1. 选择 agent，进入按分组展示、可搜索的厂商列表；末尾有一项「自定义」，用于手动填写 Base URL。
2. 选中厂商后，表单自动带出名称、Base URL、模型。只需填写 **API Key**，旁边有「获取 Key」链接，指向 `apiKeyUrl` 或 `websiteUrl`。
3. 「模型」下拉取自 `modelOptions`，也允许手动输入；「高级」折叠区可改 Base URL、haiku/sonnet/opus 映射和额外 env。
4. 保存时把预设值**拷贝**进 `providers.json`（记录 `presetId`）。之后预设更新不会悄悄改动用户的配置；编辑页提供「恢复为预设值」。
5. 可选勾选「设为本机默认」。

CLI 用法：`gg provider presets [claude|codex]` 列出预设；`gg provider add claude --preset kimi-coding --key-stdin [--model …]`。

### 4.3 会话锁定与提醒

- **锁定在 daemon 本地**：开新会话时，把当时生效的供应商写入 `sessions[sessionId]`。之后续接会话**始终使用锁定的供应商**，不受机器或 Bot 设置变更的影响。
- **同一供应商被编辑**（例如换 Key、改 URL）：`revision` 递增，daemon 重启该 (group, bot) 的 adapter 后 resume，修复即时生效。
- **只有 `/new` 或点「开启新会话」才会切换**到当前生效的供应商。
- **锁定的供应商被删除**：daemon 在下一轮自动开新会话，上报 `newSessionReason = 'provider_removed'`（只是原因码，不含配置），并在时间线上说明原因。
- **提示状态只放内存**：daemon 在 `agents.update` 和每次 run 结束时，上报 `bots.providerState {items: [{groupId, botId, session: name, effective: name}]}`，只包含「会话 ≠ 生效」的条目。server 仅在内存里保存，按机器分开；机器离线就清空，重连后 daemon 会重发。server 通过 realtime 推给群成员，**不写库**。

提醒位置与文案

| 场景 | 形式 | 文案 |
|---|---|---|
| Web、GUI 修改机器默认或 Bot 的供应商 | 保存前确认 | 「N 个群的会话仍在使用 X，开启新会话后才会切换到 Y」 |
| CLI `gg provider use` | 命令输出 | 同上，并列出受影响的群 |
| 群聊中会话供应商 ≠ 生效供应商 | 输入框上方常驻横条 | 「本会话使用 X；已切换为 Y，开启新会话后生效」[开启新会话] |
| Bot 资料卡（Bot 所在机器在线时实时查询） | 字段 | 「当前会话：X · 新会话：Y」 |
| 开新会话后 | 时间线系统消息 | 「已开启新会话」，不含供应商名（因为时间线会落库） |

### 4.4 注入（daemon `engine.rs`）

daemon 根据本地配置决定用哪个供应商，只注入 adapter 子进程，不改全局文件，不进日志、不进命令行参数。选型依据见 §10。

- **claude**：用 Claude Code 的 flag settings 层（优先级高于 user/project/local，进程环境变量会被 `~/.claude/settings.json` 的 `env` 盖掉）。
  - daemon 生成 `~/.gonggong/run/claude-<providerId>.json`（0600，原子写，`revision` 变化时重写，删除供应商时删除），内容为：`{"apiKeyHelper":"","env":{…}}`；
  - `env` = 连接字段全集：`ANTHROPIC_BASE_URL`、Key（`ANTHROPIC_AUTH_TOKEN` 或 `ANTHROPIC_API_KEY`，另一个置 `""`）、`ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL`、`ANTHROPIC_SMALL_FAST_MODEL`（未配置的一律置 `""`），加上复位项 `CLAUDE_CODE_OAUTH_TOKEN`、`ANTHROPIC_CUSTOM_HEADERS`、`ANTHROPIC_BEDROCK_BASE_URL`、`ANTHROPIC_VERTEX_BASE_URL` 置 `""`、`CLAUDE_CODE_USE_BEDROCK`/`CLAUDE_CODE_USE_VERTEX` 置 `"0"`，最后并入供应商的额外 `env`；
  - 把**文件路径**放进 `session/new`、`session/resume`、`session/load` 的 `_meta.claudeCode.options.settings`（与现有 `systemPrompt` 并列）。每次恢复都必须带；不能传对象（会以 `--settings <json>` 出现在 argv，`ps` 可见 Key）。
- **codex**：全部走 adapter 进程环境，不落盘。
  - `CODEX_CONFIG` 在现有 `developer_instructions` 之外并入 `model_provider="gg"`、`model`、`model_providers.gg={name, base_url, wire_api="responses", env_key="GG_PROVIDER_KEY"}`（预设有 `effort` 时加 `model_reasoning_effort`）；
  - 同时设 `MODEL_PROVIDER=gg`（**必须**，否则续接会话时 codex-acp 用 `~/.codex/config.toml` 的 `model_provider` 发请求）和 `GG_PROVIDER_KEY=<key>`。
- **官方登录**：不带 `settings`、不加上述 env，与现状一致。
- 供应商是按 adapter 进程/会话创建时生效的：`revision` 变化或切换时，重启该 (group, bot) 的 adapter 再 resume（§4.3）。

**模型目录**

- 官方登录：维持现状，由 `AgentInfo.catalog` 随 `agents.update` 上报。
- 第三方供应商：Web 打开 Bot 的模型下拉时，发 RPC `providers.catalog {agent, providerId}` 实时探测，结果缓存在 daemon 本地（按 `providerId+revision+cliVersion`）；探测失败时，回落到供应商里声明的 `models`。
- Bot 已选的模型在新目录中不存在：回落到默认模型并给出提示。
- 模型名沿用现有 `bots.model` 字段存储，这属于 Bot 设置，不是供应商配置。

### 4.5 CC Switch 导入（daemon `ccswitch.rs`）

**只读本机、只导入本机**：客户机的 daemon 读取自己的 `~/.cc-switch`，写入自己的 `providers.json`。不导入云主机上的 CC Switch，也不跨机器复制。

- **数据源依次尝试**：`cc-switch.db`（SQLite 只读，读之前先检查列是否存在）→ `config.json` v2 → `config.json.migrated`。
- **只取 claude 和 codex**：`app_type ∈ {claude, codex}`。当前项以 `~/.cc-switch/settings.json` 的 `currentProvider<App>` 为准，没有时回落到 `is_current`。
- **claude**：只取 `settings_config.env` 中与连接相关的键，忽略 hooks、plugins 等残留。
- **codex**：用 `toml` 解析 `config`。
  - Key 依次取：`auth.OPENAI_API_KEY` → `[model_providers.<cur>].experimental_bearer_token` → 顶层同名字段。
  - base_url 依次取：`[model_providers.<cur>].base_url` → 顶层 `base_url` / `openai_base_url`。
- **`category = official`**：不导入，它等同于官方登录。
- **去重**：先按 `source.id`，再按 `(agent, baseUrl, apiKey)`。命中已有项时更新它并让 `revision` 加 1，不新增。
- **导入流程**：预览（Key 脱敏）→ 勾选 → 写入；可选「同时设为本机默认」。三端的入口：
  - 桌面 GUI：本地调用；
  - `gg provider import cc-switch`；
  - Web：对**这台机器**发 RPC `ccswitch.read` 预览，确认后发 `ccswitch.apply`。只有 daemon 上报 `features` 含 `ccSwitch` 时才显示入口；预览只返回脱敏数据，明文 Key 不离开机器。
- **云主机**：没有 CC Switch，在 Web 上手动新增，或粘贴 `ccswitch://v1/import?resource=provider&app=…` 链接。链接交给**该机器**的 daemon 解析；Key 只经 WSS 透传，server 不落库、不打日志。

### 4.6 协议（先改 `packages/protocol`，同步 fixture 与 `protocol.rs`）

| 方向 | 消息 | 说明 |
|---|---|---|
| S→D / D→S | `tools.run {requestId, op: install\|upgrade\|check, kind, version?}` / `tools.progress {requestId, line}` / `tools.result {requestId, ok, error?, tools}` | 只允许白名单操作，`version` 需正则校验 |
| S→D / D→S | `tools.settings {requestId, mirror?, autoUpgrade?}` / `tools.settings.result` | 镜像与自动升级设置 |
| S→D / D→S | `providers.cmd {requestId, action, …}` / `providers.result {requestId, ok, error?, view}` | action 取值为 `list`、`save`、`remove`、`use`（machine 或 bot）、`importLink`、`catalog`、`botCatalog`（Bot 新会话生效供应商的模型目录，server 据此校验所选模型，不落库）。`save` / `importLink` 的请求里可以带明文 Key；`view` 一律脱敏（Key 只给末 4 位） |
| S→D / D→S | `ccswitch.read {requestId}` / `ccswitch.apply {requestId, ids, setDefault}` / `ccswitch.result` | 预览结果已脱敏 |
| D→S | `bots.providerState {items}` | 仅在 server 内存中保存，用于展示横条 |
| D→S | `agents.update` 的 `AgentInfo` 增加 `latest?`、`managed` | 工具状态（不含供应商信息） |
| D→S | `hello.features: string[]` | `tools`、`providers`、`ccSwitch`。旧 daemon 会忽略未知消息（`service.rs:291`），Web 据此把相关按钮置灰，并提示先升级 daemon |

- server 新增 `hub.request(machineId, msg, timeoutMs)`，只给新模块使用，不改动现有的 8 处重复实现。
- **server 端的脱敏**：在 `providers.cmd`、`ccswitch.*` 的转发路径上，禁止记录请求体；日志和错误信息里只出现消息类型和 requestId。审计只记「谁、在哪台机器、做了什么动作」，不记录供应商名称和内容。
- `run.start` **不变**，不携带任何供应商字段。

### 4.7 三端界面

**CLI**（直接读写本地文件，不经过 server）

```
gg agents                                        # 已有，增加：最新版本、是否托管、本机默认供应商
gg agents install <node|claude|codex> [--version X]
gg agents upgrade [<kind>|--all]
gg agents mirror [npmmirror|official|<registry-url> --node-mirror <url>]
gg provider list [claude|codex]
gg provider add claude --name Kimi --base-url … --model … --key-stdin
gg provider edit <id> …    |   gg provider rm <id>
gg provider use <claude|codex> <id|official>     # 本机默认
gg provider use --bot <bot> <id|official|inherit>
gg provider import cc-switch                     # 读本机 CC Switch，交互勾选
gg provider import 'ccswitch://v1/import?…'
```

**桌面 GUI**（在现有 `pages/Agents.tsx`、`Settings.tsx` 上扩展，本地调用）

- Agent 卡片：显示版本和「有更新」，提供安装、升级、「安装共工托管版」，可展开看日志；Node 单独一张卡。
- 每个 Agent 卡片下方是本机供应商列表：单选设为默认，可新增、编辑、删除，入口还有「从 CC Switch 导入」「粘贴链接」。
- 本机 Bot 列表里可以为每个 Bot 选供应商（继承 / 官方 / 某一项）。
- 设置页：镜像源（默认淘宝）、各工具的自动升级开关。

**Web**（全部走实时 RPC，机器离线时不可用）

- `MachineDialog` 新增两个页签，仅机器主人可见：
  - 「Agent 工具」：与桌面端同样的操作，实时显示进度，可设置镜像源。
  - 「供应商」：本机的供应商列表、各 agent 默认、导入入口。Key 只能填写或替换，不回显。
- Bot 设置：供应商下拉，选项为「继承机器（当前：X）」、官方登录、该 Bot 所在机器上同一 agent 的各项；模型下拉随之刷新。
- 群聊：显示 §4.3 的横条。
- 管理员的 `MachinesPage`：只加一列「Agent 版本 / 可升级」，不提供操作入口。

## 5. 安全

- **云端零存储**：供应商配置和绑定关系只存在于机器上的 `providers.json`（0600）。server 只在内存中转发，不落库、不写日志、不写入审计内容。
- **权限**：机器的工具与供应商只有机器主人能操作；Bot 的供应商只能由 Bot 主人设置，而且 Bot 主人必须也是它所在机器的主人（与现有绑定关系一致）。
- **Key 脱敏**：Key 离开 daemon 时一律脱敏（末 4 位）。以下各处都要覆盖：
  - daemon 与 server 的日志
  - 诊断包（`gg logs --export` 默认排除 `providers.json`）
  - realtime 推送
  - 错误信息
  - `logs.rs`、`runs/redact.ts` 的脱敏规则，补上 `sk-`、`ANTHROPIC_AUTH_TOKEN`、`GG_PROVIDER_KEY`
- **下载安全**：只从配置的镜像或官方地址下载；Node 必须校验 SHASUMS256；npm 固定 `--registry`。

## 6. 分阶段

| 阶段 | 内容 | 验收 |
|---|---|---|
| S0 探针（1 天） | §9 的 1–3 项 | 结论写回本文，并选定 §4.4 的注入方式 |
| S1 daemon 工具管理 | `tools.rs`（Node 托管、npm 托管安装、镜像、检查更新）；适配器安装改走镜像；`gg agents install/upgrade/mirror` | 单元测试（假 registry、假 Node 镜像）＋`cargo test` |
| S2 daemon 供应商 | `providers.rs`（存储、生效解析、会话锁定、删除后开新会话）、engine 注入、`ccswitch.rs`、`gg provider *` | 单元测试（按 CC Switch 真实 schema 的库和 v2 JSON 做夹具）；假 Anthropic 端点收到的 Base URL 和 Key 正确 |
| S3 协议＋server 转发 | 协议与 fixture、`hub.request`、转发路由、内存中的 providerState、日志脱敏 | 集成测试（假 daemon）；**断言数据库和日志里没有任何供应商字段** |
| S4 Web | `MachineDialog` 两个页签、Bot 供应商、群聊横条、导入预览 | 组件测试＋无头走查 |
| S5 桌面 GUI | Agents 页、设置页、本机 Bot 供应商 | 走查 |
| S6 e2e | 真实 daemon：切换机器默认 → 旧会话仍请求旧端点 → `/new` 后请求新端点；Bot 覆盖生效；在假镜像上完成安装和升级 | Playwright |

## 7. 已定决策（2026-09-30 评审）

1. 默认镜像为淘宝（npmmirror），可以切换为官方或自定义。
2. 不做「同步到本机 CLI」，**禁止修改全局文件**。
3. CC Switch 只从客户机本地读取，并且只导入这台机器本身。
4. 供应商配置默认只对共工生效。
5. 机器为每个 agent 设默认供应商，Bot 可以单独覆盖，否则继承机器设置。
6. Node 由共工托管。
7. 进行中的会话不受影响，开新会话后才生效，并按 §4.3 提醒。
8. **供应商配置按机器各自维护，只存在客户机，禁止存到云端，也不跨机器共用。**

## 8. 与现有行为的兼容

- 不配置任何供应商时，行为与现在完全一致：使用官方登录，不做注入。
- 旧 daemon：不支持 `features` 里的相关项，Web 把按钮置灰并提示先升级。`run.start` 本身没有改动，不存在兼容问题。

## 9. 风险（S0 验证）

1. **claude 的配置优先级**：`~/.claude/settings.json` 里的 `env` 是否会覆盖进程环境变量。如果会，需要确认 SDK settings 覆盖或 `CLAUDE_CONFIG_DIR` 隔离哪个可行，并且保住官方登录凭据（macOS 的 keychain、Linux 的 `.credentials.json`）。
2. **codex 的配置透传**：codex-acp 是否把 `CODEX_CONFIG` 里的 `model_providers.*` 和 `env_key` 透传给 codex，并且优先于 `~/.codex/config.toml`。如果不行，改用隔离的 `CODEX_HOME`。
3. **续接会话的 sessionId**：daemon 要能在 `run.start` 里拿到将要续接的 sessionId，用它找到锁定的供应商。已确认 `groupBots.sessionId` 会随 run 下发，还要核对具体字段；删除供应商后由 daemon 自行开新会话，并上报新的 sessionId。
4. **托管安装的路径**：npm `--prefix` 安装后，claude/codex 能否从 `bin` 正常运行（包括 Windows 的 `.cmd` 和 Linux musl）。

## 10. S0 结论（2026-09-30 实测）

环境：macOS arm64，claude 2.1.285、codex-cli 0.156.1，适配器 `claude-agent-acp@0.81.0`、`codex-acp@1.13.0`（`~/.gonggong/adapters`，只读使用）。全部实验用假 HOME / `CODEX_HOME`（内含指向「诱饵」端点的配置），两个本地假端点（诱饵 / 注入）记录路径与鉴权头并返回合法响应；真实 `~/.claude`、`~/.codex`、`~/.cc-switch`、`~/.gonggong` 未改动（前后 mtime 核对）。

### 10.1 claude

| # | 做法 | 结果 |
|---|---|---|
| 1 | `claude -p`，进程 env 设注入 URL/Token，假 HOME 的 `settings.json` `env` 设诱饵 | **诱饵胜**（请求带 `Bearer decoy`、诱饵模型） |
| 2 | 同上，经 ACP 适配器（进程 env） | **诱饵胜** |
| 3 | CLI `--settings '{"env":{…}}'` | 注入胜；同样胜过项目 `.claude/settings.local.json` |
| 4 | 适配器 `_meta.claudeCode.options.settings`（对象）于 `session/new` | 注入胜；适配器转成 CLI `--settings <json>`，**Key 出现在 argv**（`ps` 可见） |
| 5 | 同上但传**文件路径**（字符串） | 注入胜；argv 只有路径 ✅ |
| 6 | `session/resume` 带 / 不带同样 `_meta` | 带：注入；**不带：回到诱饵** → 每次恢复都要带 |
| 7 | 只覆盖 URL/Token/模型，用户配置另有 `ANTHROPIC_API_KEY`、`apiKeyHelper`、`DEFAULT_*_MODEL` | **用户的 Key 以 `x-api-key` 泄漏给第三方端点**，模型也会被用户值带偏；把这些键置 `""`、`apiKeyHelper:""` 后只剩注入的 `Bearer` ✅ |
| 8 | 真实 HOME + `CLAUDE_CONFIG_DIR=<空目录>` 执行 `claude auth status` | `loggedIn:false`（keychain 条目按配置目录区分），且 projects 目录随之迁移 → 官方登录与会话续接都会断；真实 `~/.claude` 未被写 |

其他发现：

- 适配器自带 ACP `providers/set`：只支持 baseUrl＋headers，强制 `ANTHROPIC_AUTH_TOKEN=acp-proxy`，不复位模型变量，且作用于整个进程，不采用。
- 适配器会在 initialize / 每轮开始跑 `claude auth status --json` 探测，这一步不带我们的 settings：会对用户配置的 Base URL 发一次无鉴权的 `HEAD /api/hello`，`_auth/status_update` 反映的是用户全局配置（daemon 目前不消费该通知，无影响）。
- 未配置供应商时不带 `settings`，官方登录路径与现状一致。

**选定**：flag settings **文件**＋`_meta.claudeCode.options.settings`（见 §4.4）。放弃：进程 env（输）、内联对象（argv 泄漏）、`CLAUDE_CONFIG_DIR` 隔离（丢登录）、`providers/set`（能力不足）。

### 10.2 codex

codex-acp 把 `CODEX_CONFIG`（JSON）作为 app-server `thread/start`、`thread/resume` 的 `config` 覆盖（等价 `-c`，走 stdin JSON-RPC，不进 argv）；`thread/start` 的 `modelProvider` 取 `MODEL_PROVIDER` env，`thread/resume` 的取 `MODEL_PROVIDER` ?? 用户 `config.toml` 的 `model_provider`。

| # | 做法 | 结果 |
|---|---|---|
| 1 | `codex exec`，诱饵 `config.toml`（`model_provider="decoy"`、`experimental_bearer_token`） | 诱饵（基线） |
| 2 | `codex exec -c model_provider="gg" -c model=… -c model_providers.gg={…,env_key="GG_PROVIDER_KEY"}` | 注入胜，`Bearer <GG_PROVIDER_KEY>`；另放 `auth.json` 的 `OPENAI_API_KEY` 与 env `OPENAI_API_KEY` 均未泄漏 |
| 3 | 适配器 `CODEX_CONFIG` 带 gg 配置，`session/new` | 注入胜 |
| 4 | 同上，`session/resume`，**不设** `MODEL_PROVIDER` | **诱饵胜**（`Bearer decoy-token`，模型是 gg 的）→ 泄漏 |
| 5 | 同上，`MODEL_PROVIDER=gg` | 注入胜 ✅ |

注意：第三方供应商下 ACP 返回的模型列表仍是 OpenAI 内置目录，§4.4「模型目录」须用供应商声明的 `models`/探测结果。无需隔离 `CODEX_HOME`。

**选定**：`CODEX_CONFIG` 并入 gg 配置＋`MODEL_PROVIDER=gg`＋`GG_PROVIDER_KEY`（见 §4.4）。

### 10.3 托管安装

`npm i -g --prefix <dir> --registry https://registry.npmmirror.com <pkg>@latest`：

| 包 | 版本 | 冷缓存耗时 | 安装体积 | `bin` |
|---|---|---|---|---|
| `@anthropic-ai/claude-code` | 2.1.285 | 9s | 214M | `bin/claude` → `claude.exe`（Mach-O 原生），`--version` 正常 |
| `@openai/codex` | 0.159.2 | 10s | 328M | `bin/codex` → `codex.js`（`#!/usr/bin/env node`），`--version` 正常 |

- claude：`postinstall`（`install.cjs`）按平台（含 linux musl 探测）从 `optionalDependencies` 的 `@anthropic-ai/claude-code-<platform>` 把原生二进制硬链（失败则复制）到 `bin/claude.exe`，运行时不需要 Node。**不能加 `--ignore-scripts` / `--omit=optional`**，否则只剩提示桩。
- codex：原生二进制在 `node_modules/@openai/codex-<platform>/vendor/<triple>/bin/codex`（npm 别名 `@openai/codex@<ver>-<platform>`），入口是 Node 脚本 → 启动 codex / codex-acp 时 PATH 必须能找到 Node：daemon 用托管 Node 时要把其 `bin` 前置到 adapter 的 PATH。
- 未验证：Windows `.cmd`、Linux musl（留到 S1 CI）。

### 10.4 会话 id

- 查锁定供应商的键：`run.start.resumeSessionId`（Rust `RunStart.resume_session_id`）；`null` 表示服务端要求开新会话，原因在 `newSessionReason`。
- daemon 自行开新会话：在 `session.rs` `Conversation::turn` 里不去 resume（传 `None` 给 `open`），完成时经 `run.done.sessionId` ＋ `run.done.newSessionReason="provider_removed"` 上报；服务端 `runs/engine.ts` 无条件把二者写入 `runs.newSessionReason` 与 `groupBots.sessionId`，协议无需改动。
- 实施要点（均已落地）：
  - 这种情况下要像 `resume_failed` 一样改用 `prompt.fallbackContext`，因为 `context` 只含上次 @ 之后的消息；
  - Web `TimelineItems.tsx` 的 `NEW_SESSION` 补上 `provider_removed` 文案（否则直接显示原因码）；
  - 新会话的 id 在 `session/new` 返回后才知道，此时写 `sessions[id]`，再发 prompt；
  - 同一会话若仍在内存（`self.session == wanted`）会跳过 `open`，所以供应商 `revision` 变化时必须重启 adapter，才能带上新的 settings/env。

## 11. 实施状态与遗留（2026-09-30）

已实现：S0–S6。daemon 新增 `tools.rs`、`providers.rs`、`ccswitch.rs`、`inject.rs`、`manage.rs`、`provider_cli.rs`；预设由 `scripts/sync-provider-presets.mjs` 生成（claude 31、codex 25）；server `modules/providers`、`machines/relay.ts`、`tools.ts`、`GET /api/bots/:id/catalog`；Web 机器详情两个页签、Bot 供应商、群聊横条；桌面 Agent/Bot/设置页；e2e `e2e/providers.spec.ts`。

遗留

- 各工具的自动升级开关与空闲调度；claude/codex「先装新目录、空闲再切换」（当前 npm 原地替换）。
- 旧的 `runtime/node-v*` 目录不回收。
- Bot 解绑或删除后，`providers.json` 里的覆盖项与会话锁定不清理（无害，但会残留）。
- 用户在本机 CLI/桌面改供应商后，横条状态要等下一轮结束或重连才更新。
- 第三方供应商的模型目录只取声明值，未实时探测；第三方模型不提供推理强度选项。
- Windows、Linux musl 路径未实测（musl 下托管 Node 会拒绝安装）。
- 与本需求无关：`e2e/m1-walking-skeleton.spec.ts` 已因界面变化失败（找不到「名称」输入框），它是 first-run 依赖，导致全套 e2e 起不来；`pnpm e2e -- <spec>` 不按文件过滤，单跑请用 `pnpm exec playwright test -c e2e <spec> --no-deps`。
