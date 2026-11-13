# Contributing to development

This page introduces Gonggong Space's tech stack and where to start the first time you read the code.

Gonggong Space is a pnpm + Cargo monorepo: TypeScript for the server, the web client, and the desktop app UI; Rust for the daemon and `gg` command line on members' machines. Both sides share one protocol definition.

## Tech stack at a glance

| Part | Technology | Version (the repository lockfiles are authoritative) |
| --- | --- | --- |
| Web client `apps/web` | React + Vite, routing with react-router, state with zustand, syntax highlighting with shiki | React 19.3, Vite 8.3 |
| Server `apps/server` | Fastify + Drizzle ORM + PostgreSQL (driver `postgres`) | Fastify 5.12, drizzle-orm 0.45, drizzle-kit 0.31 |
| daemon and `gg` `crates/gonggong` | Rust (edition 2024), tokio, clap, `agent-client-protocol` | agent-client-protocol 2.2 |
| Desktop app `apps/desktop` | Tauri 2 + React, reusing `crates/gonggong` and the web components | Tauri 2.12 |
| Protocol `packages/protocol` | All wire contracts defined with zod | zod 4.6 |
| Tests | Vitest (TS unit/integration), `cargo test`, Playwright (end-to-end) | Vitest 5.0, Playwright 1.63 |
| Code checks | Biome (formatting + lint), TypeScript | Biome 2.5, TypeScript 5.9 |
| Docs site `website` | VitePress | 1.6 |

Prerequisites:

- **Node.js 24+**. The pnpm version is pinned by the `packageManager` field in the root `package.json` (just run `corepack enable`).
- **Rust**: the version is pinned by `rust-toolchain.toml`. Install it with rustup and make sure rustup's `cargo` comes before any other `cargo` on your PATH (such as Homebrew's `rust`); `cargo --version` should show the pinned version.
- **PostgreSQL**: only the command-line tools are needed; the dev database is started by a repository script. See [Local development and testing](/en/dev/local#start-the-database).

## Where to start reading

1. Read [Architecture](/en/guide/architecture) first to understand how the server, web client, daemon, and Agents relate.
2. Look at [Repository structure](/en/dev/structure) to learn where each piece of code lives.
3. Follow [Local development and testing](/en/dev/local) to run the server, web client, and daemon on your machine, then create a Bot and try it end to end.
4. Read `packages/protocol/src/`: it's the contract for every API and message. Once you understand it, you can trace the corresponding implementations in the server and daemon. See [Protocol](/en/dev/protocol).
5. Go deeper based on your interests:
   - How a run is scheduled: `apps/server/src/modules/runs/`
   - How the daemon drives Agents: `crates/gonggong/src/engine.rs`, `session.rs`, `turn.rs`, and the plugin-declared Agent adapters in `adapters.rs`
   - The UI: `apps/web/src/features/chat/`, `apps/web/src/ui/`
6. Before you start coding, read the [Contribution guide](/en/dev/contributing).

::: tip
`CLAUDE.md` and `AGENTS.md` in the repository root are condensed versions of the development conventions (structure, commands, i18n, testing rules). AI coding tools read them automatically when you use them to contribute.
:::

## Related pages

- [Repository structure](/en/dev/structure)
- [Local development and testing](/en/dev/local)
- [Protocol](/en/dev/protocol)
- [Contribution guide](/en/dev/contributing)
