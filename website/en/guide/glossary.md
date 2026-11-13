# Glossary

This page lists common Gonggong Space terms by topic, with the English name used in code and protocols, so you can match what you see in the interface, logs, and source code. Each row gives the Chinese term as shown in the Chinese interface, the English term used in these docs, and the name in code / protocol.

## Product and components

| Chinese | English (docs) | In code / protocol | Description |
| --- | --- | --- | --- |
| 共工空间 | Gonggong Space | gonggong-space | The product name, after Gonggong, the ancient water god |
| 共字君 | Gong | — | The brand mascot, a flat figure shaped like the character 共; also an optional Bot character |
| 服务器 | server | server | Fastify + PostgreSQL; handles accounts, groups, messages, and scheduling |
| daemon | daemon | daemon | The resident program on members' machines that picks up tasks and calls the local Agent |
| gg | gg | gg | The daemon's CLI; `gg run` starts the daemon, and `gg service install` installs it as a background service |
| 桌面端 | desktop app | desktop app | The GUI client with a built-in daemon (Tauri), for macOS and Windows |
| 共工空间客户端 | client | client | The interface's umbrella name for the daemon (CLI or desktop app) |
| 管理后台 | admin console | admin | The back-office pages used by sysadmins |

## Accounts and machines

| Chinese | English (docs) | In code / protocol | Description |
| --- | --- | --- | --- |
| 系统管理员 | sysadmin | sysadmin | The role that can open the admin console |
| 普通成员 | member | member | The default role |
| 群管理员 | group admin | group admin | Can manage a group's settings, members, and Bots |
| 团队 | team | team | The scope Bots, groups, Skills, and so on belong to; machines belong to individuals |
| 机器 | machine | machine | A machine with the daemon installed and bound to an account |
| 绑定 | bind | bind / login | Assigning a machine to an account; `gg login` |
| 发给你的 Agent | Send to your agent | agent onboarding | Send one message to the local Agent; it installs `gg`, binds the machine, installs the background service, and automatically sets up a Bot and a direct chat |
| 接入码 | connect code | connect code | A one-time code like `XXXX-XXXX`, valid for 30 minutes |
| 接入链接 | connect link | bind link | A one-time link of the form `gonggong://bind?…` containing the server URL and connect code; opened with the desktop app |
| 接入申请 | connection request | link request | The request `gg login` opens when the connect code has expired or was used; the machine's owner checks the 4-character check code on the web and clicks 「允许接入」 (Allow) |
| 后台服务 | background service | service | The resident service installed by `gg service install` (launchd on macOS, a systemd user service on Linux) |
| 机器与 Bot | Machines & Bots | machines | The web page for managing Bots, Agent tools, providers, Git access, storage, upgrades, and terminals per machine |
| 终端 | terminal | terminal | A shell session on the machine that its owner opens from the web |
| 心跳 | heartbeat | heartbeat | The periodic online signal the daemon sends to the server |
| 吊销 | revoke | revoke | After an account is disabled or a machine removed, the server refuses that machine's connections |

## Bots and Agents

| Chinese | English (docs) | In code / protocol | Description |
| --- | --- | --- | --- |
| Bot | Bot | bot | An AI member you can @ in a group; always runs on one of its owner's machines |
| 归属人 / Bot 主人 | Bot owner | owner | The member the Bot belongs to; the only person who can act on its approval cards and change its approval mode |
| 执行机器 | machine | machine | The machine the Bot runs on |
| Agent | Agent | agent | The AI coding tool that does the work: Claude Code, Codex, Gemini CLI, CodeBuddy, pi, DeepSeek Harness |
| Agent 插件 | Agent plugin | agent plugin | An Agent connected as a plugin; Gemini CLI, CodeBuddy, pi, and DeepSeek Harness are built-in Agent plugins |
| 角色 | character | avatar / role | The Bot's avatar and personality look: follows the Agent, Gong, or one of 12 personality characters |
| 系统提示词 | system prompt | system prompt | Describes the Bot's job; also shown as its intro in the group |
| 共享 Bot | shared Bot | shared bot | A Bot its owner shares with team members so they can chat with it directly |
| 供应商 | provider | provider | A third-party model endpoint and API key, stored only on the local machine |
| ACP | ACP | Agent Client Protocol | The protocol the daemon uses to drive Agents |
| ACP 适配器 | ACP adapter | ACP adapter | An npm package that wraps a CLI without its own ACP mode in an ACP interface |
| 内置 MCP | built-in MCP | built-in MCP server (`gonggong`) | Tools the daemon provides to the Agent: read chat history, ask questions, publish previews, hand off to another Bot, knowledge base, scheduled tasks, and more |
| Agent 命令 | Agent command | agent command | A slash command built into the Agent (such as `/compact`), passed through to the Agent as-is from the group |

## Permissions and approvals

| Chinese | English (docs) | In code / protocol | Description |
| --- | --- | --- | --- |
| 触发范围 | trigger scope | trigger scope | Who can @ this Bot: any group member (all) / specified list (list) / owner only (self) |
| 审批方式 | approval mode | approval mode | Ask me every time (ask) / Review for me (review) / Allow everything (full); can be set per group |
| 帮我审批 | Review for me | review | Routine development actions go through directly; the rest goes to the Agent's built-in review, the AI pre-review, or the Bot owner |
| AI 预审 | AI pre-review | AI review | Under Review for me, a chosen small model screens requests first and only hands risky ones to a person; off by default |
| 权限档位 | permission tier | tier | The tier behind the approval mode: read-only / workspace / full |
| 已允许的命令 | allowed commands | always allow | Command prefixes recorded by 「批准，不再询问」 (Approve, don't ask again) on an approval card; allowed automatically from then on |
| 审批卡片 | approval card | approval request | The card that appears when a Bot asks for an action that needs a check; the Bot owner approves or denies it |
| 本次运行免审批 | No approvals this run | allow for this run | An option on approval cards: allow everything for this run only, restored automatically when it ends |
| 提问 | question | question | A multiple-choice or open question a Bot asks group members; answered by the requester, the Bot owner, or a member it @s |
| 无权触发 | not allowed | forbidden | The requester isn't in the Bot's trigger scope |
| 脱敏 | redaction | redaction | Removing secrets and other sensitive content from the run process, diffs, and so on before storage |
| 审计记录 | audit log | audit log | A record of admin actions, approvals, commands, and more |

## Groups, repositories, and workspaces

| Chinese | English (docs) | In code / protocol | Description |
| --- | --- | --- | --- |
| 群 | group | group | Where members and Bots work together |
| 公开频道 | public channel | public channel | A group team members can find in 「浏览频道」 (Browse channels) and join on their own |
| 私聊 | direct chat | DM | Just you and one Bot; triggers without an @ |
| 话题 | thread | thread | A discussion branched off a message whose replies don't flood the main group; a Bot can also open a thread and assign a Bot to take over |
| 定时任务 | scheduled task | schedule | A task in a group or direct chat that triggers a Bot automatically on a schedule |
| 知识库 | knowledge base | knowledge base | Markdown entries in a group that every Bot in it can read, with version history |
| 密钥 | secret | secret | A sensitive value in one of four layers (platform / team / group / personal); injected as an environment variable at run time and masked |
| 仓库 | repository | repo | A git repository bound to a group: a primary repository plus extra ones |
| 基准分支 | base branch | base branch | The repository's main branch, `main` by default; can be push-protected |
| 工作区 | workspace | workspace | The directory a Bot works in within a group; one per "group × Bot" |
| 托管工作区 | managed workspace | managed workspace | A directory the daemon creates automatically under `~/gonggong/workspaces/<group name>/<Bot name>/<repo name>` |
| 本机目录（/cd） | local directory (/cd) | cd binding | An existing directory chosen by the Bot owner |
| 分区模式 | partition mode | partition | A group sync mode: each Bot makes changes independently in its own workspace |
| 强制同步 | force sync | force sync | A group sync mode: Bots on different machines share one workspace, and conflicts are three-way merged automatically |
| 基准分支镜像 | base branch mirror | mirror | A copy of the base branch the server keeps with its own git credentials, used for @ file suggestions and search |
| Git 面板 | Git panel | git panel | The central place for commits, logs, stashes, branches, and conflict resolution |

## Runs and results

| Chinese | English (docs) | In code / protocol | Description |
| --- | --- | --- | --- |
| 运行 / 轮次 | run / turn | run / turn | One round of work triggered by @ing a Bot |
| 运行卡片 | run card | run card | The card in the group that shows a run's status and result |
| 过程 | process | process | Thinking, tool calls, and command output during a run |
| 离线等待 | waiting for machine | offline wait | The Bot's machine is offline and the request waits for it to come online |
| 打断并追加 | interrupt and append | append | Send a follow-up during a run to interrupt the current turn and add to the request |
| 接力 | relay / hand off | relay / hand off | A Bot uses the 「交给其他 Bot」 (Hand off to another Bot) tool to pass a task to another Bot (writing @ in a reply is only a mention and doesn't trigger anything) |
| 接力链 | relay chain (hop) | chain (hop) | Several runs linked by relays; each run is one hop, and the maximum chain length can be adjusted in group settings |
| 会话 | session | session | The ongoing Agent session for each "group × Bot", which is how the Bot remembers earlier conversation |
| 上下文占用 | context usage | context usage | How much of the context window the session uses; the 「上下文」 (Context) tab in run details has an estimated breakdown |
| 压缩上下文 | compact context | compact | Summarize the conversation so far and keep the summary |
| 开新对话 | new conversation | new session | Stop carrying the earlier conversation; same as `/new` |
| diff | diff | diff | Code changes, viewable for this turn, uncommitted, or against the base branch |
| 预览 | preview | preview | A web service, static page, desktop app, or mini program a Bot publishes, openable in the browser |
| 托管服务 | hosted service | managed service | A background service a Bot starts on the machine and the daemon manages |
| 隧道 / 穿透 | tunnel | tunnel | The connection between the daemon and the server that forwards preview traffic |
| 实时画面 | live view | live view | The live stream of a desktop app or mini program preview |
| 公开链接 | public link | share link | A time-limited link that lets people outside the team view a preview or prototype |
| 作品 | work | artifact / work | A prototype or similar output hosted on the server, with versions; can be annotated on the canvas and handed to a Bot to revise |
| 画布 | canvas | canvas | A multi-screen view that lays out a prototype's screens |
| 插件 | plugin | plugin | An extension package that can bring MCP servers, slash commands, canvas instructions, provider presets, or Agents |
| Skill 市场 | Skill market | market | Where Skills and plugins are uploaded, reviewed, and added |
| 用量 | usage | usage | Token and cost statistics for Bot runs |
| 诊断包 | diagnostics bundle | diagnostics bundle | The redacted zip exported by `gg logs --export` |

## Related pages

- [Core concepts](/en/guide/concepts)
- [Architecture](/en/guide/architecture)
