# Protocol

This page describes the communication contracts between Gonggong Space's components: what makes up `packages/protocol`, daemon ⇄ server messages, ACP and the Agent adapters, the built-in MCP tools, and the preview tunnel's binary frames.

## Overview

```text
浏览器 ──REST /api + WS /ws/web──▶ 服务器 ◀──WS /ws/daemon（JSON）── daemon ──ACP（stdio）──▶ Agent 适配器 ──▶ Claude Code / Codex
                                     ▲       WS /ws/daemon/tunnel（二进制帧）   │
                                     └─────── REST /api/daemon/* ◀─────────────┘
                                                                              daemon 内置 MCP（回环 HTTP）◀── Agent
```

In the diagram: 浏览器 = browser, 服务器 = server, Agent 适配器 = Agent adapter, 二进制帧 = binary frames, daemon 内置 MCP（回环 HTTP）= the daemon's built-in MCP (loopback HTTP).

Every TypeScript-side contract is defined with zod in `packages/protocol`, which the server, Web, and desktop app import directly. The Rust side mirrors it by hand in `crates/gonggong/src/protocol.rs`, and shared fixtures keep the two sides consistent.

## What makes up packages/protocol

| File | Contents |
| --- | --- |
| `src/common.ts` | Base types shared by both ends: Agent type (`claude` / `codex`), permission tiers, command approval, run status, attachment and question limits, context usage, etc. |
| `src/web.ts` | Web ⇄ server: REST request/response DTOs (prefix `/api`, sessions via an httpOnly cookie), and the realtime events the server pushes to browsers over `WS /ws/web` (e.g. `message.new`, `run.updated`, `run.delta`) |
| `src/daemon.ts` | daemon ⇄ server: the `DaemonToServer` and `ServerToDaemon` union types discriminated by the `t` field, and `PROTOCOL_VERSION` |
| `src/tunnel.ts` | Preview tunnel frame encoding/decoding and the JSON shapes of the `open` / `head` / `reset` frames |
| `src/tools.ts` | Input definitions for the built-in `gonggong` MCP tools; generates `gonggong-tools.json` and `gonggong-daemon-tools.json` |
| `src/mentions.ts` | Recognizing `@Bot` in messages |
| `src/repo.ts` | Repository URL formats and normalization |
| `src/notification-view.ts` | Notification display text and navigation targets |
| `fixtures/*.json` | Shared samples of the daemon protocol and tunnel frames that both TS and Rust must round-trip |
| `cases/*.json` | Other cross-language shared cases (e.g. tunnel frame encoding, repository URL normalization) |

## daemon ⇄ server

The daemon connects to `WS /ws/daemon` with its machine token. Every message is a JSON object with a `t` field.

- **Handshake**: the daemon sends `hello` (protocol version, token, daemon version, machine info, Agent list, runs still executing); the server replies with `welcome` (machine id, heartbeat interval, available new version, whether the preview tunnel is enabled), or with `reject` (reason `protocol` / `revoked` / `unauthorized`, with upgrade info attached when the protocol is incompatible).
- **Server → daemon** (`s2d`): `run.start`, `run.cancel`, `run.append`, `run.tier`, `approval.decision`, `question.answer`, `workspace.ensure`, `workspace.cd`, `workspace.diff`, `files.*`, `dir.list`, `repo.probe`, `previews.sync`, `cast.*`, `tools.cmd`, `providers.cmd`, `ccswitch.*`, `service.*`, and more.
- **daemon → server** (`d2s`): `heartbeat`, `run.event` (streaming events such as text, thinking, tool calls, and usage), `run.done`, `approval.request`, `question.ask`, `workspace.state`, `session.config`, `commands.update`, `agents.update`, the various `*.result` messages, and more.

A few requests go over REST instead (`/api/daemon/*`, authenticated with the machine token), such as login binding, built-in MCP tool calls, network measurement, and downloading attachments and upgrade packages.

### Fixture round-trip tests

Every message type has at least one sample under `packages/protocol/fixtures/`. File names follow `<direction>.<message type>[.<variant>].json`, where direction is `d2s`, `s2d`, or `tunnel`, e.g. `d2s.run.event.tool.json`, `s2d.run.start.json`.

Each side has a test that walks the whole directory:

- TS: `packages/protocol/test/fixtures.test.ts` parses every sample with zod and checks that the file name matches the message's `t` field.
- Rust: `crates/gonggong/tests/contract.rs` deserializes and re-serializes every sample and requires the result to match the original (ignoring `null` fields); it also verifies the frame encoding in `cases/tunnel-frames.json`.

So when the protocol changes, update `packages/protocol` first, then add fixtures for new messages or fields, and finally update `protocol.rs`. The change is done only when both `pnpm -r test` and `cargo test --workspace` pass.

## ACP and Agent adapters

The daemon doesn't call Claude Code or Codex directly; it drives the official adapters through the [Agent Client Protocol (ACP)](https://agentclientprotocol.com). The daemon is the ACP client (Rust crate `agent-client-protocol`), the adapter is the ACP Agent, and they communicate over stdio.

- Adapter versions are pinned in `ADAPTERS` in `crates/gonggong/src/engine.rs` (`@agentclientprotocol/claude-agent-acp`, `@agentclientprotocol/codex-acp`) and installed from the configured npm mirror into the daemon's local directory on first use.
- Each (group, Bot) maps to one adapter process and one ACP session (`session.rs`), running one turn at a time. The daemon tries to resume the previous session; if that fails, it starts a new session and resends recent group messages.
- `turn.rs` builds the prompt, maps ACP `session/update` to `run.event`, and handles `session/request_permission` according to the Bot's permission tier.
- For debugging, `GONGGONG_ADAPTER_CMD` replaces the adapter command for all Agents, e.g. pointing it at `tools/mock-agent/agent.js` (a mock Agent built on `@agentclientprotocol/sdk`).

## Built-in MCP tools

For each session, the daemon opens an MCP server named `gonggong` on the local loopback address (Streamable HTTP, with a separate secret URL per session; see `ask.rs`) and injects it into the Agent when the session is created. The tools fall into three categories:

| Category | Tools | Answered by |
| --- | --- | --- |
| Asking group members | `ask_group_members` | The daemon turns it into a question card and waits for group members to answer or for it to time out |
| Server tools (`gonggong-tools.json`) | `list_messages`, `search_messages`, `get_group_info`, `get_run`, `list_questions`, `fetch_attachments`, `list_feishu_messages`, `preview_expose`, `preview_gui`, `preview_close`, `hand_off`, `schedule_create`, `schedule_list`, `schedule_update`, `schedule_delete`, `skill_list`, `skill_get`, `skill_create`, `skill_update`, `skill_delete`, `skill_toggle`, `skill_versions`, `skill_rollback` | The daemon forwards the call with its machine token to `POST /api/daemon/runs/:runId/tools/:name`; the server queries, authorizes, and returns text |
| daemon tools (`gonggong-daemon-tools.json`) | `service_start`, `service_list`, `service_logs`, `service_stop`, `preview_static`, `preview_miniprogram` | The daemon answers them itself (managed services, static sites, mini programs) |

Key points:

- The single source of truth for the tools is `packages/protocol/src/tools.ts` (zod); both JSON files are generated from it. The daemon compiles them into the binary with `include_str!`, and the server validates inputs with zod. `packages/protocol/test/tools.test.ts` asserts that the JSON matches the zod definitions, so if you change a tool definition you must update the JSON too.
- Server tools use the **in-progress run** as the credential: the group and Bot are derived from the run, not trusted from the arguments. Calls made between turns fail immediately.
- The `skill_*` writes (create, update, delete, toggle, roll back) are authorized as the run's originator: the group layer needs a group admin, the team layer a team admin, and the platform layer is read-only. Changes take effect next turn.
- Except for `service_start` and `preview_miniprogram` (which execute code) and so go through the Bot's command approval, all other built-in tools are allowed automatically.
- Global MCP servers that admins add in the configuration center are also injected when a session is created; the name `gonggong` is reserved for the built-in server.

## Preview tunnel

The server multiplexes browsers' HTTP requests and upgraded connections (WebSocket, HMR) for previews onto a single binary WebSocket, `/ws/daemon/tunnel`, and the daemon forwards them to local loopback ports.

Frame format:

```text
[streamId: u32 大端][type: u8][payload]
```

(`大端` = big-endian.)

| type | Name | payload |
| --- | --- | --- |
| 1 | `open` | JSON: method, path, request headers, whether it's an upgrade, and the target (preview port, read-only workspace file, preview first-screen screenshot) |
| 2 | `head` | JSON: response status and response headers |
| 3 | `data` | Request/response body bytes; after an upgrade (101), raw connection bytes |
| 4 | `end` | Empty; marks the end of that direction |
| 5 | `reset` | JSON: abort reason; the stream closes immediately |

- Only the server can open streams; each machine allows at most 64 concurrent streams (`TUNNEL_MAX_STREAMS`).
- A single stream buffers at most 16 MiB (`TUNNEL_STREAM_BUFFER`). When the reader can't keep up, that stream is reset rather than slowing down the whole connection.
- The daemon only forwards the enabled preview ports listed by `previews.sync`; all other ports are unreachable.
- The TS implementation is in `packages/protocol/src/tunnel.ts` and the Rust implementation is in `crates/gonggong/src/tunnel.rs`; both are tested against `cases/tunnel-frames.json` and `fixtures/tunnel.*.json`.

## Related pages

- [Repository structure](/en/dev/structure)
- [Contributing guide](/en/dev/contributing)
- [Architecture](/en/guide/architecture)
