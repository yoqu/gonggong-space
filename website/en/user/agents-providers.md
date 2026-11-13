# Agent tools and providers

This page covers how to manage a machine's Agents from the web: installing and upgrading Node.js and each Agent tool, logging in to official accounts, configuring third-party model providers, and Claude Code's Agent settings.

Where to find it: 「机器与 Bot」 (Machines & Bots) in the left navigation bar → click a machine → the 「Agent 与供应商」 (Agents & providers) tab (for the machine page's other tabs, see [My machines and Bots](/en/user/machines)).

::: tip Requirements
- Only the machine owner can see this page.
- The machine must be online. These settings are stored only on the machine; when it's offline you'll see 「供应商、Agent 工具与 Agent 设置只保存在机器上，机器上线后才能查看和修改」 ("Providers, agent tools and agent settings live only on the machine; view and edit them once it is online").
- If the machine's daemon is too old, you'll see 「请先升级该机器的 daemon」 ("Upgrade this machine's daemon first").
:::

The same features are available on the desktop app's 「Agent 工具」 (Agent tools) page and via the `gg agents` and `gg provider` commands — see [Desktop app pages](/en/desktop/pages) and [Command reference](/en/cli/reference).

## Supported Agents

| Agent | Description |
| --- | --- |
| Claude Code | Anthropic |
| Codex | OpenAI |
| Gemini CLI | Google |
| CodeBuddy (WorkBuddy) | Tencent |
| pi | Earendil; uses its own login, not Gonggong Space's providers |
| DeepSeek Harness | DeepSeek; requires Node.js ≥ 24.9 |

Gemini CLI, CodeBuddy, pi, and DeepSeek Harness come as built-in Agent plugins, so there's no separate plugin to install — just install the corresponding CLI on the machine. If the machine's client is older, Agents added later won't appear on the page until the daemon is upgraded.

## Page layout

![Agents & providers](/screenshots/web/machine-tools.webp)

At the top of the page is **Node.js** under 「运行环境」 (Runtime): it runs the ACP adapters and the Agents that need no adapter (Gemini CLI, CodeBuddy, etc.), and is also used for managed installs of Agent tools. It requires version 22 or later.

Below that, each Agent has a card containing, from top to bottom:

1. The tool itself: install status, source, latest version, and the install / upgrade button;
2. 「供应商」 (Provider): which model service this Agent uses on this machine;
3. 「Agent 设置」 (Agent settings) (Claude Code only): the default settings for all Bots on this machine.

## Install and upgrade

The tag next to the tool name shows its status: 「未安装」 (Not installed), 「已安装 x.y.z」 (Installed x.y.z), or 「版本过低 x.y.z」 (Too old x.y.z) when Node.js isn't recent enough. Installed tools also show:

- **Source**: 「共工空间托管」 (Managed by Gonggong Space — installed by Gonggong Space) or 「自行安装」 (Self-installed — installed by you);
- **Latest version**: marked 「有更新」 (Update available) when a newer version exists; shows 「无法获取，请检查镜像源」 ("Unavailable; check the mirror") if it can't be fetched.

The button on the right changes with the status:

- **安装 (Install)**: shown when the tool isn't installed, or when Node.js is too old;
- **升级到 x.y.z (Upgrade to x.y.z)**: shown when there's a new version and Gonggong Space knows how to upgrade it. Tools managed by Gonggong Space are upgraded directly; self-installed ones (e.g. via brew or npm) are upgraded the way they were installed, and the page also shows the 「升级命令」 (Upgrade command) so you can run it yourself in the machine's terminal. If upgrading the original way fails, you can click 「改用共工空间托管安装」 (Switch to the Gonggong Space managed install).

After clicking, an install log expands below the card showing the machine's output in real time, ending with 「安装完成」 (Installed) or 「安装失败」 (Install failed). Only one install or upgrade can run on a machine at a time.

::: tip
Gonggong Space never modifies user-level configuration on your machine such as `~/.claude/` or `~/.codex/`.
:::

### Mirror

Where Node.js and Agent tools are downloaded from when installing or upgrading is set under 「镜像源」 (Mirror) in the machine page's 「诊断」 (Diagnostics) tab:

| Option | Description |
| --- | --- |
| 淘宝镜像（npmmirror） (Taobao mirror (npmmirror)) | Fast downloads in mainland China |
| 官方源 (Official registry) | The official npm registry and the Node.js website |
| 自定义 (Custom) | Fill in 「npm registry」 and 「Node.js 下载地址」 (Node.js download URL — the directory containing `index.json`) |

The mirror is a machine-level setting stored on that machine.

## Log in to official accounts

The first entry in each Agent's 「供应商」 (Provider) list is 「官方登录」 (Official login): it uses the CLI's own login and configuration on this machine. To log in to an official account on the machine, click 「登录…」 (Log in…) next to it and follow the dialog:

1. Open a terminal on that machine: if the machine is online and runs macOS / Linux, click 「打开终端」 (Open terminal) to open one right in the web page; for a Docker machine, use `docker compose exec daemon bash`.
2. Run the command shown in the dialog, then log in as prompted:

| Agent | Command | Then |
| --- | --- | --- |
| Claude Code | `claude` | Type `/login` and finish logging in in the browser as prompted |
| Codex | `codex login --device-auth` | Open the link it gives you and enter the code |
| Gemini CLI | `gemini` | Type `/auth`, choose Gemini API Key, and paste the key |
| CodeBuddy | `codebuddy` | Type `/login` and log in with WeChat, Google/GitHub, or an enterprise account |
| pi | `pi` | Type `/login` and log in with a provider or enter an API key |
| DeepSeek Harness | `dsh web` | In the web page that opens, enter your DeepSeek API key under 「模型」 (Model) (or set `DEEPSEEK_API_KEY` in the machine's environment) |

Login information is stored only on that machine. If you'd rather not log in to an official account, click 「改用 API Key 供应商」 (Use an API key provider instead) to add a third-party provider.

「设置…」 (Settings…) next to 「官方登录」 (Official login) lets you attach a 「代理地址」 (Proxy) and 「环境变量」 (Environment variables) to the official login; for Claude Code you can also attach 「命令行参数」 (Command-line arguments) (see below).

## Providers

A "provider" is the service an Agent uses to call models: either 「官方登录」 (Official login) or a third-party service (Base URL + API Key + model). pi doesn't use these providers; it keeps its own login.

![Provider list](/screenshots/web/machine-providers.webp)

::: warning Providers are stored only on the machine
Provider names, Base URLs, API Keys, models, and bindings are **stored only on this machine**. They are never uploaded to the server and never appear in the server's database, logs, or audit log. The web page merely reads and writes the machine's configuration in real time through the server. Each machine has its own copy.
:::

**The selected entry in the list is this machine's default provider**, used by new sessions; click its radio button to switch. Each row lists the Base URL, model, and masked key.

### Add a provider

1. Click 「新增…」 (Add…).
2. Pick a vendor first. Built-in presets are grouped into 「国内厂商」 (China), 「聚合平台」 (Aggregators), and 「海外」 (International), and are searchable. If yours isn't listed, choose 「自定义」 (Custom) and enter the Base URL manually.
3. Fill in the form and click 「保存」 (Save).

![Provider edit form](/screenshots/web/provider-editor.webp)

| Field | Description |
| --- | --- |
| 厂商 (Vendor) | The selected preset; click 「更换…」 (Change…) to pick again |
| 名称 (Name) | The name shown in the list |
| 协议 (Protocol) | Determined by the Agent; the provider must offer this kind of API: Anthropic Messages for Claude Code and DeepSeek Harness, OpenAI Responses for Codex, Google Gemini for Gemini CLI, CodeBuddy for CodeBuddy |
| Base URL | Filled in automatically for presets (editable under 「高级」 (Advanced)); required for custom |
| API Key | Required, stored only on this machine; presets offer a 「获取 Key」 (Get a key) link. For DeepSeek Harness, enter your DeepSeek API key here |
| 模型 (Model) | Pick from the list or type one in; leave empty for the default |
| 设为该机器默认 (Set as machine default) | If checked, saving makes it this machine's default |

Expand 「高级」 (Advanced) for more settings:

- Mappings for 「Haiku 模型」 (Haiku model), 「Sonnet 模型」 (Sonnet model), and 「Opus 模型」 (Opus model) (Claude Code only);
- Context and request parameters (Claude Code only): context window, auto-compact window, max output, disable thinking parameter, disable experimental betas, tool search, and API timeout. When a preset is selected, 「预设：…」 ("Preset: …") is shown, and values you've changed can be reverted with 「恢复预设」 (Restore preset);
- 「代理地址」 (Proxy): the Agent reaches the provider through this proxy; leave empty for a direct connection;
- 「命令行参数」 (Command-line arguments) (Claude Code only): see below;
- 「环境变量」 (Environment variables): added when starting the Agent, one `KEY=VALUE` per line.

When editing an existing provider, leaving the API Key empty keeps the saved key; providers created from a preset can use 「恢复为预设值」 (Restore preset values).

### Command-line arguments (Claude Code)

Claude Code's 「官方登录」 (Official login) and every provider can have 「命令行参数」 (Command-line arguments), added when Claude Code starts, one per line, for example:

```text
--settings ~/team.json
```

`--settings` is merged into the settings Gonggong Space generates; on conflicts, the items Gonggong Space manages win. Arguments Gonggong Space manages (permissions, model, session, MCP, etc.) can't be set here.

### Use a local Claude configuration directory

A Claude Code provider can reuse another Claude configuration directory already set up on this machine (`CLAUDE_CONFIG_DIR`), keeping that directory's own login and `settings.json`, so no API key is needed.

1. Click 「新增…」 (Add…) and choose 「该机器 Claude 配置目录」 (Claude configuration directory on the machine) at the bottom of the vendor list.
2. 「配置目录」 (Configuration directory): pick one of the `.claude*` directories in the home directory from the list, or click 「浏览…」 (Browse…) to choose one (hidden directories can be opened), or enter an absolute path directly; the name defaults to the directory name.
3. 「Claude 可执行文件」 (Claude executable): optional; leave empty to use the machine's Agent path.
4. Click 「保存」 (Save).

For example, if you already have a separate setup at `/Users/wanglei/.claude-work`, enter that path. Gonggong Space stores only the path and doesn't copy the keys inside; Claude still writes session data and the like to that directory when it runs. Model mappings are determined by the directory's own settings, so 「高级」 (Advanced) only offers the proxy, command-line arguments, and environment variables.

### Import

- **从 CC Switch 导入… (Import from CC Switch…)**: shown when providers on this machine have been managed with CC Switch. Lists the usable providers (keys masked); existing ones are marked 「将更新已有项」 (Updates existing), and the one CC Switch is currently using is marked 「CC Switch 当前」 (Current in CC Switch). Check the ones to import, optionally check 「将 CC Switch 当前使用的设为该机器默认」 (Set CC Switch's current provider as machine default), and click 「导入」 (Import). It only reads CC Switch's configuration and doesn't modify it.
- **粘贴链接导入… (Import from link…)**: paste a CC Switch provider share link (like `ccswitch://v1/import?resource=provider&app=claude&…`), optionally check 「设为该机器默认」 (Set as machine default), and click 「导入」 (Import).

### Delete a provider

Click 「删除」 (Delete) next to the provider. If it was the machine default, the default reverts to 「官方登录」 (Official login); Bots set to use it specifically switch to inheriting the machine default; sessions using it automatically start a new session on the next turn.

## Agent settings (Claude Code)

「Agent 设置」 (Agent settings) at the bottom of the Claude Code card are the default settings for all Bots on this machine. Changes are saved immediately and take effect on the next turn:

- Language, extended thinking, and commit attribution (a Bot can override these three individually; see [Bot settings and permissions](/en/user/bot-settings#agent-settings));
- Built-in git instructions, auto memory, auto-compact, Bash default timeout, Bash max timeout, and disable nonessential traffic.

Below each item, the source of the current value is noted — 「默认」 (Default), 「该机器 CLI」 (Machine CLI), or 「机器设置」 (Machine settings) — along with which Bots override it.

**继承该机器 CLI 配置 (Inherit the machine CLI config)**: when on, Claude Code's own user configuration on this machine is also loaded (it shows how many hooks and permission rules take effect along with it); when off, your personal `CLAUDE.md`, memory, hooks, and user Skills are no longer loaded. Either way, permissions, models, MCP, plugins, and secrets are managed centrally by Gonggong Space, and same-named settings in the machine's CLI don't take effect.

## Which provider a Bot uses

Each Bot **inherits the machine's** default provider by default, or you can assign one specifically. Choose it under 「供应商」 (Provider) in the 「运行配置」 (Runtime) tab of the Bot details:

- 「继承机器（当前：…）」 (Inherit from machine (currently: …));
- 「官方登录」 (Official login);
- A provider for the same Agent on this machine.

Only the Bot owner can change it, on their own machine, while the machine is online. After choosing a third-party provider, the 「模型」 (Model) list switches to that provider's models. See [Bot settings and permissions](/en/user/bot-settings#provider).

## Switching doesn't affect sessions in progress

Whether you switch the machine default or a Bot's provider, **sessions in progress keep using the original provider**; the switch happens once a new session is started.

- If a group's session is still using the old provider when you switch, a confirmation dialog appears first — 「要让新会话改用 … 吗？」 ("Switch new sessions to …?") — listing 「N 个群的会话仍在使用 X，开启新会话后才会切换到 Y」 ("Sessions in N groups still use X and switch to Y once a new session starts").
- In those groups, a notice appears above the input box; click 「开启新会话」 (Start new session) to switch immediately — same as sending `/new @BotName` in the group (see [Command reference](/en/user/commands)).

## Related pages

- [My machines and Bots](/en/user/machines)
- [Bind a machine](/en/user/bind-machine)
- [Bot settings and permissions](/en/user/bot-settings)
- [Desktop app pages](/en/desktop/pages)
- [Command reference](/en/cli/reference)
