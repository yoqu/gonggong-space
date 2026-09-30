# Repository structure

This page explains what each directory in the repo is responsible for, and how the work is divided among the server's domain modules, the Web feature directories, and the daemon modules.

## Top-level directories

| Directory | Responsibility |
| --- | --- |
| `apps/web` | Web client (React + Vite). `src/ui/` holds the design system components, `src/features/<domain>/` organizes pages and components by domain, and `src/app/` is the application shell |
| `apps/server` | Server (Fastify + Drizzle + PostgreSQL). `src/modules/<domain>/` organizes routes and services by domain; `src/db/schema.ts` is the single table definition, with migrations in `drizzle/`; `src/daemon/` is the daemon WebSocket gateway, and `src/realtime/` is the realtime channel pushed to browsers |
| `apps/desktop` | The desktop app 「共工空间」 (Tauri). `src/` is the React UI and `src-tauri/` is the Rust shell, which depends directly on `crates/gonggong` to run the daemon in-process |
| `crates/gonggong` | The daemon and `gg` CLI (binary name `gg`) that run on members' machines; integration tests live in `tests/` |
| `packages/protocol` | Every wire contract (zod): Web ⇄ server APIs, daemon ⇄ server messages, preview tunnel frames, and built-in MCP tools. `fixtures/*.json` are shared samples of the daemon protocol that both TS and Rust must round-trip; `cases/` holds other cross-language shared cases |
| `tools/mock-agent` | A scriptable ACP Agent. The daemon tests and some end-to-end tests use it in place of a real Agent; its behavior is chosen by the prompt (e.g. `mock:echo`, `mock:slow`, `mock:crash`) |
| `tools/mcp-echo` | A minimal stdio MCP server (a single `echo` tool) that end-to-end tests use to verify MCP injection |
| `e2e` | Playwright end-to-end tests: real server + Web + daemon + Agent |
| `scripts` | Development and operations scripts: `pg.sh` (in-repo PostgreSQL), `dev-cert.sh` (self-signed dev certificate), `backup.sh` / `restore.sh`, `release.sh`, and more |
| `website` | This help manual (VitePress) |
| `docs` | Requirements and design documents, kept as background reference; where they conflict with the code, the code wins |

## Server domain modules

Located in `apps/server/src/modules/`. Each directory usually contains `routes.ts` (HTTP/WS routes) and `service.ts` (business logic).

| Module | Responsibility |
| --- | --- |
| `admin` | Admin console: system parameters (`params.ts`) and audit log queries |
| `agent-tools` | The built-in MCP tools answered by the server (reading chat history, group info, run records, etc.); the daemon forwards calls using the in-progress run as the credential |
| `approvals` | Approvals: creating, approving, denying, and voiding an Agent's out-of-tier requests |
| `attachments` | Uploading, storing, and downloading message attachments |
| `auth` | Login, sessions, registration, and creating `admin` on first startup (`bootstrap.ts`) |
| `bots` | Creating, updating, and deleting Bots, binding them to machines, permission tiers, and Agent configuration |
| `candidates` | @ candidates in the message box: fetches the workspace file list from the Bot's daemon, falling back to a cache when it is slow or offline |
| `commands` | Parsing and executing in-group commands (`/cd`, stop, system commands, Agent commands) |
| `git-accounts` | Members' Git hosting accounts (tokens), used for repository access |
| `groups` | Groups and direct chats: members, Bots, settings, repositories, titles |
| `live` | Live view for previews (LiveKit): watching, control, and gg-cast status |
| `machines` | Machine binding, logout, details, network measurement, and Agent tools read and written live through the daemon |
| `mcp` | Global MCP servers configured by admins and injected when a session is created (the name `gonggong` is reserved for the built-in server) |
| `messages` | Sending, quoting, and recalling messages, and appending during a run |
| `notifications` | Notification center and Web Push |
| `previews` | Previews: tunnels, gateway proxy, managed services, public share links |
| `providers` | A machine's model providers: only forwarded live to the daemon, never written to the database |
| `questions` | Question cards that a Bot sends to group members, and their answers |
| `reactions` | Emoji reactions on messages |
| `releases` | Client releases: uploading daemon builds for daemons to download when self-upgrading |
| `repos` | Team repository history and repository accessibility probes |
| `runs` | The core of runs: triggering, scheduling, receiving daemon reports, redaction, stopping, reconciliation, and retention cleanup |
| `search` | Global search (messages, changed files) |
| `usage` | Usage statistics |
| `users` | User profile cards, deactivation |
| `workspaces` | The workspace for each (group, Bot): preparation, `/cd`, file browsing, diff, and status |

## Web feature directories

Located in `apps/web/src/features/`.

| Directory | Contents |
| --- | --- |
| `admin` | Admin console layout and pages (accounts, groups, machines, system parameters, client releases, audit) |
| `attachments` | Message box attachments, message attachment display, and the viewer |
| `auth` | Login, registration, password change, avatar menu |
| `bots` | New Bot, Bot settings, Agent configuration, the Bot direct chat page, personality role avatars, the admin Bot page |
| `chat` | Main group message view: message timeline, message box and candidates, Git bar, context usage, new group |
| `config` | Admin console · configuration center |
| `diff` | Diff panel |
| `files` | File viewer |
| `groups` | Group info, group announcements, group settings |
| `machines` | Bind new machine, machine details, Agent tools, provider editing and import, unbinding |
| `notifications` | Notification center and browser push |
| `previews` | Preview cards, live view, share links, the admin public link page |
| `reactions` | Emoji reactions |
| `repos` | Repository picker and repository access check |
| `runs` | Run card pieces: process panel, approvals, questions, interrupt and append |
| `search` | Search overlay |
| `settings` | Personal settings |
| `usage` | Usage page |
| `users` | User card (profile on hover) |
| `workbench` | Tabs in the right-hand workbench (run, diff, files, web page, mini program, live view) |
| `workspaces` | Workspace and directory picker |

## Main daemon modules

Located in `crates/gonggong/src/`. `main.rs` is the `gg` CLI entry point, and `lib.rs` collects the modules so the desktop app can reuse them.

| Module | Responsibility |
| --- | --- |
| `daemon.rs` | Top-level daemon handle (shared by `gg run` and the desktop app): single-instance lock, service and engine, revocation cleanup, live status |
| `service.rs` | WebSocket connection to the server, sending and receiving, and a byte-capped send buffer |
| `engine.rs` | Executes runs dispatched by the server; one ACP adapter process per (group, Bot); installs pinned adapter versions |
| `session.rs` | A single (group, Bot) session: adapter process, ACP session, and turns |
| `turn.rs` | Pure per-turn logic: building the prompt, mapping ACP updates to run events, permission tier policy |
| `permission.rs` | Detecting macOS Screen Recording and Accessibility permissions (used by previews) |
| `protocol.rs` | Wire types matching `packages/protocol` |
| `ask.rs` | Built-in `gonggong` MCP server (local loopback, a separate URL per session): asking group members questions, forwarding server tools, answering daemon tools |
| `mcp_call.rs` | Parses MCP tool calls from ACP updates (Claude and Codex use different formats) |
| `agents.rs` | Detects installed Agent CLIs and their versions |
| `tools.rs` | Managed installation of Node.js, Claude Code, and Codex (no sudo, global npm untouched) |
| `manage.rs` | Answers server requests for Agent tools, providers, and CC Switch |
| `providers.rs` | Local model provider storage (`providers.json`; always masked when sent out) |
| `provider_cli.rs` | The `gg provider` subcommand |
| `inject.rs` | Injects the provider used by a run into the adapter process (keys never appear in command-line arguments or logs) |
| `ccswitch.rs` | Read-only import of providers from the local CC Switch |
| `local.rs` | Local settings (`local.json`): Agent CLI paths, command approval rules, model catalog |
| `configure.rs` | The `gg agents` and `gg config` subcommands |
| `config.rs` | Local state root (`~/.gonggong`, overridable with `GONGGONG_HOME`) and binding info |
| `bind.rs` | Local machine info and machine identifier reported to the server |
| `bots.rs` | `gg bots`: lists the Bots bound to this machine |
| `workspace.rs` | The workspace for each (group, Bot): managed clone, `/cd` binding, directory picking |
| `git.rs` | Workspace git operations (calls the local `git`, reusing local credentials) |
| `repo.rs` | Remote repository identification and access probing (ssh ⇄ https fallback) |
| `files.rs` | @ file candidates |
| `explorer.rs` | Read-only workspace file browsing and path validation |
| `attachments.rs` | Saves attachments to the workspace's `.gonggong/attachments/` |
| `tunnel.rs` | Preview tunnel binary frames and forwarding |
| `previews.rs` | Local preview and managed service lists (used by the desktop app) |
| `hosted.rs` | Managed services (such as dev servers) whose processes are owned by the daemon and outlive a single turn |
| `static_site.rs` | Serves a workspace directory as a static site on the loopback address |
| `snapshot.rs` | Renders a first-screen screenshot of a preview with a local Chrome-family browser |
| `cast.rs` | Live view: starts gg-cast on demand to stream a window to LiveKit |
| `wechatide.rs` | WeChat DevTools: opens mini program projects and captures the simulator screen |
| `tls.rs` | HTTPS/WSS connection to the server, pinned by the certificate's SHA-256 fingerprint; plain http is only allowed for loopback addresses |
| `net.rs` | Measures latency and bandwidth to the server |
| `upgrade.rs` | Self-upgrade: downloads the new version, verifies sha256, replaces itself, and restarts |
| `revoke.rs` | Cleans up managed workspaces and tokens after the machine is revoked |
| `diag.rs` | `gg doctor` self-check and redacted diagnostics bundle |
| `logs.rs` | daemon logs (daily rotation + in-memory ring buffer) |
| `status.rs` | Live status for the UI: connection, heartbeat, latency, runs in progress |
| `lock.rs` | Only one daemon per local directory (file lock) |
| `coalesce.rs` | Coalesces concurrent requests with the same key into a single computation |

## Related pages

- [Contributing to development](/en/dev/)
- [Protocol](/en/dev/protocol)
- [Architecture](/en/guide/architecture)
