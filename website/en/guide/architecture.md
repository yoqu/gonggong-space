# Architecture

This page describes the parts that make up Gonggong Space, how an @Bot message becomes real operations on a machine, and where data and secrets live.

## Components

```text
Browser web app (React + Vite)
   │  HTTPS /api (requests)  ·  WSS /ws/web (real-time push)
   ▼
Server (Fastify + PostgreSQL, attachments and data directory)
   │  WSS /ws/daemon (tasks and events)  ·  WSS /ws/daemon/tunnel (preview tunnel)
   ▼
daemon on the member's machine (gg run or the desktop app)
   ├─ ACP adapter ──→ Claude Code / Codex (locally signed-in CLI)
   ├─ Built-in MCP (gonggong)
   └─ Workspaces ~/.gonggong/workspaces/…
```

Every connection is initiated by the daemon to the server, so members' machines don't need to open any inbound ports.

| Part | Technology | Responsibilities |
| --- | --- | --- |
| Web | React + Vite | Sign-in, group messages, @Bot, viewing run process / diffs / files, approvals, previews, admin console |
| Server | Fastify + PostgreSQL | Accounts and permissions, groups and messages, run scheduling, relaying daemon events, attachment storage, preview entry point, auditing |
| daemon | Rust, the `gg` CLI | Picks up work on members' machines: prepares workspaces, starts the agent, streams back the process, applies approval decisions, keeps preview tunnels up |
| Desktop app | Tauri (macOS) | Bundles the same daemon plus a GUI (Overview, Agent, Bot, Workspaces, Tunnels & services, Live view, Logs & diagnostics, Settings) |
| ACP adapter | npm package | Wraps Claude Code / Codex behind the [ACP](https://agentclientprotocol.com) (Agent Client Protocol) interface; the daemon drives the agent through it |
| Preview tunnel | WebSocket between daemon and server | Forwards browser requests for a preview to a local port on the member's machine |

### ACP adapters

The daemon doesn't parse CLI output directly; it talks to the agent over ACP. It uses two pinned-version adapters, installed automatically with npm into `~/.gonggong/adapters/` on first run (through the npmmirror mirror by default):

| Agent | Adapter |
| --- | --- |
| Claude Code | `@agentclientprotocol/claude-agent-acp` |
| Codex | `@agentclientprotocol/codex-acp` |

The adapters call the `claude` / `codex` CLI installed and signed in on the machine, so models, sign-in method, and account quota all follow your local setup. Each "group × Bot" has one adapter process and one ACP session; after 10 minutes idle the process is reclaimed, and the next turn resumes the session in a new process, so the Bot still remembers the earlier conversation.

### Built-in MCP

For each session, the daemon serves an MCP server named `gonggong` on the local loopback address. Through it, the agent can:

- read and search this group's chat history, and view group info, run records, past questions, and attachments;
- ask group members a question (and wait for an answer);
- publish previews (web services, static pages, desktop apps, mini programs) and manage managed services;
- hand off a task to another Bot in the group.

## The journey of a message

Take Li Na sending `@后端助手 给待办加一个截止日期字段` ("@Backend Assistant add a due-date field to todos") in the group 「todo-app」 as an example:

1. **Send**: the web app sends the message to the server, which resolves the @'d Bot.
2. **Check and create the run**: the server checks whether Li Na is within Backend Assistant's trigger scope. If not, the run card shows 「无权触发」 (Not allowed to trigger); if so, it creates a run with status 「排队中」 (Queued).
3. **Schedule**: once the Bot's machine is online, its concurrency limit isn't reached, the previous turn in this group has finished, and the workspace is ready, the server sends the task (`run.start`, including the message, context, permission tier, command approval rules, and so on) to that machine's daemon. If the machine is offline, the run shows 「离线等待」 (Waiting for machine) and is dispatched once it comes online, or voided on timeout.
4. **Execute**: in the workspace for that "group × Bot," the daemon has the agent start the turn over ACP; the agent reads code, edits files, and runs commands.
5. **Stream the process back**: the agent's reasoning, tool calls, and command output go back to the server in real time as `run.event` via the daemon. The server redacts them, stores them, and pushes them over `/ws/web` to group members who are watching.
6. **Approvals / questions**: when the agent requests an operation beyond its permission tier, the daemon first evaluates it locally against the Bot's command approval rules. If a human must decide, it sends `approval.request`, an approval card appears in the group, and after the Bot owner approves or denies, the result is sent back to the daemon. Questions work the same way.
7. **Finish**: the daemon sends `run.done` with the final reply and this turn's diff; the run card changes to 「已完成」 (Completed). If the Bot handed the task to another Bot via the 「交给其他 Bot」 (Hand off to another Bot) tool, the server posts a message in its name that @s the next Bot, starting the next hop (chain length is capped by the group setting 「接力链长上限（跳）」 (Max hand-off chain length, in hops)).

## Where data lives

| Data | Location |
| --- | --- |
| Workspaces (repository clones, the Bot's changes) | Member's machine: `~/.gonggong/workspaces/` or the local directory bound with `/cd` |
| git credentials | Member's machine; the Bot accesses repositories with its owner's own credentials |
| Agent sign-in state, model provider keys and URLs | Member's machine only; never uploaded to the server |
| daemon local config and logs | Member's machine: `~/.gonggong/` |
| Accounts, groups, messages, run cards, approval and question records | Server database (redacted before storage) |
| Free-form run process text, this turn's diff | Server database, encrypted |
| Attachments | Server data directory, encrypted |

::: tip
The server only schedules and relays: reading and writing code and running commands all happen on members' machines. What the server sees is the process, final reply, and this turn's diff sent back by the agent (all redacted; diffs and process are stored encrypted). See [Security model](/en/deploy/security) for the full picture.
:::

## Connections and authentication

- **daemon authentication**: in the web app, a member uses 「绑定新机器」 (Bind new machine) to generate a one-time connect link (`gonggong://bind?…`) or a `gg login` command, which the daemon exchanges for a long-lived machine token.
- **Encrypted connections only**: once the server is configured with a certificate (`GONGGONG_TLS_CERT` + `GONGGONG_TLS_KEY`), it serves only HTTPS / WSS. The daemon allows `http://` only for the local loopback address; everything else requires `https://`.
- **Certificate fingerprint pinning**: the daemon doesn't rely on a CA chain; it pins the SHA-256 fingerprint of the server certificate, so self-signed certificates are just as secure:
  - The connect link and the bind command copied from the web app include the fingerprint (`--fingerprint sha256:…`) and accept only that certificate;
  - Without a fingerprint, the daemon trusts the current certificate on first use and prints its fingerprint—check it against the value your admin published;
  - Every later connection is verified, and a mismatch is refused. After the server changes certificates, run `gg login` again.
- **Heartbeat**: once connected, the daemon sends heartbeats periodically (every 15 seconds by default); after several consecutive misses it's considered offline.
- **Revocation**: after an admin deactivates an account or revokes a machine, the daemon's next connection is refused, and it clears the local credentials and managed workspaces.

For generating and deploying certificates, see [HTTPS and certificates](/en/deploy/https); for protocol details, see [Protocol](/en/dev/protocol).

## Related pages

- [Core concepts](/en/guide/concepts)
- [Deployment overview](/en/deploy/)
- [Security model](/en/deploy/security)
- [Repository structure](/en/dev/structure)
