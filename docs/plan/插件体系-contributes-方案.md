# 插件扩展点（contributes）方案

> 状态：已定稿（2026-11-11，姜维川）；S0 已完成（实测 Claude 会执行插件 `hooks/` 里的钩子，口子属实）；S1 已完成（与本文的出入见 §11.1），其余每期开工前另行确认。前置文档：`插件体系-方案.md`、`Skill市场-PRD.md`、`Agent工具与供应商统一管理-设计.md`。
> 本文只定「插件能扩展什么、怎么声明、怎么下发、怎么管住」。数字来自对 `main`（`de3d202a` 附近）的只读代码调研。

## 1. 问题与结论

- 现在的插件是真的（会下载、落盘、被 Agent 读到），但只有一个扩展点：skill 内容 + 创作面板配置。清单 `gonggong-plugin.json` 没有 mcp、agent、command、tab 字段。
- 能改变系统行为的东西全部写死在核心里：
  - Agent：6 种都走 ACP，但 `AgentKind` 是封闭枚举，按 kind 分支约 90 处、散在 30 多个文件。新增 pi 和 DeepSeek Harness 改了 39 个文件，还要发客户端。
  - MCP 工具：57 个，编译期静态表（`packages/protocol/src/tools.ts`，daemon 用 `include_str!` 打包）。
  - 供应商预设：61 条纯数据，编进 daemon 二进制。
  - 工作台 Tab：15 种封闭枚举。斜杠命令：注册表只放系统内置命令。
- 结论：市场、版本、审核、安装链路都沿用，**只给清单加 `contributes`**，开放 5 个扩展点。不做服务端插件代码，不做主站前端代码注入。

## 2. 目标与非目标

目标：

1. 用户（或 Bot）能写一个插件，装上后多出一种 Agent、一组 MCP 工具、几条供应商预设、斜杠命令或工作台 Tab，**不用改核心代码，不用发客户端**。
2. 后加的 4 种 Agent（Gemini、CodeBuddy、pi、DeepSeek Harness）改用同一套清单内置，证明清单够用。
3. 会执行代码的插件有明确的授权和固定版本，不能绕过审批和权限档位。

非目标：

- 不拆飞书、Git、终端、预览/隧道/投屏、知识库、定时任务、微信开发者工具。它们是核心域或依赖 daemon 进程级能力，拆出去只多一层间接。飞书只建议以后做依赖反转（核心发事件、飞书订阅），与本方案无关。
- Claude、Codex 的适配保留代码内置（设置层、内置审核、cc-switch 导入等专属逻辑最多）。
- 不做插件签名、插件间依赖、服务端事件 hook、消息内新组件类型（插件统一走 `html-page`）。

## 3. 清单改动

```jsonc
{
  "name": "deepseek-harness",
  "version": "1.0.0",
  "title": "DeepSeek Harness",
  "description": "…",
  "category": "agent",            // 新增 agent、tool 两个取值
  "minDaemon": "0.5.0",
  "entry": "…",                   // 改为可选：没有 skill 的插件不填
  "permissions": ["exec"],        // 新增，见 §9
  "contributes": {                // 新增，五项都可选
    "mcp": [],
    "agents": [],
    "providers": [],
    "commands": [],
    "tabs": []
  }
}
```

- `agents`（支持哪些 Agent）字段保留，取值从枚举放宽为 Agent id 字符串。
- 兼容：旧清单不带 `contributes` 和 `permissions`，行为不变。旧 daemon 不认识新字段，服务端按能力标志决定是否下发（§10）。

### 3.1 目录约定与路径白名单（先做）

现状有个口子：服务端只校验路径合法和总大小，插件里多带 `hooks/`、`.mcp.json`、`commands/`、`agents/` 时不拦，而 daemon 把整个目录当 Claude 本地插件加载。这是一条没设计过的代码执行通道（只读了代码，未实测是否生效，S0 先实测）。

改为白名单，其余路径上传时拒绝：

| 路径 | 用途 |
|---|---|
| `gonggong-plugin.json`、`README.md`、`LICENSE` | 清单与说明 |
| `skills/**` | 现有 skill、设计系统、kit |
| `contrib/mcp/**` | MCP 服务脚本 |
| `contrib/agents/**` | Agent 适配器的脚本、模板、图标 |
| `contrib/tabs/**` | Tab 静态页面 |
| `assets/**` | 图片等静态资源 |

扩展内容统一放 `contrib/`，是为了避开 Claude 插件目录的保留名（`agents/`、`commands/`、`hooks/`）。daemon 生成给 Claude 的插件视图只暴露 `skills/`。

## 4. 扩展点一：MCP 工具（`contributes.mcp`）

```jsonc
{
  "name": "tracker",                         // 下发名 <插件名>.<name>
  "transport": "stdio",                      // stdio | http
  "command": ["{node}", "{pkg}/contrib/mcp/server.mjs"],
  "npm": "some-mcp-server@1.4.2",            // 可选：固定版本的 npm 包，代替随包脚本
  "env": { "TRACKER_TOKEN": "{secret:TRACKER_TOKEN}" },
  "url": null, "headers": {}                 // http 时用
}
```

- **不建新表**。服务端在 `run.start` 时从「本群生效的安装 + 清单」算出 MCP 列表，作为三层 MCP（平台/团队/群）之外的第四个来源合并下发。群管理员用现有的 `group_mcp_overrides` 按名关闭。
- **运行位置**：stdio 服务跑在执行机器上，工作目录是插件解包目录，用托管 Node。http 服务只下发地址和请求头。
- **依赖**：推荐打成单文件脚本随包。用 `npm` 时必须写确切版本，daemon 装到该插件版本自己的目录，`--ignore-scripts`。
- **密钥**：`{secret:NAME}` 复用清单 `secrets` 和团队密钥，缺密钥这一轮不下发该插件（现有行为）。
- **各 Agent 的注入**不用改：Claude、Codex、CodeBuddy、DeepSeek 走 ACP 会话，Gemini 写 settings，pi 走扩展，它们消费的都是合并后的列表。
- **审批**：MCP 工具调用仍走各 Agent 现有的审批，插件不能给自己的工具免审。
- 内置迁移：`client_release_publish`、`client_release_notes` 只有共工自己发版用，迁成私有 MCP 插件，从公共工具表里拿掉。

## 5. 扩展点二：Agent 适配器（`contributes.agents`）

这是「像 DeepSeek Harness 那样按需定制安装」的核心。分两层：能声明的全部声明，声明不了的放一个启动脚本。

### 5.1 声明层

以 DeepSeek Harness 为例（字段对应现在散落的 `match kind`）：

```jsonc
{
  "id": "deepseek",
  "title": "DeepSeek Harness", "vendor": "DeepSeek", "icon": "contrib/agents/deepseek.svg",
  "install": {
    "npm": "@deepseek-ai/dsh", "bin": "dsh", "script": "lib/bin.js",
    "minVersion": "0.9.0", "minNode": "24.9.0", "brew": null
  },
  "acp": { "kind": "native", "args": ["--profile", "acp"] },
  "chdir": true,
  "systemPrompt": {
    "via": "file",
    "template": "contrib/agents/persona.yml.tpl",
    "args": ["--patch", "{file}"]
  },
  "mcp": { "via": "acp" },
  "skills": { "via": "link", "dirs": [".agents/skills"] },
  "tiers": {
    "full":      { "env": { "DSH_PERMISSION_MODE": "danger-full-access" } },
    "workspace": { "env": { "DSH_PERMISSION_MODE": "workspace-write" } },
    "readonly":  { "env": { "DSH_PERMISSION_MODE": "read-only" } },
    "restartOnChange": true
  },
  "provider": {
    "accepts": true, "protocol": "anthropic",
    "env": { "apiKey": "DEEPSEEK_API_KEY", "baseUrl": "DEEPSEEK_BASE_URL", "model": null }
  },
  "login": {
    "check": { "env": "DEEPSEEK_API_KEY" },
    "command": "dsh login", "hint": "…"
  },
  "home": { "env": "DSH_HOME" },
  "env": {},
  "launchScript": null
}
```

各字段的可选策略（封闭集合，daemon 逐一实现）：

| 字段 | 取值 | 现有对应 |
|---|---|---|
| `acp.kind` | `native`（CLI 自己说 ACP，带 `args`）；`adapter`（固定版本的适配器 npm 包，`cliEnv` 指明用哪个环境变量把 CLI 路径交给它） | Gemini/CodeBuddy/DeepSeek；Claude/Codex/pi |
| `systemPrompt.via` | `acp-meta`、`arg`、`env`、`file`（按模板写文件再用参数或环境变量指过去） | Claude；CodeBuddy；pi；DeepSeek、Gemini |
| `mcp.via` | `acp`、`env`（JSON 放环境变量）、`file` | 多数；pi；Gemini |
| `skills.via` | `link`（软链到 `dirs`）、`arg`（`--plugin-dir` 类参数） | Codex/Gemini/pi/DeepSeek；CodeBuddy |
| `tiers` | 每档给 `env` 或 `mode`（ACP 会话模式）；整体为 `null` 表示 Agent 自己不管权限，由共工规则审批 | DeepSeek；Claude/Codex；pi |
| `login.check` | `env`、`file`（文件存在）、`command`（退出码为 0） | 各家登录探测 |
| `provider.accepts` | `false` 表示沿用 Agent 自己的登录，不接供应商 | pi |

模板变量：`{prompt}`、`{file}`、`{cwd}`、`{pkg}`（插件解包目录）、`{state}`（该 Bot 的状态目录）、`{node}`、`{cli}`、`{mcpJson}`、`{secret:NAME}`。

模型列表不用声明，沿用 ACP 探测到的 catalog。

### 5.2 脚本层（逃生口）

声明表达不了时，`launchScript` 指向随包的 Node 脚本（跑在托管 Node 上），每次启动 Agent 进程前执行一次：

- 输入（stdin，JSON）：Bot 信息、档位、系统提示词、MCP 列表、cwd、状态目录、供应商。
- 输出（stdout，JSON）：追加的 `env`、`args`，以及要写入状态目录的文件。
- 超时 10 秒，失败则这一轮报错，不兜底。

Agent 侧的扩展文件（如现在的 `pi_extension.ts`）直接放在 `contrib/agents/` 下，用 `{pkg}` 引用。

审批请求不走脚本。现在 pi 扩展发审批请求、daemon 用 `pi::own_request` 识别，把这个约定公开成通用格式：任何适配器的扩展都可以按同一格式发「共工审批请求」，daemon 统一按 Bot 档位和命令审批规则处理。Gemini 那种「没有 raw_input、拿标题当命令」的差异用声明字段 `permission.commandFrom: "rawInput" | "title"` 表达。

### 5.3 Agent 身份

- `AgentKind` 从封闭枚举改为字符串 id。内置 6 个 id 保留；插件贡献的 id 为 `<插件名>.<id>`，不会与内置重名。
- Rust 侧改为「id + 适配器注册表」：Claude、Codex 是代码实现的适配器，其余是清单适配器。`ToolKind`（托管安装）同样改为按 `install` 字段驱动。
- 界面的名称、厂商、图标、登录说明改为读 daemon 上报的 `AgentInfo`（新增 `title`、`vendor`、`icon`、`login`、`source`），内置的保留本地词条做翻译。

### 5.4 安装与下发

- Agent 适配器装到**机器**上：安装范围新增 `machine`，由机器主人操作（有数据库迁移）。
- daemon 连接后同步本机的适配器安装（新消息 `adapters.sync`），下载、解包、按 `install` 用托管 Node 装 CLI，然后和内置 Agent 一起探测并在握手里上报。
- 服务端调度：Bot 的 Agent id 不在目标机器上报的列表里，就置 `offline_wait` 并写明原因。去掉 `LATER_AGENTS` 和每个 Agent 一个的 feature 常量。
- 创建 Bot 时，可选的 Agent 来自所选机器上报的列表。

### 5.5 内置迁移（验证清单够不够用）

把 Gemini、CodeBuddy、pi、DeepSeek Harness 写成 4 份内置清单（放 `crates/gonggong/adapters/`，编进二进制，与插件贡献的走同一段代码）。验收标准：这 4 个 Agent 在 `engine.rs`、`session.rs`、`turn.rs`、`agents.rs`、`tools.rs` 里的专属分支删光，现有集成测试（`tests/it/native_agents.rs` 等）全绿。

预期难点，迁移时逐个确认：

- Gemini：每个（群，Bot）一个 home，要写 `GEMINI.md` 和 `settings.json`，大概率要用 `launchScript`。
- pi：wrapper 脚本加扩展，属于脚本层。
- cc-switch 导入、Claude 专属的 Agent 设置项不在清单范围内，保持现状。

**这 4 个迁不动的地方就是清单要补的地方。四个都迁完之前，不向用户开放自定义 Agent。**

## 6. 扩展点三：供应商预设（`contributes.providers`）

- 条目格式沿用 `crates/gonggong/presets/providers.json` 现有字段（`baseUrl`、`apiKeyField`、`model`、`models`、`env`、`wireApi` 等），多一个 `agent` 指明给哪个 Agent 用。
- 二进制里的预设保留作底，插件贡献的按 id 追加或覆盖。
- 官方预设做成一个内置插件（`apps/server/plugins/official/provider-presets`）。以后更新预设只要部署服务端，不用发客户端。
- Agent 适配器自带的预设直接写在 `contributes.providers` 里。

## 7. 扩展点四：斜杠命令（`contributes.commands`）

```jsonc
{ "name": "standup", "title": "站会小结", "description": "…", "skill": "standup", "prompt": "按本群今天的消息写站会小结：{args}" }
```

- 纯声明：命令出现在 `/` 候选的「插件」分组，选中后等价于发一条调用该 skill 的消息。
- 服务端命令注册表合并「本群生效的插件命令」，与系统命令重名时系统命令优先，上传时就拒绝重名。

## 8. 扩展点五：工作台 Tab（`contributes.tabs`）

```jsonc
{ "id": "board", "title": "看板", "icon": "assets/board.svg", "entry": "contrib/tabs/board/index.html" }
```

- 页面是插件里的静态文件，由服务端放在独立预览域名下托管（沿用产物托管的隔离域名），在工作台里用现有 `LinkTab` 的沙箱 iframe 展示。主站不执行插件的任何脚本。
- `GroupTabTarget` 新增 `plugin` 一种；`tab_create` 工具可以创建它。
- 第一版只给页面一个只读上下文（群 id、语言、主题，经 `postMessage`，双方校验 origin）和一个动作「把一段文字填进输入框」（由用户自己发送）。页面要数据，自己连插件的 http 服务。不发放任何平台凭据。

## 9. 权限与信任

清单 `permissions` 声明，安装界面和审核界面逐项列出：

| 权限 | 触发条件 | 含义 |
|---|---|---|
| `exec` | 有 stdio MCP、Agent 适配器或 `launchScript` | 在执行机器上运行插件带的代码或它指定的 npm 包 |
| `network` | 有 http MCP | 把工具调用发到声明的地址 |
| `ui` | 有 Tab | 在工作台里显示插件页面 |
| （已有）`secrets` | 清单 `secrets` | 读取指定名字的团队密钥 |

清单内容与声明不符（例如有 stdio MCP 却没写 `exec`）上传时拒绝。

带 `exec` 的插件多四条规则：

1. **机器主人确认**：第一次要在某台机器上运行时，给机器主人发确认卡片，写明插件、版本和会运行什么。确认绑定内容摘要（digest），插件出新版本要重新确认。
2. **必须固定版本**：不能「跟随最新」。npm 依赖必须写确切版本，安装带 `--ignore-scripts`。
3. **审核**：公开条目必须过系统管理员审核（沿用现有审核流），审核页的差异视图要显示 `contrib/` 下的文件。第一阶段建议带 `exec` 的插件只允许团队内可见。
4. **单独的总开关**：新增系统参数 `pluginCodeEnabled`，默认关闭，与现有 `pluginsEnabled` 分开。

不变的底线：插件不能提高 Bot 的权限档位；工具调用和命令执行照常走审批；插件拿不到平台会话凭据。

## 10. 协议、数据库与兼容

| 位置 | 改动 |
|---|---|
| `packages/protocol/src/plugins.ts` | `contributes`、`permissions`；`entry` 可选；`category` 加 `agent`、`tool` |
| `packages/protocol/src/common.ts`、`daemon.ts` | `AgentKind` 改字符串；`AgentInfo` 加展示与来源字段；新消息 `adapters.sync`；`PluginRef` 带 MCP 声明；同步 fixture 与 `protocol.rs` |
| 能力标志 | 新增 `plugin-mcp`、`agent-adapters`、`plugin-tabs`。机器没有对应标志就不下发，界面写「机器版本过低」（现有做法） |
| 数据库 | `installs` 加 `machine` 范围和机器确认记录；`GroupTabTarget` 加 `plugin`。只新增，可回滚 |
| 市场工具 | `market_install` 加机器目标；`market_get` 显示权限声明。发布类工具不用改 |

旧客户端：不带新能力标志，收不到新内容，行为与现在一致。Agent id 改字符串后，旧服务端与新 daemon 的组合要在 fixture 里覆盖（内置 6 个 id 的字面量不变）。

## 11. 分期

| 期 | 内容 | 涉及端 | 迁移 | 验收 |
|---|---|---|---|---|
| S0 | 实测 §3.1 的口子；上传改路径白名单；daemon 给 Claude 的视图只含 `skills/` | 服务端、daemon | 无 | 带 `hooks/` 的包上传被拒；存量插件照常可用 |
| S1 | `contributes.mcp`、`permissions`、机器主人确认、`pluginCodeEnabled`；`client_release_*` 迁成插件 | 协议、服务端、daemon、Web | 有 | 装一个示例 MCP 插件，6 种 Agent 都能调到它的工具；未确认的机器不运行 |
| S2 | 供应商预设插件化、斜杠命令 | 服务端、daemon、Web | 无 | 改官方预设不发客户端即可生效 |
| S3 | Agent 适配器内核：清单 schema、适配器注册表、4 个内置 Agent 迁移 | 协议、daemon、服务端、Web、桌面 | 无 | §5.5 的验收标准 |
| S4 | 开放自定义 Agent：机器级安装、`adapters.sync`、去掉 `LATER_AGENTS`、界面读上报信息 | 全部 | 有 | 用一个没接过的 ACP Agent 做成插件，从上传到跑通一轮，核心代码零改动 |
| S5 | 工作台 Tab | 协议、服务端、Web | 有 | 示例看板插件在群里可见，页面拿不到主站 cookie |

S1、S3、S4 都要发客户端。S1、S4、S5 有数据库迁移。按约定每期开工前确认。

### 11.1 S1 落地与本文的出入（2026-11-11）

- MCP 下发名用 `<插件名>-<name>`（不用点号，Agent 的工具名不认点号）；密钥引用沿用现有写法 `${secret:NAME}`，可嵌在值中间，名字必须在清单 `secrets` 里。
- ACP 的 stdio 服务没有工作目录字段，插件脚本一律用 `{pkg}/…` 绝对路径引用；上传时校验 `command` 里 `{pkg}/` 开头的文件存在。
- `permissions` 必须与 `contributes` 推出的权限完全一致（stdio → `exec`，http → `network`）。只有 `exec` 需要机器主人授权；纯 http 插件不需要。
- 授权按（机器，插件版本）记在 `plugin_trusts`：首次用到时给机器主人发 `plugin_trust` 通知，在「我的机器 → 插件授权」允许、拒绝或撤销；拒绝后不再追问，撤销后下一轮重新请求。
- 市场：带 `exec` 的插件不能公开（上传、预检、改可见范围都拦），引入时必须固定版本。平台/团队/群层直接上传的插件仍跟随最新，靠「新版本要重新授权」兜住。
- 能力标志叫 `pluginMcp`。旧 daemon 上，带 MCP 的插件显示「机器版本过低」，不下发。
- 未做：`npm` 字段（daemon 按插件装 npm 包）；`client_release_*` 迁成私有插件——插件拿不到平台凭据，而这两个工具要调发版接口，需另行设计。

## 12. 风险

- **清单覆盖度未验证**：声明层加脚本层能否装下 pi、Gemini 这类复杂适配，目前是设计判断，要靠 S3 的迁移证明。
- **安全面扩大**：`exec` 插件等于在用户机器上跑第三方代码。没有签名，靠摘要固定、机器主人确认和审核三道。
- **S3 是大重构**：动 daemon 的会话与启动主路径。要求先有测试保护，逐个 Agent 迁，每迁一个跑一次全量。
- **上游变化**：适配器包（如 `pi-acp@0.0.34`）还是早期版本，清单里固定版本，升级由插件作者发新版本。

## 13. 已定决策（2026-11-11，姜维川）

1. 自定义 Agent 装到机器后，只有机器主人的 Bot 能用。
2. 带 `exec` 的插件第一阶段不允许公开上架，只在团队内可见。
3. S2 不依赖 S3，可以提前或并行。
