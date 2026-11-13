# Local development and testing

This page covers how to run the server, web client, daemon, and desktop app on your machine, plus the commands for the pre-push self-check, the various tests, migrations, and the docs site.

## Prerequisites

- **Node.js 24+** and **pnpm**: just run `corepack enable`; the pnpm version is pinned by the root `package.json`.
- **PostgreSQL** (17 recommended). Only the command-line tools need to be installed; you don't need to start the system service:
  - macOS: Postgres.app or `brew install postgresql@17`. The script finds them automatically, no PATH changes needed.
  - Debian/Ubuntu: `sudo apt install postgresql`, then add `/usr/lib/postgresql/<version>/bin` to your PATH.
- **Rust**: install with rustup; the version is pinned by `rust-toolchain.toml`. Used to build the daemon and the desktop app.
- At least one Agent CLI (Claude Code or Codex), signed in, for real runs and end-to-end tests.

Install dependencies:

```bash
pnpm install
```

## Start the database

```bash
pnpm db:up      # start the project-local PostgreSQL
pnpm db:down    # stop it
```

`scripts/pg.sh` keeps the data inside the repository at `.gonggong-dev/pg`, listens on port **54329** (change it with `GONGGONG_PG_PORT`), and creates two databases, `gonggong` and `gonggong_test`, automatically. It never touches the system PostgreSQL service; multiple git worktrees share the same database under the main checkout.

## Start the server and web client

```bash
GONGGONG_ADMIN_PASSWORD=<initial-password> pnpm dev:server   # listens on 127.0.0.1:8787 by default; restarts on code changes
pnpm dev:web                                      # http://127.0.0.1:5173
```

- The server runs migrations automatically at startup; you don't need to create tables by hand.
- On first startup, `GONGGONG_ADMIN_PASSWORD` creates the `admin` account, which must change its password on first sign-in.
- Adjust the server's listen address with `HOST` and `PORT`.
- The web dev server proxies `/api`, `/ws`, and `/livekit` to the server. Set the upstream address with `GONGGONG_SERVER`, and the port and listen address with `WEB_PORT` and `WEB_HOST`.

For the other server environment variables, see [Environment variables](/en/deploy/env).

## Build and bind the daemon

```bash
cargo build -p gonggong        # produces target/debug/gg
```

1. On the web, open 「绑定新机器」 (Bind new machine) and copy the connect code or connect link.
2. Log in and run:

```bash
./target/debug/gg login --server http://127.0.0.1:5173 --code <bind-code>
# or paste the connect link directly: ./target/debug/gg login '<connect-link>'
./target/debug/gg run
```

`http://` is only allowed for local addresses (`localhost`, `127.0.0.1`, and so on); LAN or remote servers must use `https://`. See [HTTPS development](#https-development) below.

::: tip Running several daemons on one machine
The daemon's local state lives in `~/.gonggong` by default. Setting `GONGGONG_HOME` (and `GONGGONG_MACHINE_ID`) lets you run several isolated daemons on the same machine; that's how the end-to-end tests do it.
:::

::: tip Without calling a real Agent
When debugging the daemon, you can replace the real adapter with the mock Agent bundled in the repository, so no model quota is used:

```bash
GONGGONG_ADAPTER_CMD="node tools/mock-agent/agent.js" ./target/debug/gg run
```

The mock Agent decides what to do from the prompt, for example `mock:echo`, `mock:slow`, `mock:crash`, `mock:exec <command>`. See the header of `tools/mock-agent/agent.js` for the full list.
:::

## Desktop app development

```bash
pnpm --filter @gonggong/desktop tauri dev
```

The desktop app's UI is in `apps/desktop/src` and imports the web source (`apps/web/src`) directly through aliases; the Rust shell `apps/desktop/src-tauri` runs the `crates/gonggong` daemon in-process. When you change shared code such as `apps/web/src/ui/`, check the desktop app too.

## HTTPS development

To debug the HTTPS path, or to let other machines on your LAN connect, start with a certificate:

```bash
bash scripts/dev-cert.sh        # generate a self-signed certificate (covers localhost, 127.0.0.1, and this machine's LAN IP)
```

By default the script writes the certificate to `.gonggong-dev/tls/` and prints `GONGGONG_TLS_CERT=… GONGGONG_TLS_KEY=…`.

```bash
export GONGGONG_TLS_CERT=… GONGGONG_TLS_KEY=…     # paste the values printed in the previous step
GONGGONG_ADMIN_PASSWORD=<initial-password> pnpm dev:server
WEB_HOST=0.0.0.0 pnpm dev:web                    # the server and web client share this certificate
```

The daemon verifies the server certificate, against the system CAs by default. For a self-signed certificate, explicitly trust its SHA-256 fingerprint:

```bash
openssl x509 -in .gonggong-dev/tls/cert.pem -noout -fingerprint -sha256
./target/debug/gg login --server https://127.0.0.1:5173 --code <bind-code> --fingerprint <fingerprint-printed-above>
```

For certificates issued by a private CA, use `--ca-file <CA certificate.pem>`. For local debugging only, you can also set `GONGGONG_INSECURE_DEV=1` to turn off certificate verification (the daemon prints a warning; don't use it anywhere else). See [HTTPS and certificates](/en/deploy/https).

## Pre-push self-check: pnpm check

```bash
pnpm check          # typecheck + lint + tests selected by your changes
pnpm check --all    # typecheck + lint + full test suite
```

`scripts/check.sh` diffs against the merge base with `origin/main`; uncommitted and untracked files also count as changes:

- It always runs `pnpm typecheck` and `pnpm lint`.
- For the web client and server, it only runs test files **with the same name or in the same domain as the changed files** (for example, if you changed files under `features/market/`, it runs tests with `market` in their names). If no matching test is found, it runs the package's full suite. Changes to the web client also run the desktop app tests.
- For the daemon, it filters `cargo test` by module; changes to `lib.rs`, `main.rs`, `Cargo.toml`, and similar run everything.
- Changes to `packages/protocol`, lockfiles, root config, or `scripts/` are treated as `--all`.
- When only docs (`*.md`, `docs/`, `website/`, `videos/`) or `e2e/` change, no tests run.
- If `.internal-patterns` exists locally, it first checks that no internal addresses have slipped into the repository.

Heavy jobs such as `cargo test` and whole-package Vitest queue through `/tmp/gonggong-check.lock`, so several checkouts running self-checks at the same time don't starve each other. When the machine is under heavy load, parallel tests occasionally time out; rerun failed cases individually to confirm, and never just ignore them.

## Tests

| Command | What it runs |
| --- | --- |
| `pnpm check` / `pnpm check --all` | Pre-push self-check, see above |
| `pnpm test` | Everything: `tools/*.test.mjs` + Vitest in all packages + `cargo test --workspace` |
| `pnpm -r test` | Vitest in all pnpm packages (protocol, server, web, desktop) |
| `cargo test --workspace` | Rust tests for the daemon and desktop app, including protocol fixture round-trips |
| `pnpm typecheck` | TypeScript type checking for all packages |
| `pnpm lint` | Biome checks (`biome check .`) |
| `pnpm e2e` | Playwright end-to-end tests |

Run one package only: `pnpm --filter @gonggong/server test`; run one file only: `pnpm --filter @gonggong/server exec vitest run test/groups.test.ts`.

Server tests need the database running (run `pnpm db:up` first). Most daemon integration tests are in `crates/gonggong/tests/it/` and compile into a single test binary; run a subset with `cargo test -p gonggong --test it <name>`.

### What end-to-end tests need

`pnpm e2e` uses `e2e/playwright.config.ts` and automatically:

- Recreates the `gonggong_e2e` database and starts the server on port 8790 (with a fixed test value as the initial admin password);
- Starts the web client on port 5190, with the browser locale `zh-CN`;
- Builds the daemon with `cargo build -p gonggong` and runs `gg run` for each "member machine" with its own temporary `GONGGONG_HOME`.

Most cases drive **real Agents**, so Claude Code and Codex must be installed and signed in on your machine (Codex cases reuse the login in `~/.codex/auth.json`; set the model with `GONGGONG_E2E_CODEX_MODEL`). Real Agents depend on external model services, so failures are retried once automatically. Preview and similar cases use `tools/mock-agent`, and MCP injection cases use `tools/mcp-echo`.

Several other configurations run on demand:

| Scenario | Command |
| --- | --- |
| HTTPS path | `GONGGONG_E2E_TLS=1 pnpm exec playwright test -c e2e/tls.config.ts` |
| Real terminal | `GONGGONG_E2E_TERMINAL=1 pnpm exec playwright test -c e2e/terminal.config.ts` |
| Forced sync across two machines (requires another machine reachable over SSH; see the header of `e2e/two-machines.spec.ts` for the required variables) | `pnpm exec playwright test -c e2e/remote.config.ts` |
| Linux desktop preview (requires Docker) | `bash scripts/gui-e2e.sh` |
| Linux daemon integration (requires Docker) | `bash scripts/linux-e2e.sh` |

## Server test database helpers

Server tests live in `apps/server/test/` and, by convention, use two helpers; don't create data through other features' HTTP flows:

- `createTestDb()` in `test/support/db.ts`: creates a randomly named, fully migrated, isolated database for each test file and drops it on `close()`.
- `createTestApp()` in `test/support/app.ts`: starts the real app on a random port, connected to a fresh test database, and provides seed helpers `seed` that write to the database directly (`seed.user()`, `seed.team()`, `seed.machine()`, `seed.bot()`, `seed.group()`, `seed.cookie()`). The first user created gets a default team, and users, groups, and Bots created afterward join it by default.

```ts
import { createTestApp } from './support/app.js'

const t = await createTestApp()
const owner = await t.seed.user()
```

`test/support/` also has helpers for Git, forced sync, artifacts, and other scenarios (such as `git-daemon.ts`, `sync.ts`, `artifacts.ts`); reuse them when writing similar tests.

## Database migrations

Tables are defined only in `apps/server/src/db/schema.ts`. After changing it, generate a migration:

```bash
pnpm --filter @gonggong/server db:generate
```

Migration files are generated into `apps/server/drizzle/` and applied automatically when the server starts. Don't rewrite or regenerate migrations that have already been applied; generate a new migration for additional changes.

## UI gallery

In development mode, visit `http://127.0.0.1:5173/_ui` to see the design system component gallery (`apps/web/src/ui/`). The route exists only under `pnpm dev:web`, not in production builds.

## Previewing the docs site locally

```bash
pnpm --filter @gonggong/website dev
```

Page sources are in `website/`; the writing guide and screenshot list are in `website/WRITING.md`. Screenshots are retaken with the scripts under `website/scripts/`.

## Related pages

- [Repository structure](/en/dev/structure)
- [Contribution guide](/en/dev/contributing)
- [Environment variables](/en/deploy/env)
- [HTTPS and certificates](/en/deploy/https)
