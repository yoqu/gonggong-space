# Architecture

This page describes the parts of Gonggong Space, how an @Bot message becomes real actions on a machine, and where data and secrets live.

## Components

```text
Browser web app (React + Vite) · desktop app · Feishu
   │  HTTPS /api (requests)  ·  WSS /ws/web (live push)
   ▼
Server (Fastify + PostgreSQL, attachments and data directory)
   │  WSS /ws/daemon (tasks and events)  ·  WSS /ws/daemon/tunnel (preview tunnel)
   ▼
daemon on a member's machine (gg or the desktop app)
   ├─ ACP ──→ Claude Code / Codex / Gemini CLI / CodeBuddy / pi / DeepSeek Harness / Antigravity CLI
   ├─ Built-in MCP (gonggong)
   └─ Workspaces ~/gonggong/workspaces/…
```

Every connection is opened by the daemon toward the server, so members' machines don't need to expose any ports.

| Part | Technology | Responsibilities |
| --- | --- | --- |
| Web | React + Vite | Login, group messages, @Bot, run process / diff / Git / files, approvals, previews and works, the market, machines and Bots, the admin console; works in mobile browsers |
| Server | Fastify + PostgreSQL | Accounts and permissions, groups and messages, scheduling runs and scheduled tasks, relaying daemon events, storing attachments and works, preview entry points, auditing |
| daemon | Rust, the `gg` CLI | Does the work on members' machines: prepares workspaces, starts Agents, streams the process back, applies approval decisions, keeps preview tunnels open, runs Git operations and terminal sessions |
| Desktop app | Tauri (macOS, Windows) | Bundles the same daemon plus a GUI (Overview, Agents, Bots, Workspaces, Tunnels & services, Live views, Market, Logs & diagnostics, Settings) |
| Agent integration | ACP | The daemon drives each Agent through [ACP](https://agentclientprotocol.com) (Agent Client Protocol), receiving structured thinking, tool calls, and permission requests |
| Preview tunnel | WebSocket between daemon and server | Forwards browser requests for a preview to a local port on the member's machine |

### Agent integration

The daemon doesn't parse the CLI's terminal output; it talks to Agents over ACP:

| Agent | How it connects |
| --- | --- |
| Claude Code | Pinned-version ACP adapter `@agentclientprotocol/claude-agent-acp` |
| Codex | Pinned-version ACP adapter `@agentclientprotocol/codex-acp` |
| Gemini CLI, CodeBuddy, DeepSeek Harness, Antigravity CLI | Built-in Agent plugins using the CLI's own ACP mode |
| pi | Built-in Agent plugin, connected through the `pi-acp` adapter |

Adapters are installed automatically with npm into `~/.gonggong/adapters/` on first use (via the npmmirror mirror by default). The Agent calls the CLI installed on the machine; models, sign-in, and account quota come from the local configuration, or from a provider configured on the machine.

Each "group × Bot" maps to one Agent process and one ACP session. After 10 minutes idle the process is reclaimed, and the next turn resumes the session in a new process, so the Bot still remembers the earlier conversation.

### Built-in MCP

For each session the daemon serves an MCP server named `gonggong` on the local loopback address. Agents use it to work with the group, for example to:

- read and search this group's chat history; view group info, run records, past questions, and attachments; send attachments;
- ask group members a question (and wait for an answer), or ask a member to fill in a secret;
- publish previews (web services, static pages, desktop apps, mini programs), manage hosted services, and render web pages into the chat;
- hand a task to another Bot (relay), open a thread and assign a Bot to take over, and create scheduled tasks;
- maintain the group knowledge base, and manage Skills, MCP servers, and market listings.

The available tools are trimmed by the requester's identity and the group's configuration: in a group without Feishu bound or without plugins enabled, the corresponding tools aren't listed to the Bot.

## The journey of a message

Take Li Na sending `@后端助手 给待办加一个截止日期字段` ("add a due-date field to todos") in the group "todo-app":

1. **Send**: the web app sends the message to the server, which works out which Bot was @-mentioned.
2. **Check and create the run**: the server checks whether Li Na is in 后端助手's trigger scope. If not, the run card shows 「无权触发」 (Not allowed); if so, it creates a run in the 「排队中」 (Queued) state.
3. **Schedule**: once the Bot's machine is online, the concurrency limit isn't reached, the previous turn in this group has finished, and the workspace is ready, the server sends the task (with the message, group chat context, approval mode, and the Skills and MCP servers in effect for this turn) to that machine's daemon. If the machine is offline, the run shows 「离线等待」 (Waiting for machine) and is dispatched when it comes online, or voided after a timeout.
4. **Execute**: in the workspace for that "group × Bot", the daemon has the Agent start the turn over ACP; any secrets needed are injected only as environment variables. The Agent reads code, edits files, and runs commands.
5. **Stream the process back**: the Agent's thinking, tool calls, and command output flow through the daemon to the server in real time. The server redacts them, stores them, and pushes them over `/ws/web` to group members who are watching.
6. **Approvals / questions**: when the Agent asks for an action that needs a check, the daemon first decides locally using the Bot's approval mode and rules (under 「帮我审批」 (Review for me), it may defer to the Agent's built-in review or the AI pre-review). If a person needs to decide, an approval card appears in the group; after the Bot owner approves or denies it, the result is sent back to the daemon. Questions work the same way.
7. **Finish**: the daemon reports the final reply and this turn's diff, and the run card changes to 「已完成」 (Completed). If the Bot handed the task to another Bot with the 「交给其他 Bot」 (Hand off to another Bot) tool, the server posts a message in its name that @s the next Bot, starting the next hop of the relay (the chain length is capped by the group setting 「接力链长上限（跳）」 (Max relay chain length (hops))).

## Where data lives

| Data | Location |
| --- | --- |
| Workspaces (repository clones, the Bot's changes) | Member's machine: `~/gonggong/workspaces/` or a local directory chosen by the Bot owner |
| git credentials | Member's machine; Bots access repositories with their owner's own credentials |
| Agent sign-in, model provider keys and endpoints | Member's machine only; never uploaded to the server |
| daemon local config, logs, adapters | Member's machine: `~/.gonggong/` |
| Accounts, groups, messages, run cards, approval and question records | Server database (redacted before storage) |
| Free text from the run process, this turn's diff | Server database, encrypted |
| Attachments | Server data directory, encrypted |
| Platform / team / group / personal secrets | Encrypted on the server; injected into Bots as environment variables at run time and masked by value in the process and replies |

::: tip
The server only schedules and relays: reading and writing code and running commands all happen on members' machines. What the server sees is the process the Agent streams back, the final reply, and this turn's diff (all redacted; the diff and process are stored encrypted). For the full picture, see [Security model](/en/deploy/security).
:::

## Connections and authentication

- **daemon authentication**: the daemon exchanges the one-time connect code generated by 「绑定新机器」 (Bind new machine) on the web for a long-lived machine token. The connect code is valid for 30 minutes. If it has expired or was already used, `gg login` doesn't simply fail: it opens a connection request and prints a confirmation link and a 4-character check code. The machine's owner compares the code on the web page and clicks 「允许接入」 (Allow) to finish binding.
- **Transport**: configure a certificate on the server (`GONGGONG_TLS_CERT` + `GONGGONG_TLS_KEY`) or put it behind an HTTPS reverse proxy. The daemon must use `https://` for any non-local server and verifies the server certificate: by default against the system's trusted CAs; for a self-signed certificate use `gg login --fingerprint`, and for a private CA use `gg login --ca-file` to specify what to trust.
- **Heartbeat**: once connected, the daemon sends heartbeats periodically (every 15 seconds by default); after several missed in a row, it's considered offline.
- **Upgrades**: once connected, the daemon automatically upgrades to the version in the server's 「客户端发布」 (Client releases). It downloads the update and restarts when no tasks are running, so running tasks aren't interrupted.
- **Revocation**: after an admin disables an account or revokes a machine, the daemon is rejected on its next connection and clears its local credentials and managed workspaces (local directories chosen by the Bot owner aren't deleted).

For generating and deploying certificates, see [HTTPS and certificates](/en/deploy/https); for protocol details, see [Protocol](/en/dev/protocol).

## Related pages

- [Core concepts](/en/guide/concepts)
- [Deployment overview](/en/deploy/)
- [Security model](/en/deploy/security)
- [Repository structure](/en/dev/structure)
