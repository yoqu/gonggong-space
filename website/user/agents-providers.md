# Agent 工具与供应商

本页讲在网页上管理一台机器的 Agent：安装升级 Node.js 与各 Agent 工具、登录官方账号、配置第三方模型供应商，以及 Claude Code 的 Agent 设置。

入口：左侧导航栏「机器与 Bot」→ 点一台机器 →「Agent 与供应商」页签（机器页的其他页签见 [我的机器与 Bot](/user/machines)）。

::: tip 使用条件
- 只有机器主人能看到这一页。
- 机器必须在线。这些设置只保存在机器上，离线时提示「供应商、Agent 工具与 Agent 设置只保存在机器上，机器上线后才能查看和修改」。
- 机器上的 daemon 版本太旧时，提示「请先升级该机器的 daemon」。
:::

同样的功能在桌面端「Agent 工具」页和命令行 `gg agents`、`gg provider` 里也有，见 [桌面端功能页面](/desktop/pages) 和 [命令参考](/cli/reference)。

## 支持的 Agent

| Agent | 说明 |
| --- | --- |
| Claude Code | Anthropic |
| Codex | OpenAI |
| Gemini CLI | Google |
| CodeBuddy（WorkBuddy） | 腾讯 |
| pi | Earendil；用它自己的登录，不使用共工空间的供应商 |
| DeepSeek Harness | 深度求索；需要 Node.js ≥ 24.9 |
| Antigravity CLI | Google 的 `agy`；用它自己的 Google 账号登录，不使用共工空间的供应商。不在 npm 上，共工空间不能托管安装，请在机器的终端运行 `curl -fsSL https://antigravity.google/cli/install.sh \| bash` |

Gemini CLI、CodeBuddy、pi、DeepSeek Harness、Antigravity CLI 以内置 Agent 插件的形式提供，不需要另外安装插件，机器上装好对应的 CLI 即可。机器上的客户端版本较旧时，页面上不会出现后来新增的 Agent，升级 daemon 后才有。

## 页面结构

![Agent 与供应商](/screenshots/web/machine-tools.webp)

页面最上方是「运行环境」里的 **Node.js**：运行 ACP 适配器与不需适配器的 Agent（Gemini CLI、CodeBuddy 等），托管安装 Agent 工具也用它，需要 22 或更高版本。

下面每个 Agent 一张卡片，从上到下依次是：

1. 工具本身：安装状态、来源、最新版本、安装 / 升级按钮；
2. 「供应商」：这台机器上这个 Agent 用哪个模型服务；
3. 「Agent 设置」（仅 Claude Code）：这台机器上所有 Bot 的默认设置。

## 安装与升级

工具名旁的标签表示状态：「未安装」、「已安装 x.y.z」，或 Node.js 版本不够时的「版本过低 x.y.z」。已安装的工具还显示：

- **来源**：「共工空间托管」（由共工空间安装）或「自行安装」（你自己装的）；
- **最新版本**：有新版本时标「有更新」；获取不到时显示「无法获取，请检查镜像源」。

右侧按钮随状态变化：

- **安装**：工具未安装，或 Node.js 版本过低时出现；
- **升级到 x.y.z**：有新版本、且共工空间知道怎么升级时出现。共工空间托管的直接升级；自己装的（如 brew、npm 安装）按原来的安装方式升级，页面同时显示「升级命令」，也可以在机器终端里自己运行。按原方式升级失败时，可以点「改用共工空间托管安装」。

点击后卡片下方展开安装日志，实时显示机器上的输出，结束时显示「安装完成」或「安装失败」。同一台机器一次只能进行一个安装或升级。

::: tip
共工空间不会修改你本机 `~/.claude/`、`~/.codex/` 等用户级配置。
:::

### 镜像源

安装、升级 Node.js 与 Agent 工具时从哪里下载，在机器页「诊断」页签的「镜像源」里设置：

| 选项 | 说明 |
| --- | --- |
| 淘宝镜像（npmmirror） | 国内下载快 |
| 官方源 | npm 官方源和 Node.js 官网 |
| 自定义 | 填写「npm registry」和「Node.js 下载地址」（`index.json` 所在的目录） |

镜像源是机器级设置，保存在这台机器上。

## 登录官方账号

每个 Agent 的「供应商」列表第一项是「官方登录」：使用这台机器上 CLI 自己的登录与配置。要在机器上登录官方账号，点它旁边的「登录…」，按对话框提示操作：

1. 打开该机器的终端：机器在线且是 macOS / Linux 时，直接点「打开终端」在网页里开一个终端；Docker 机器用 `docker compose exec daemon bash`。
2. 运行对话框给出的命令，再按提示登录：

| Agent | 命令 | 之后 |
| --- | --- | --- |
| Claude Code | `claude` | 输入 `/login`，按提示在浏览器里完成登录 |
| Codex | `codex login --device-auth` | 打开它给出的链接，输入验证码 |
| Gemini CLI | `gemini` | 输入 `/auth`，选择 Gemini API Key 并粘贴 Key |
| CodeBuddy | `codebuddy` | 输入 `/login`，用微信、Google/GitHub 或企业账号登录 |
| pi | `pi` | 输入 `/login`，选择供应商登录或填写 API Key |
| DeepSeek Harness | `dsh web` | 在打开的网页「模型」里填写 DeepSeek API Key（也可以在机器环境变量里设置 `DEEPSEEK_API_KEY`） |
| Antigravity CLI | `agy` | 按提示用 Google 账号登录；机器没有浏览器时运行 `agy acp --login`，在别处打开链接后粘贴授权码 |

登录信息只保存在该机器上。不想登录官方账号，可以点「改用 API Key 供应商」新增一个第三方供应商。

「官方登录」旁的「设置…」可以给官方登录附加「代理地址」「环境变量」，Claude Code 还可以附加「命令行参数」（见下文）。

## 供应商

「供应商」指 Agent 调用模型用的服务：可以是「官方登录」，也可以是第三方服务（Base URL + API Key + 模型）。pi 不使用这里的供应商，它沿用自己的登录。

![供应商列表](/screenshots/web/machine-providers.webp)

::: warning 供应商只保存在机器本地
供应商的名称、Base URL、API Key、模型和绑定关系**只保存在这台机器上**，不会上传服务器，也不会出现在服务器的数据库、日志或审计里。网页只是经服务器实时读写机器上的配置。每台机器各自一份。
:::

列表里**选中的一项是这台机器的默认供应商**，新会话使用它；点单选框即可切换。每行列出 Base URL、模型和打码后的 Key。

### 新增供应商

1. 点「新增…」。
2. 先选厂商：内置预设分为「国内厂商」「聚合平台」「海外」，可以搜索；找不到就选「自定义」，手动填写 Base URL。
3. 填写表单，点「保存」。

![供应商编辑表单](/screenshots/web/provider-editor.webp)

| 字段 | 说明 |
| --- | --- |
| 厂商 | 选好的预设，可点「更换…」重选 |
| 名称 | 列表里显示的名字 |
| 协议 | 由 Agent 决定，供应商需提供这种接口：Claude Code 与 DeepSeek Harness 为 Anthropic Messages，Codex 为 OpenAI Responses，Gemini CLI 为 Google Gemini，CodeBuddy 为 CodeBuddy |
| Base URL | 选了预设时自动填好（在「高级」里可改）；自定义时必填 |
| API Key | 必填，只保存在这台机器上；预设提供「获取 Key」链接。DeepSeek Harness 在这里填 DeepSeek API Key |
| 模型 | 可从列表选择，也可直接输入；留空用默认 |
| 设为该机器默认 | 勾选后保存即切换为本机默认 |

展开「高级」还可以设置：

- 「Haiku 模型」「Sonnet 模型」「Opus 模型」的映射（仅 Claude Code）；
- 上下文与请求参数（仅 Claude Code）：上下文窗口、自动压缩窗口、输出上限、关闭思考参数、关闭实验性 beta、工具搜索、API 超时；选了预设时显示「预设：…」，改过的可点「恢复预设」；
- 「代理地址」：Agent 经此代理访问供应商，留空为直连；
- 「命令行参数」（仅 Claude Code）：见下文；
- 「环境变量」：启动 Agent 时附加，每行一个 `KEY=VALUE`。

编辑已有供应商时，API Key 留空表示保留已保存的 Key；选过预设的供应商可以点「恢复为预设值」。

### 命令行参数（Claude Code）

Claude Code 的「官方登录」和所有供应商都可以填写「命令行参数」，启动 Claude Code 时附加，每行一个，例如：

```text
--settings ~/team.json
```

`--settings` 会合并进共工空间生成的设置，冲突时以共工空间管理的项为准；共工空间管理的参数（权限、模型、会话、MCP 等）不能在这里设置。

### 使用本机 Claude 配置目录

Claude Code 供应商可以复用这台机器上另一个已经配好的 Claude 配置目录（`CLAUDE_CONFIG_DIR`），沿用目录自己的登录与 `settings.json`，不需要 API Key。

1. 点「新增…」，在厂商列表底部选「该机器 Claude 配置目录」。
2. 「配置目录」：从列表选择主目录下的 `.claude*` 目录，或点「浏览…」选择（可进入隐藏目录），也可以直接填绝对路径；名称默认取目录名。
3. 「Claude 可执行文件」：可选，留空使用该机器的 Agent 路径。
4. 点「保存」。

例如已有一套单独的配置在 `/Users/wanglei/.claude-work`，就填这个路径。共工空间只保存路径，不复制里面的密钥；Claude 运行时仍会在该目录写入会话等数据。模型映射由目录自己的设置决定，「高级」里只有代理、命令行参数与环境变量。

### 导入

- **从 CC Switch 导入…**：这台机器上用 CC Switch 管理过供应商时出现。列出可用的供应商（Key 打码），已存在的标「将更新已有项」，CC Switch 正在用的标「CC Switch 当前」。勾选要导入的项，可勾选「将 CC Switch 当前使用的设为该机器默认」，点「导入」。只读取 CC Switch 的配置，不会修改它。
- **粘贴链接导入…**：粘贴 CC Switch 的供应商分享链接（形如 `ccswitch://v1/import?resource=provider&app=claude&…`），可选「设为该机器默认」，点「导入」。

### 删除供应商

点供应商旁的「删除」。如果它是本机默认，删除后改为「官方登录」；单独设置为它的 Bot 改为继承本机默认；正在使用它的会话下一轮会自动开启新会话。

## Agent 设置（Claude Code）

Claude Code 卡片底部的「Agent 设置」是这台机器上所有 Bot 的默认设置，改动立即保存，下一轮生效：

- 语言、扩展思考、提交署名（这三项 Bot 可以单独覆盖，见 [Bot 设置与权限](/user/bot-settings#agent-设置)）；
- 内置 git 指令、自动记忆、自动压缩、Bash 默认超时、Bash 最长超时、关闭非必要流量。

每项下方注明当前值的来源：「默认」「该机器 CLI」或「机器设置」，以及哪些 Bot 做了覆盖。

**继承该机器 CLI 配置**：打开时，同时加载这台机器上 Claude Code 自己的用户配置（会显示有多少 hooks 和权限规则随继承一起生效）；关闭后，个人 `CLAUDE.md`、记忆、hooks 和用户 Skill 都不再加载。无论是否继承，权限、模型、MCP、插件与密钥都由共工空间统一管理，该机器 CLI 中的同名设置不生效。

## Bot 选用哪个供应商

每个 Bot 默认**继承机器**的默认供应商，也可以单独指定。在 Bot 详情「运行配置」页签的「供应商」里选择：

- 「继承机器（当前：…）」；
- 「官方登录」；
- 这台机器上同一 Agent 的某个供应商。

只有 Bot 主人在自己的机器上、且机器在线时才能修改。选了第三方供应商后，「模型」列表换成该供应商的模型。详见 [Bot 设置与权限](/user/bot-settings#供应商)。

## 切换不影响进行中的会话

无论切换本机默认还是 Bot 的供应商，**进行中的会话都继续用原来的供应商**，开启新会话后才切换。

- 切换时如果有群的会话还在用旧供应商，会先弹窗确认「要让新会话改用 … 吗？」，列出「N 个群的会话仍在使用 X，开启新会话后才会切换到 Y」。
- 在这些群里，输入框上方会出现提示，点「开启新会话」即可立即切换，效果等同在群里发送 `/new @Bot名`（见 [指令参考](/user/commands)）。

## 相关页面

- [我的机器与 Bot](/user/machines)
- [绑定机器](/user/bind-machine)
- [Bot 设置与权限](/user/bot-settings)
- [桌面端功能页面](/desktop/pages)
- [命令参考](/cli/reference)
