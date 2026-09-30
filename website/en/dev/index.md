# Contributing to development

This page introduces Gonggong Space's tech stack and where to start when you first read the code.

Gonggong Space is a pnpm + Cargo monorepo: TypeScript for the server and the Web and desktop UIs, Rust for the daemon and `gg` CLI that run on members' machines, with a single protocol definition shared by both sides.

## Tech stack at a glance

| Part | Technology | Version (the repo lockfiles are authoritative) |
| --- | --- | --- |
| Web client `apps/web` | React + Vite, routing with react-router, state with zustand, code highlighting with shiki | React 19.3, Vite 8.3 |
| Server `apps/server` | Fastify + Drizzle ORM + PostgreSQL (driver `postgres`) | Fastify 5.12, drizzle-orm 0.45, drizzle-kit 0.31 |
| daemon and `gg` `crates/gonggong` | Rust (edition 2024), tokio, clap, `agent-client-protocol` | agent-client-protocol 2.2 |
| Desktop app `apps/desktop` | Tauri 2 + React, reusing `crates/gonggong` | tauri 2.11 |
| Protocol `packages/protocol` | zod definitions for every wire contract | zod 4.6 |
| Testing | Vitest (TS unit/integration), `cargo test`, Playwright (end-to-end) | Vitest 5.0, Playwright 1.63 |
| Code checks | Biome (formatting + lint), TypeScript | Biome 2.5, TypeScript 5.9 |
| Docs site `website` | VitePress | 1.6 |

The package manager is pnpm (its version is pinned by the `packageManager` field in the root `package.json`; just run `corepack enable`). Prerequisites: Node.js 22+, PostgreSQL, Rust 1.95+.

## Where to start reading

1. Read [Architecture](/en/guide/architecture) first to understand how the server, Web, daemon, and Agent relate to each other.
2. Look at [Repository structure](/en/dev/structure) to learn where each piece of code lives.
3. Follow [Local development and testing](/en/dev/local) to run the server, Web, and daemon on your machine, then create a Bot and walk through it yourself.
4. Read `packages/protocol/src/`: this is the contract for every API and message. Once you understand it, you can trace your way to the matching server and daemon implementations. See [Protocol](/en/dev/protocol).
5. Dig deeper wherever your interest takes you:
   - How a run is scheduled: `apps/server/src/modules/runs/` (`scheduler.ts`, `engine.ts`)
   - How the daemon drives the Agent: `crates/gonggong/src/engine.rs`, `session.rs`, `turn.rs`
   - The UI: `apps/web/src/features/chat/`, `apps/web/src/ui/`
6. Read the [Contributing guide](/en/dev/contributing) before you start making changes.

::: tip
`CLAUDE.md` in the repo root (identical to `AGENTS.md`) is a condensed version of the development conventions. AI coding tools read it automatically when you use them to contribute.
:::

## Related pages

- [Repository structure](/en/dev/structure)
- [Local development and testing](/en/dev/local)
- [Protocol](/en/dev/protocol)
- [Contributing guide](/en/dev/contributing)
