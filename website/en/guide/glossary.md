# Glossary

This page lists common Gonggong Space terms by topic. Because the product UI is Chinese-only, each row gives the Chinese term you'll see in the interface, the English term used in these docs, and the name used in code and protocols, so you can match the UI, logs, and source code.

## Product and components

| Chinese (UI) | English (docs) | In code / protocol | Description |
| --- | --- | --- | --- |
| 共工空间 | Gonggong Space | gonggong-space | The product name, after Gonggong, the ancient water god |
| 共字君 | Gong | — | The brand mascot, a flat figure shaped like the character 共; also the default Bot character |
| 服务器 | server | server | Fastify + PostgreSQL; handles accounts, groups, messages, and scheduling |
| daemon | daemon | daemon | The background program on members' machines that picks up tasks and invokes the local agent |
| gg | gg | gg | The daemon's CLI; `gg run` starts the daemon |
| 桌面端 | desktop app | desktop app | The macOS GUI client (Tauri) with a built-in daemon |
| 共工空间客户端 | client | client | The UI's umbrella name for the daemon (CLI or desktop app) |
| 管理后台 | admin console | admin | The back-office pages used by sysadmins |

## Accounts and machines

| Chinese (UI) | English (docs) | In code / protocol | Description |
| --- | --- | --- | --- |
| 系统管理员 | sysadmin | sysadmin | The role that can open the admin console |
| 普通成员 | member | member | The default role |
| 群管理员 | group admin | group admin | Can manage a group's settings, members, and Bots |
| 机器 | machine | machine | A machine with the daemon installed and bound to an account |
| 绑定 | bind | bind / login | Assigning a machine to an account; `gg login` |
| 接入链接 | connect link | bind link | A one-time link of the form `gonggong://bind?server=…&code=…` containing the server URL and bind code |
| 绑定码 | bind code | bind code | A one-time code like `XXXX-XXXX` that expires |
| 心跳 | heartbeat | heartbeat | The periodic online signal the daemon sends to the server |
| 吊销 | revoke | revoke | After an account is deactivated or a machine removed, the server refuses that machine's connections |

## Bots and agents

| Chinese (UI) | English (docs) | In code / protocol | Description |
| --- | --- | --- | --- |
| Bot | Bot | bot | An AI member you can @ in a group, pinned to one of its owner's machines |
| 归属人 / Bot 主人 | Bot owner | owner | The member the Bot belongs to; the only person who can approve its out-of-scope operations and change its command approval setting |
| 执行机器 | execution machine | machine | The machine the Bot runs on |
| Agent | agent | agent | The AI coding tool that does the work: Claude Code (`claude`) or Codex (`codex`) |
| 角色 | character | avatar / role | The Bot's avatar and persona: Gong or one of 12 personality characters |
| 系统提示词 | system prompt | system prompt | The Bot's responsibilities; also shown as its description in groups |
| 供应商 | provider | provider | A third-party model API URL and API key, stored only on the local machine |
| ACP | ACP | Agent Client Protocol | The protocol the daemon uses to drive agents |
| ACP 适配器 | ACP adapter | ACP adapter | The npm package that wraps Claude Code / Codex behind the ACP interface |
| 内置 MCP | built-in MCP | built-in MCP server (`gonggong`) | Tools the daemon provides to the agent: reading chat history, asking questions, publishing previews, handing off to another Bot, and so on |
| Agent 命令 | Agent command | agent command | The agent's own slash commands (e.g. `/compact`), forwarded as-is from the group to the agent |

## Permissions and approvals

| Chinese (UI) | English (docs) | In code / protocol | Description |
| --- | --- | --- | --- |
| 触发范围 | trigger scope | trigger scope | Who can @ this Bot: any group member (all) / specified list (list) / only me (self) |
| 权限档位 | permission tier | tier | Read-only (read-only) / Workspace write (workspace) / Full access (full) |
| 命令审批 | command approval | approval | How out-of-scope requests are handled: ask every time (ask) / auto-approve allowlist (allowlist) / auto-approve all (all) |
| 命令白名单 | command allowlist | allowlist | Command prefixes approved automatically in allowlist mode, e.g. `go build` |
| 权限审批 | permission request | approval request | The card that appears when a Bot requests an out-of-scope operation; the Bot owner approves or denies it |
| 提问 | question | question | A multiple-choice or open-ended question a Bot asks group members, answered by the requester or the Bot owner |
| 无权触发 | not allowed to trigger | forbidden | The requester isn't in the Bot's trigger scope |
| 脱敏 | redaction | redaction | Removing secrets and other sensitive content from run process, diffs, etc. before storage |
| 审计记录 | audit log | audit log | The record of admin actions, approvals, commands, and so on |

## Groups, repositories, and workspaces

| Chinese (UI) | English (docs) | In code / protocol | Description |
| --- | --- | --- | --- |
| 群 | group | group | Where members and Bots work together |
| 私聊 | direct chat | DM | Only you and your Bot |
| 仓库 | repository | repo | The git repository bound to a group |
| 基准分支 | base branch | base branch | The group repository's main branch, `main` by default |
| 工作区 | workspace | workspace | The directory a Bot works in within a group; one per "group × Bot" |
| 托管工作区 | managed workspace | managed workspace | A directory the daemon creates automatically under `~/.gonggong/workspaces/`; a managed clone when the group has a repository |
| 本机目录（/cd） | local directory (/cd) | cd binding | An existing directory the Bot owner specifies with `/cd` |
| 默认工作区 | default workspace | default workspace | The directory a Bot uses in groups without a repository and in direct chats |
| 分区模式 | partition mode | partition | The group's sync mode: each Bot makes changes independently in its own workspace |
| 基准分支镜像 | base branch mirror | mirror | A copy of the base branch the server keeps with its own git credentials, used for @ file suggestions and search |

## Runs and results

| Chinese (UI) | English (docs) | In code / protocol | Description |
| --- | --- | --- | --- |
| 运行 / 轮次 | run / turn | run / turn | One turn of work triggered by @ing a Bot |
| 运行卡片 | run card | run card | The card in a group showing a run's status and results |
| 过程 | process | process | Reasoning, tool calls, and command output during a run |
| 离线等待 | waiting for machine | offline wait | The Bot's machine is offline; the request waits for it to come online |
| 打断并追加 | interrupt and append | append | Sending a message during a run to interrupt the current turn and add requirements |
| 接力 | hand-off | relay / hand off | A Bot passes a task to another Bot in the group via the 「交给其他 Bot」 (Hand off to another Bot) tool (writing @ in a reply is only a mention and doesn't trigger anything) |
| 接力链 | hand-off chain | chain (hop) | Multiple runs linked by hand-offs; each run is one hop, and the maximum chain length is adjustable in group settings |
| 会话 | session | session | The persistent agent session for each "group × Bot," which lets the Bot remember earlier conversation |
| 上下文占用 | context usage | context usage | The share of the context window the session has used |
| 压缩上下文 | compact context | compact | Summarize the earlier conversation and keep the summary |
| 开新对话 | new conversation | new session | Stop carrying the earlier conversation; same as `/new` |
| diff | diff | diff | Code changes, viewable for this turn, uncommitted, or relative to the base branch |
| 预览 | preview | preview | A web service, static page, desktop app, or mini program published by a Bot, openable in the browser |
| 托管服务 | managed service | managed service | A background service the Bot starts on the machine and the daemon manages |
| 隧道 / 穿透 | tunnel | tunnel | The connection between the daemon and the server that forwards preview traffic |
| 实时画面 | live view | live view | The real-time stream of desktop app and mini program previews |
| 公开链接 | public link | share link | A time-limited link that lets outsiders access a preview |
| 用量 | usage | usage | Token and cost statistics for a Bot's runs |
| 诊断包 | diagnostics bundle | diagnostics bundle | The redacted zip exported by `gg logs --export` |

## Related pages

- [Core concepts](/en/guide/concepts)
- [Architecture](/en/guide/architecture)
