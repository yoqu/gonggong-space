# Local development and testing

This page covers how to run the server, Web, and daemon on your machine, plus the commands for the various tests, migrations, and the docs site.

## Prerequisites

- **Node.js 22+** and **pnpm**: just run `corepack enable`; the pnpm version is pinned by the root `package.json`.
- **PostgreSQL** (17 recommended). You only need the command-line tools installed; the system service does not need to be running:
  - macOS: Postgres.app or `brew install postgresql@17`. The script finds it automatically, so you don't need to change PATH.
  - Debian/Ubuntu: `sudo apt install postgresql`, then add `/usr/lib/postgresql/<version>/bin` to PATH.
- **Rust 1.95+**: to build the daemon and the desktop app.
- At least one Agent CLI (Claude Code or Codex), logged in, for real runs and end-to-end tests.

Install dependencies:

```bash
pnpm install
```

## Start the database

```bash
pnpm db:up      # start the in-repo PostgreSQL
pnpm db:down    # stop it
```

`scripts/pg.sh` stores data in `.gonggong-dev/pg` inside the repo, listens on port **54329** (change it with `GONGGONG_PG_PORT`), and automatically creates two databases, `gonggong` and `gonggong_test`. It doesn't touch the system PostgreSQL service; multiple git worktrees share the same database under the main checkout.

## Start the server and Web

```bash
GONGGONG_ADMIN_PASSWORD=初始密码 pnpm dev:server   # listens on 127.0.0.1:8787 by default, restarts on code changes
pnpm dev:web                                      # http://127.0.0.1:5173
```

`初始密码` is a placeholder for the initial admin password you choose.

- The server runs migrations automatically on startup; you don't need to create tables by hand.
- On first startup, `GONGGONG_ADMIN_PASSWORD` is used to create the `admin` account, and you must change the password on first login.
- The Web dev server forwards `/api`, `/ws`, and `/livekit` to the server; set the upstream address with `GONGGONG_SERVER`, and adjust the port and listen address with `WEB_PORT` and `WEB_HOST`.

For the remaining server environment variables, see [Environment variables](/en/deploy/env).

## Build and bind the daemon

```bash
cargo build -p gonggong        # produces target/debug/gg
```

1. In the Web app, open the avatar menu in the top-right corner, click 「绑定新机器」 (Bind new machine), and copy the bind code or connect link.
2. Log in and run:

```bash
./target/debug/gg login --server http://127.0.0.1:5173 --code <绑定码>
# or paste the connect link directly: ./target/debug/gg login '<接入链接>'
./target/debug/gg run
```

`<绑定码>` is the bind code and `<接入链接>` is the connect link.

::: tip Running multiple daemons on one machine
The daemon's local state lives in `~/.gonggong` by default. Setting `GONGGONG_HOME` (and `GONGGONG_MACHINE_ID`) lets you run multiple isolated daemons on the same machine, which is exactly what the end-to-end tests do.
:::

::: tip Without calling a real Agent
When debugging the daemon, you can use the mock Agent bundled with the repo instead of a real adapter, so you don't spend model quota:

```bash
GONGGONG_ADAPTER_CMD="node tools/mock-agent/agent.js" ./target/debug/gg run
```

The mock Agent's behavior is chosen by the prompt, e.g. `mock:echo`, `mock:slow`, `mock:crash`. See the header of `tools/mock-agent/agent.js` for the full list.
:::

Desktop app development:

```bash
pnpm --filter @gonggong/desktop tauri dev
```

## HTTPS development

The daemon connects over plain http to any address, so other machines on the LAN can bind without a certificate. To encrypt the connection or debug the HTTPS path, start with a certificate:

```bash
bash scripts/dev-cert.sh        # generate a self-signed certificate (covering localhost, 127.0.0.1, and this machine's LAN IP)
```

By default the script writes the certificate to `.gonggong-dev/tls/` and prints the `GONGGONG_TLS_CERT=… GONGGONG_TLS_KEY=…` environment variables.

```bash
export GONGGONG_TLS_CERT=… GONGGONG_TLS_KEY=…     # paste the values printed in the previous step
GONGGONG_ADMIN_PASSWORD=初始密码 pnpm dev:server
WEB_HOST=0.0.0.0 pnpm dev:web                    # the server and Web share this certificate
./target/debug/gg login --server https://127.0.0.1:5173 --code <绑定码>
```

The daemon accepts the self-signed certificate without verifying it, so no extra trust step is needed. See [HTTPS and certificates](/en/deploy/https).

## Testing

| Command | What it runs |
| --- | --- |
| `pnpm test` | Everything: `tools/*.test.mjs` + Vitest for all packages + `cargo test --workspace` |
| `pnpm -r test` | Vitest for all pnpm packages (protocol, server, web, desktop) |
| `cargo test --workspace` | Rust tests for the daemon and desktop app, including protocol fixture round-trips (`crates/gonggong/tests/contract.rs`) |
| `pnpm typecheck` | TypeScript type checking for all packages |
| `pnpm lint` | Biome checks (`biome check .`) |
| `pnpm e2e` | Playwright end-to-end tests |

To run a single package: `pnpm --filter @gonggong/server test`; to run a single file: `pnpm --filter @gonggong/server exec vitest run test/groups.test.ts`.

Server tests need the database running (run `pnpm db:up` first).

### What end-to-end tests need

`pnpm e2e` uses `e2e/playwright.config.ts` and automatically:

- recreates the `gonggong_e2e` database and starts the server on port 8790 (the initial admin password is fixed to a test value);
- starts Web on port 5190;
- builds the daemon with `cargo build -p gonggong` and runs `gg run` for each "member machine" with its own temporary `GONGGONG_HOME`.

Most cases drive a **real Agent**, so you need Claude Code and Codex installed and logged in on your machine (Codex cases only reuse the login in `~/.codex/auth.json`; you can pick the model with `GONGGONG_E2E_CODEX_MODEL`). Real Agents depend on external model services, so failures are retried once automatically. Preview-related cases use `tools/mock-agent`, and the MCP injection case uses `tools/mcp-echo`.

There are also two on-demand configurations:

- HTTPS path: `GONGGONG_E2E_TLS=1 pnpm exec playwright test -c e2e/tls.config.ts`
- Linux desktop previews: `bash scripts/gui-e2e.sh` (requires Docker)

## Server test database helpers

Server tests live in `apps/server/test/`. By convention they use two helpers, and must not rely on other features' HTTP flows to create data:

- `createTestDb()` from `test/support/db.ts`: creates a randomly named, fully migrated, isolated database for each test file, and drops it on `close()`.
- `createTestApp()` from `test/support/app.ts`: starts the real application on a random port, connected to a fresh test database, and provides `seed`, a set of seeding helpers that write directly to the database (such as `seed.user()`, `seed.machine()`, `seed.bot()`, `seed.group()`, `seed.cookie()`).

```ts
import { createTestApp } from './support/app.js'

const t = await createTestApp()
const owner = await t.seed.user()
```

## Database migrations

The table schema is defined only in `apps/server/src/db/schema.ts`. After changing it, generate a migration:

```bash
pnpm --filter @gonggong/server db:generate
```

Migrations are generated into `apps/server/drizzle/` and applied automatically when the server starts. Don't rewrite or regenerate migrations that have already been applied; generate a new migration for further changes.

## UI gallery

In development mode, visit `http://127.0.0.1:5173/_ui` to see the design system component gallery (`apps/web/src/ui/`). This route exists only under `pnpm dev:web`; it isn't in production builds.

## Previewing the docs site locally

```bash
pnpm --filter @gonggong/website dev
```

Page sources are in `website/`; see `website/WRITING.md` for the writing guidelines.

## Related pages

- [Repository structure](/en/dev/structure)
- [Contributing guide](/en/dev/contributing)
- [Environment variables](/en/deploy/env)
- [HTTPS and certificates](/en/deploy/https)
