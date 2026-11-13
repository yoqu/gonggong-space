# Protocol

This page describes the communication contracts between Gonggong Space's components: what `packages/protocol` contains, daemon–server messages and capability negotiation, ACP and Agent adapters, built-in MCP tools, and the binary frames of the preview tunnel.

## Overview

```text
浏览器 ──REST /api + WS /ws/web──▶ 服务器 ◀──WS /ws/daemon（JSON）────────── daemon ──ACP（stdio）──▶ Agent 适配器 ──▶ Agent CLI
       ──WS /ws/terminals/:id────▶   ▲     WS /ws/daemon/tunnel（二进制帧）     │
                                     └──────── REST /api/daemon/* ◀─────────────┘
                                                                               daemon 内置 MCP（回环 HTTP）◀── Agent
```

In the diagram: 浏览器 = browser, 服务器 = server, Agent 适配器 = Agent adapter, 二进制帧 = binary frames, daemon 内置 MCP（回环 HTTP） = the daemon's built-in MCP (loopback HTTP).

All TypeScript-side contracts are defined with zod in `packages/protocol` and used directly by the server, web client, and desktop app. The Rust side mirrors them by hand in `crates/gonggong/src/protocol.rs`, and shared fixtures keep both sides consistent.

## What packages/protocol contains

| File | Contents |
| --- | --- |
| `src/common.ts` | Base types shared by both sides: Agent kinds (`claude`, `codex`, `gemini`, `codebuddy`, `pi`, `deepseek`), permission tiers, command approval, run status, attachment and question limits, context usage, and so on |
| `src/web.ts` | Web ⇄ server: REST request/response DTOs (prefix `/api`, sessions via an httpOnly cookie), and the real-time events the server pushes to the browser over `WS /ws/web` |
| `src/daemon.ts` | daemon ⇄ server: the `DaemonToServer` and `ServerToDaemon` unions discriminated by the `t` field, `PROTOCOL_VERSION`, and the optional capabilities `DaemonFeature` |
| `src/tunnel.ts`, `src/terminal.ts` | Preview tunnel frame encoding/decoding and the `open` / `head` / `reset` frame structures; web terminal sessions and control messages |
| `src/tools.ts`, `src/tool-titles.ts` | Input definitions of the built-in `gonggong` MCP tools (which generate `gonggong-tools.json` and `gonggong-daemon-tools.json`) and their display titles |
| `src/agent-settings.ts` | Agent settings exposed as controls |
| `src/plugins.ts`, `src/market.ts` | The plugin manifest `gonggong-plugin.json` and the Skill market |
| `src/secrets.ts`, `src/schedules.ts`, `src/sync.ts`, `src/artifacts.ts`, `src/feishu.ts` | Contracts for secrets, schedules, forced sync, managed artifacts, and Feishu integration |
| `src/ui-blocks.ts`, `src/html-render.ts` | Rich content blocks and embedded HTML pages in Bot replies |
| `src/i18n.ts`, `src/i18n-en.ts`, `src/translate.ts` | i18n core (Chinese source text as key) and English text shared across clients |
| `src/mentions.ts`, `src/repo.ts`, `src/notification-view.ts`, `src/version.ts` | Small utilities: `@Bot` recognition, repository URL normalization, notification display, version comparison, and so on |
| `fixtures/*.json` | Shared samples for the daemon protocol, tunnel frames, terminal control, and some daemon HTTP endpoints; both TS and Rust must round-trip them |
| `cases/*.json` | Other cross-language shared cases (such as tunnel frame encoding and repository URL normalization) |

## daemon ⇄ server

The daemon connects to `WS /ws/daemon` with a machine token. Each message is a JSON object with a `t` field.

- **Handshake**: the daemon sends `hello` (protocol version, token, daemon version, machine info, Agent list, runs and hosted services still in progress, terminal sessions, and the `features` capability list). The server replies with `welcome` (machine id, heartbeat interval, available new version, whether the preview tunnel is enabled, and whether the server has published a daemon build for this platform), or with `reject` (reason `protocol` / `revoked` / `unauthorized`; when the protocol is too old, it includes the minimum protocol version and upgrade info).
- **Server → daemon** (`s2d`): runs (`run.start`, `run.cancel`, `run.append`, `run.tier`…), approval and question replies, workspaces (`workspace.*`), files (`files.*`, `dir.*`), Git (`git.*`, `gitaccess.cmd`), previews and live views (`previews.sync`, `cast.*`), Agent tools and providers (`tools.cmd`, `providers.cmd`, `ccswitch.*`), hosted services, logs, diagnostics, upgrades (`upgrade.start`), and more.
- **daemon → server** (`d2s`): `heartbeat`, `run.event` (streamed events such as text, thinking, tool calls, and usage), `run.done`, `approval.request`, `question.ask`, `workspace.state`, `session.config`, `commands.update`, `agents.update`, various `*.result` messages, and more.

Some requests go over REST instead (`/api/daemon/*`, authenticated with the machine token), such as login binding and web-confirmed connection, built-in MCP tool calls, attachment and artifact upload/download, Skill and plugin version downloads, forced-sync file chunks, network measurement, and upgrade package downloads.

### Capability negotiation

The protocol version `PROTOCOL_VERSION` is bumped only for incompatible changes; daemons below it are rejected with `reject`. Everyday new features are negotiated through **`DaemonFeature` capabilities**: the daemon declares the capabilities it supports in `hello.features` (such as `gitOps3`, `terminal-v2`, `storageAdmin`, `artifacts`, `upgrade`, `gemini`, `builtinReview`), and the server decides whether to send the corresponding messages. When the daemon doesn't support a capability, the related actions on the web are refused or hidden, rather than sending messages an older daemon can't understand.

When you add a kind of daemon message or field that an older daemon would misinterpret or drop, add a capability to `DaemonFeature` and check it on the server side.

### Fixture round-trip tests

Every kind of message has at least one sample under `packages/protocol/fixtures/`, named `<category>.<name>[.<variant>].json`. The categories are `d2s` and `s2d` (WebSocket messages), `tunnel` and `terminal` (frames and control messages), `http` (requests and responses of daemon REST endpoints), and `data` (data tables that must match on both sides), for example `d2s.run.event.tool.json` and `s2d.run.start.json`.

Each side has a test that walks the whole directory:

- TS: `packages/protocol/test/fixtures.test.ts` parses every sample with zod and checks that the file name matches the message's `t` field.
- Rust: `crates/gonggong/tests/it/contract.rs` deserializes and reserializes every sample and requires the result to match the original (ignoring `null` fields); unknown categories fail immediately. It also verifies the frame encoding in `cases/tunnel-frames.json`.

So when the protocol changes, change `packages/protocol` first, add fixtures for new messages or fields, then update `protocol.rs`. It's done only when both `pnpm -r test` and `cargo test --workspace` pass.

## ACP and Agent adapters

The daemon doesn't call each vendor's CLI directly; it drives adapters through the [Agent Client Protocol (ACP)](https://agentclientprotocol.com). The daemon is the ACP client (Rust crate `agent-client-protocol`), the adapter is the ACP Agent, and they communicate over stdio.

- **Claude Code and Codex**: adapter versions are pinned in `crates/gonggong/src/engine.rs` (`@agentclientprotocol/claude-agent-acp`, `@agentclientprotocol/codex-acp`) and installed into the daemon's local directory from the configured npm mirror on first use.
- **Gemini CLI, CodeBuddy, pi, DeepSeek Harness**: how to install, launch, and drive them is declared by the manifests (`contributes.agents`) of the server's built-in plugins `apps/server/plugins/official/agent-*`; `crates/gonggong/src/adapters.rs` compiles the manifests and launch scripts into the binary.
- Each (group, Bot) has one adapter process and one ACP session (`session.rs`), running one turn at a time. The daemon tries to resume the previous session; if resuming fails, it starts a new session and replays recent group messages.
- `turn.rs` builds the prompt, maps ACP `session/update` to `run.event`, and handles `session/request_permission` according to the Bot's permission tier and approval mode.
- When debugging, `GONGGONG_ADAPTER_CMD` replaces the adapter command for all Agents, for example pointing to `tools/mock-agent/agent.js` (a mock Agent based on `@agentclientprotocol/sdk`).

## Built-in MCP tools

For each session, the daemon runs an MCP server named `gonggong` on the local loopback address (Streamable HTTP, with a per-session secret URL; see `ask.rs`) and injects it into the Agent when the session is created. The tools fall into three groups:

| Group | Examples | Answered by |
| --- | --- | --- |
| Asking group members | `ask_group_members` | The daemon turns it into a question card and waits for a group member's answer or a timeout |
| Server tools (`gonggong-tools.json`) | Chat history (`list_messages`, `search_messages`), groups and runs (`get_group_info`, `get_run`), previews (`preview_expose`), collaboration (`hand_off`, `thread_create`, `progress_card`), schedules (`schedule_*`), Skills (`skill_*`), market (`market_*`), knowledge base (`kb_*`), group tabs (`tab_*`), MCP configuration (`mcp_*`), secrets (`secret_*`), plugins and creation (`plugin_catalog`, `creation_propose`), artifacts (`artifact_checkout`), and more | The daemon forwards the call with the machine token to `POST /api/daemon/runs/:runId/tools/:name`; the server queries, authorizes, and returns text |
| daemon tools (`gonggong-daemon-tools.json`) | `send_attachments`, `service_*`, `preview_static`, `preview_miniprogram`, `html_preview`, `html_render`, `feishu_send_card`, `client_release_publish`, `client_release_notes` | The daemon answers them itself (attachments, hosted services, static sites, mini programs, HTML rendering, and so on) |

Key points:

- The single source of the tools is `packages/protocol/src/tools.ts` (zod), from which the two JSON files are generated. The daemon compiles them into the binary with `include_str!`, and the server validates inputs with zod. `packages/protocol/test/tools.test.ts` asserts that the JSON matches the zod definitions, so when you change a tool definition you must update the JSON too.
- Server tools use the **run in progress** as their credential: the group and Bot are derived from the run, not trusted from parameters, and calls between turns fail immediately. Write operations are authorized as the requester of the current turn, and admin tools are trimmed by the requester's role; groups not bound to Feishu or without the plugin enabled don't list the corresponding tools.
- `service_start`, `preview_miniprogram`, and `client_release_publish` execute code or distribute programs to members' machines, so they go through the Bot's command approval; the other built-in tools are allowed automatically.
- MCP servers configured at the platform, team, and group levels are also injected when a session is created; the name `gonggong` is reserved for the built-in server.

## Preview tunnel

The server multiplexes the browser's HTTP requests and upgraded connections (WebSocket, HMR) for previews onto a single binary WebSocket, `/ws/daemon/tunnel`, and the daemon forwards them locally. Web terminals, workspace file reads, and preview first-screen screenshots also go through this tunnel.

Frame format:

```text
[streamId: u32 大端][type: u8][payload]
```

(`大端` = big-endian.)

| type | Name | payload |
| --- | --- | --- |
| 1 | `open` | JSON: method, path, request headers, whether it's an upgrade, and the target (preview port, read-only workspace file, preview first-screen screenshot, or terminal session) |
| 2 | `head` | JSON: response status and response headers |
| 3 | `data` | Request/response body bytes; raw connection bytes after an upgrade (101) |
| 4 | `end` | Empty; this direction has ended |
| 5 | `reset` | JSON: abort reason; the stream closes immediately |

- Only the server can open streams; each machine has at most 64 concurrent streams (`TUNNEL_MAX_STREAMS`).
- Each stream buffers at most 16 MiB (`TUNNEL_STREAM_BUFFER`). If the reader can't keep up, that stream is reset instead of slowing down the whole connection.
- The daemon only forwards to preview ports opened in `previews.sync`; all other ports are unreachable.
- The TS implementation is in `packages/protocol/src/tunnel.ts` and the Rust implementation in `crates/gonggong/src/tunnel.rs`; both are tested with `cases/tunnel-frames.json` and `fixtures/tunnel.*.json`.

## Related pages

- [Repository structure](/en/dev/structure)
- [Contribution guide](/en/dev/contributing)
- [Architecture](/en/guide/architecture)
