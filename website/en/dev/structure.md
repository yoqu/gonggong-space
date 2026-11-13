# Repository structure

This page explains what each directory in the repository is responsible for, and how work is divided among the server's domain modules, the web feature directories, the desktop app, and the daemon modules.

## Top-level directories

| Directory | Responsibility |
| --- | --- |
| `apps/web` | Web client (React + Vite). `src/ui/` holds the design system components, `src/features/<domain>/` organizes pages and components by domain, `src/app/` is the app shell (sidebar, layout, workbench), and `src/i18n/` is i18n |
| `apps/server` | Server (Fastify + Drizzle + PostgreSQL). `src/modules/<domain>/` organizes routes and services by domain; `src/db/schema.ts` is the single table definition, with migration files in `drizzle/`; `src/daemon/` is the daemon WebSocket gateway, and `src/realtime/` is the real-time channel to browsers; `plugins/official/` holds the built-in plugins; `install/` holds the install scripts for member machines and the 「发给你的 Agent」 (Send to your agent) connection instructions |
| `apps/desktop` | Desktop app 「共工空间」 (Tauri). `src/` is the React UI (which imports the web source and components directly), and `src-tauri/` is the Rust shell, which depends on `crates/gonggong` to run the daemon in-process |
| `crates/gonggong` | The daemon and `gg` command line on member machines (binary name `gg`). `presets/` holds built-in model provider presets, `skills/` holds built-in Skills, and integration tests are in `tests/` |
| `crates/gg-cast` | The live view streaming component gg-cast; not part of the Cargo workspace and built separately |
| `packages/protocol` | All wire contracts (zod): web ⇄ server APIs, daemon ⇄ server messages, preview tunnel frames, built-in MCP tools, the plugin manifest, and the i18n core. `fixtures/*.json` are shared samples of the daemon protocol that both TS and Rust must round-trip; `cases/` holds other cross-language shared cases |
| `tools/mock-agent` | A scriptable ACP Agent used instead of real Agents in daemon tests and some end-to-end tests; it decides what to do from the prompt (such as `mock:echo`, `mock:slow`, `mock:crash`) |
| `tools/mcp-echo` | A minimal stdio MCP server (with a single `echo` tool) that tests use to verify MCP injection |
| `examples/plugins` | Plugin example (`dashboard`), demonstrating the `gonggong-plugin.json` manifest and a Skill bundled with a plugin |
| `e2e` | Playwright end-to-end tests: real server + web client + daemon + Agent |
| `scripts` | Development and operations scripts: `pg.sh` (project-local PostgreSQL), `check.sh` (pre-push self-check), `dev-cert.sh` (self-signed dev certificate), `backup.sh` / `restore.sh`, `release.sh` and `release/` (packaging and release), `docker/` (nginx and startup scripts for the server image), `gui-e2e.sh` / `linux-e2e.sh`, and more |
| `docker/daemon` | Image and Compose file for running a member machine (daemon) in a container |
| `Dockerfile`, `docker-compose.yml` | Server image and one-command deployment |
| `videos` | Source projects for the promo and feature walkthrough videos (HTML animations rendered with hyperframes); each directory has its own instructions |
| `website` | This help manual (VitePress); `scripts/` holds the screenshot scripts |
| `docs` | Requirements, design, and release notes (`release-notes/`), for background reference; where they conflict with the code, the code wins |

## Server domain modules

Located in `apps/server/src/modules/`. Each directory usually contains `routes.ts` (HTTP/WS routes) and `service.ts` (business logic).

| Module | Responsibility |
| --- | --- |
| `admin` | Admin console: system parameters (`params.ts`), audit log, and more |
| `agent-tools` | Built-in MCP tools answered by the server (reading chat history, group info, run records, market, knowledge base, and so on); the daemon forwards calls using the run in progress as its credential |
| `approvals` | Permission approvals: creating, approving, rejecting, and voiding Agent requests that exceed its permissions |
| `artifacts` | Managed artifacts and the multi-screen canvas: versions, annotations, sharing |
| `attachments` | Uploading, storing, and downloading message attachments |
| `auth` | Sign-in, sessions, registration, and creating `admin` on first startup (`bootstrap.ts`) |
| `avatars` | Avatar upload (including using the Feishu avatar) |
| `bots` | Bot CRUD, assigned machine, permission tier, approval mode and Agent configuration, sharing |
| `candidates` | @ suggestions in the input box: fetches the workspace file list from the Bot's daemon, using a cache when it's slow or offline |
| `commands` | Parsing and executing group commands (`/cd`, stop, system commands, Agent commands) |
| `conversation-stats` | Conversation statistics |
| `feishu` | Feishu apps, sign-in, group binding, cards, and message sync |
| `git` | Git management on the web (branches, log, commits, diffs, conflicts, and so on), forwarded to the Bot's machine for execution |
| `git-accounts` | Members' Git hosting accounts (tokens) used for repository access |
| `group-tabs` | Custom tabs at the top of a group |
| `groups` | Groups and direct chats: members, Bots, settings, repositories |
| `knowledge` | Group knowledge base entries and versions |
| `live` | Live views (LiveKit): watching, control, and gg-cast status |
| `machines` | Machine binding, connection confirmation, details, upgrades, Git access, network measurement, and Agent tools read and written live through the daemon |
| `market` | Skill market: listing, review, installs, and bans |
| `mcp` | MCP server configuration at three levels (platform, team, group), injected when a session is created (the name `gonggong` is reserved for the built-in server) |
| `messages` | Sending, quoting, and recalling messages, and appending during a run |
| `notifications` | Notification center and Web Push |
| `pins` | Pinned group messages |
| `plugins` | Plugin upload, enabling, machine authorization, built-in plugins, and creation |
| `previews` | Previews: tunnel, gateway proxy, hosted services, public share links |
| `providers` | Machine model providers: only forwarded live to the daemon, never written to the database |
| `questions` | Cards and answers for Bots asking group members questions |
| `reactions` | Message emoji reactions |
| `releases` | Client releases: uploading daemon and desktop builds for auto-upgrade downloads |
| `repos` | Team repository history and repository accessibility probing |
| `runs` | The core of runs: triggering, scheduling, receiving daemon reports, redaction, stopping, reconciliation, and retention cleanup |
| `saved` | 「稍后处理」 (Later): saved messages and reminders |
| `schedules` | Schedules |
| `search` | Global search (messages, changed files) |
| `secrets` | Secrets at four levels: platform, team, group, personal |
| `sidebar` | Custom groupings in the conversation list |
| `skills` | Team, group, repository, and personal Skills and their versions |
| `sync` | Forced sync: versions, file chunks, and conflict handling when several machines in a group share one workspace |
| `team-sections` | Team directory and join requests |
| `teams` | Teams and members |
| `terminals` | Web terminal sessions |
| `threads` | Threads |
| `usage` | Usage statistics |
| `users` | User profile cards, disabling |
| `workspaces` | The workspace of each (group, Bot): preparation, `/cd`, file browsing, diff, and status |

## Web feature directories

Located in `apps/web/src/features/`. Each directory has its own English dictionary `en.ts`.

| Directory | Contents |
| --- | --- |
| `admin` | Admin console layout and pages (accounts, teams, groups, machines, schedules, system parameters, client releases, audit) |
| `artifacts` | Artifacts and the prototype canvas |
| `attachments` | Input box attachments, message attachment display, and viewers (including the video player) |
| `auth` | Sign-in, registration, password change, avatar menu |
| `bots` | New Bot, Bot settings, Agent configuration, Bot page, avatars |
| `chat` | The main group message view: message timeline, input box and suggestions, Git bar, context usage, new group |
| `config` | Admin console · configuration center |
| `conversation-stats` | Conversation statistics |
| `diff` | Diff pane |
| `feishu` | Feishu settings and binding |
| `files` | File viewer |
| `git` | Git panel: commits, log, branches, conflict resolution, stash |
| `group-tabs` | Tabs at the top of a group |
| `groups` | Group info, group announcement, group settings |
| `knowledge` | Knowledge base |
| `machines` | My machines and Bots, bind new machine, machine details, Agent tools, providers, storage management |
| `market` | Skill market |
| `notifications` | Notification center and browser push |
| `onboarding` | New-user onboarding |
| `plugins` | Plugin management and the creation panel |
| `previews` | Preview cards, live views, share links, the admin public links page |
| `reactions` | Emoji reactions |
| `repos` | Repository picker and repository access checks |
| `rich` | Rich content in Bot replies (HTML pages, Mermaid diagrams, action buttons) |
| `runs` | Run cards and run details: process, context, approvals, questions, interrupt and append |
| `saved` | Later |
| `schedules` | Schedules |
| `search` | Search overlay |
| `secrets` | Secrets |
| `settings` | Personal settings |
| `sync` | Forced-sync status bar, sync panel, and conflict handling |
| `teams` | Teams |
| `terminal` | Terminal |
| `usage` | Usage page |
| `users` | User cards (hover profiles) |
| `workbench` | Tabs of the right-hand workbench (runs, diff, files, web, mini program, live view, and more) |
| `works` | Works library |
| `workspaces` | Workspace and directory picker |

## Desktop app

| Location | Contents |
| --- | --- |
| `apps/desktop/src/pages/` | Pages: Overview, Agent, Bot, Workspaces, Tunnels & services, Live views, Market, Logs & diagnostics, Settings, and run details |
| `apps/desktop/src/onboarding/` | First-run setup (binding) |
| `apps/desktop/src/shell/`, `providers/` | Window shell, provider editing |
| `apps/desktop/src-tauri/src/commands/` | Tauri commands for each page, calling into `crates/gonggong` |
| `apps/desktop/test/` | Desktop UI tests (Vitest, with IPC mocked by `ipc-mock.ts`) |

## Main daemon modules

Located in `crates/gonggong/src/`. `main.rs` is the `gg` command-line entry point, and `lib.rs` collects the modules for reuse by the desktop app.

| Module | Responsibility |
| --- | --- |
| `daemon.rs` | The overall daemon handle (shared by `gg run` and the desktop app): single-instance lock, service and engine, revocation cleanup, live status |
| `service.rs` | The WebSocket connection to the server: sending, receiving, and a byte-capped send buffer |
| `engine.rs` | Executes runs sent by the server; one ACP adapter process per (group, Bot); installs pinned versions of the Claude Code / Codex adapters |
| `adapters.rs` | Adapters declared by the built-in Agent plugin manifests (Gemini CLI, CodeBuddy, pi, DeepSeek Harness), with manifests compiled into the binary |
| `session.rs` | A single (group, Bot) session: adapter process, ACP session, and turns |
| `turn.rs` | Pure per-turn logic: building prompts, mapping ACP updates to run events, permission tier policy |
| `review.rs` | AI pre-review for 「帮我审批」 (Review for me) |
| `ledger.rs` | Estimates what makes up a session's context (the 「上下文」 (Context) tab in run details) |
| `web_call.rs` | Recognizes web searches and web fetches in a run |
| `ask.rs` | The built-in `gonggong` MCP server (local loopback, per-session URL): asking group members, forwarding server tools, answering daemon tools |
| `mcp_call.rs` | Parses MCP tool calls in ACP updates (each Agent uses a different format) |
| `protocol.rs` | Wire types corresponding to `packages/protocol` |
| `agents.rs` | Detects installed Agent CLIs and their versions |
| `tools.rs` | Managed installs of Node.js and Agent CLIs (no sudo, no global npm changes) |
| `manage.rs` | Answers Agent tool, provider, and CC Switch requests from the server |
| `providers.rs`, `provider_cli.rs` | Local model provider storage (`providers.json`, always masked when sent out) and the `gg provider` subcommand |
| `inject.rs` | Injects the run's provider into the adapter process (keys never go into command-line arguments or logs) |
| `agent_settings.rs`, `claude_args.rs` | Agent settings, Claude Code command-line arguments |
| `ccswitch.rs` | Read-only import of providers from the local CC Switch |
| `skills.rs`, `plugins.rs` | Places the Skill and plugin versions a run uses on the local machine and hands them to the Agent |
| `local.rs` | Local settings (`local.json`): Agent CLI paths, command approval rules, model catalog |
| `configure.rs` | The `gg agents` and `gg config` subcommands |
| `config.rs` | Local state root (`~/.gonggong`, overridable with `GONGGONG_HOME`), binding info, and certificate trust |
| `bind.rs` | Binding login, web-confirmed connection, the local machine info reported to the server, and the machine identifier |
| `autostart.rs` | `gg service`: keeps the daemon running and starts it at login with launchd (macOS) or a systemd user unit (Linux) |
| `bots.rs` | `gg bots`: lists Bots bound to this machine |
| `workspace.rs`, `layout.rs` | The workspace of each (group, Bot): managed clones, `/cd` binding, directory picking; managed workspaces live at `~/gonggong/workspaces/<group>/<Bot>/<repo>` |
| `janitor.rs` | Background cleanup of state left by groups and Bots that no longer exist, long-unused plugin versions, and old runtimes |
| `git.rs`, `git_ops.rs`, `git_write.rs`, `git_console.rs` | Workspace Git status, read-only views, write operations started from the web, and their command log (using the local `git`) |
| `git_access.rs` | Machine Git access managed from the web: SSH keys, HTTPS tokens, access tests |
| `repo.rs` | Remote repository identity and access probing (ssh ⇄ https fallback) |
| `sync.rs`, `sync/`, `replicas.rs` | Forced sync: manifests, file chunk transfer, three-way merge, and catching up and committing before and after runs |
| `artifacts.rs` | Syncing and committing managed artifacts on the local machine |
| `files.rs`, `explorer.rs` | @ file suggestions, read-only workspace file browsing, and path validation |
| `attachments.rs` | Saves attachments into the workspace's `.gonggong/attachments/` |
| `terminal.rs` | PTY sessions for the web terminal |
| `tunnel.rs` | Preview tunnel binary frames and forwarding |
| `previews.rs`, `hosted.rs`, `static_site.rs` | Local previews and hosted services (processes owned by the daemon that outlive a single turn), static sites |
| `html_render.rs`, `snapshot.rs` | Renders HTML pages and preview first-screen screenshots with a local Chrome-family browser |
| `cast.rs`, `wechatide.rs` | Live views (starting gg-cast streaming on demand), WeChat DevTools |
| `open_apps.rs` | Opens the workspace with local apps |
| `tls.rs` | HTTP(S)/WS(S) connections to the server: verifies certificates with system CAs, `--ca-file`, or `--fingerprint`; `http://` is allowed only for local addresses |
| `net.rs` | Measures latency and bandwidth to the server |
| `upgrade.rs` | Self-upgrade: downloads the new version, verifies its sha256, replaces itself, and restarts when idle |
| `revoke.rs` | Cleans up managed workspaces and tokens after the machine is revoked |
| `diag.rs` | `gg doctor` self-check and the redacted diagnostics bundle |
| `logs.rs` | daemon logs (daily rotation + in-memory ring buffer) |
| `status.rs` | Live status for the UI: connection, heartbeat, latency, runs in progress |
| `lock.rs` | Allows only one daemon per local directory (file lock) |
| `proc.rs` | Child process spawning (no console window on Windows) |
| `i18n.rs`, `i18n/en.rs` | i18n: the `t!` macro and the English dictionary |

## Related pages

- [Contributing to development](/en/dev/)
- [Protocol](/en/dev/protocol)
- [Architecture](/en/guide/architecture)
