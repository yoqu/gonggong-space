# Contributing guide

This page describes the conventions for contributing code to Gonggong Space: test-first development, the definition of done, how to change the protocol and migrations, code style, and the commit and PR workflow.

## Test first (TDD)

Write a failing test first, then the implementation. Fill in tests from the outside in:

1. **End-to-end**: Playwright (`e2e/`), describing the complete behavior users can see.
2. **Integration**: for the server, the real application + an isolated test database (`createTestApp()`); for the daemon, the integration tests under `crates/gonggong/tests/`; for Web, Vitest + Testing Library.
3. **Unit**: pure logic functions.

Server tests use `createTestDb()` from `test/support/db.ts` (one isolated database per test file) and the seeding helpers in `test/support/app.ts` to create data; don't rely on other features' HTTP flows. See [Local development and testing](/en/dev/local#server-test-database-helpers).

## Definition of done

A change is done when all of the following hold:

- All tests added in the change pass;
- The full test suite doesn't regress: `pnpm test` (including `pnpm -r test` and `cargo test --workspace`);
- `pnpm typecheck` passes;
- `pnpm lint` passes (Biome).

For changes that affect end-to-end behavior, also run the relevant `pnpm e2e` cases.

## Protocol change workflow

1. Change `packages/protocol` (the zod definitions) first.
2. For daemon messages, add matching samples under `packages/protocol/fixtures/`.
3. Update `crates/gonggong/src/protocol.rs` to match.
4. When changing built-in MCP tools, update `gonggong-tools.json` / `gonggong-daemon-tools.json` to match.
5. Make sure the round-trip tests pass on both the TS and Rust sides.

For the rationale, see [Protocol](/en/dev/protocol).

## Database migrations

- The table schema is defined only in `apps/server/src/db/schema.ts`. After changing it, generate a migration with `pnpm --filter @gonggong/server db:generate` and commit it together with the code.
- Don't modify or regenerate migrations that have already been merged; generate a new migration for further changes.
- Don't commit conflicting generated migrations: when multiple branches change the schema at the same time, whoever merges them merges `schema.ts` and regenerates.

## Code style

- **Language**: code, comments, and identifiers in English; UI copy in Chinese.
- **Terminology**: UI copy follows the unified terminology: 「Bot」 (never BOT/bot), 「机器」 (machine; never 电脑/设备, "computer"/"device"), 「群」 (group; never 群聊, "group chat"); the permission tiers are 「只读 / 工作区写入 / 完全访问」 (Read-only / Workspace write / Full access). Internal development notes never appear in the UI.
- **Comments**: only when necessary; when needed, explain only "why", not what the code does.
- **Keep it lean**: don't introduce unused abstractions, don't add fallback branches that mask errors, and don't touch code unrelated to the change at hand.
- **Formatting**: TS/JS/CSS is formatted by Biome (config in `biome.json`); Rust uses `rustfmt` (config in `rustfmt.toml`).

## Adding dependencies

Before adding a new dependency:

- Verify the latest version with `npm view <package>` or `cargo search <crate>`;
- Read the official documentation to confirm API usage; don't write it from memory.

Pin exact dependency versions in `package.json` and `Cargo.toml`, consistent with how the repo already does it.

## Commits and PRs

1. Fork the repo and create a branch from `main`.
2. Develop following the conventions above, and pass every check in the definition of done locally.
3. Write commit messages that say in one sentence what changed and why. The existing history uses `feat:` / `fix:` / `docs:` prefixes, e.g. `fix: 预览隧道在读端过慢时重置流` ("reset the preview tunnel stream when the reader is too slow").
4. Open a pull request. The description should ideally include:
   - **Background**: the problem being solved or the related issue;
   - **Changes**: the main parts you changed;
   - **Testing**: which tests you added and which commands you ran;
   - **UI changes**: screenshots, if any.
5. For PRs that change the protocol, the schema, or built-in MCP tools, call this out separately in the description.

When filing an issue: for bugs, include clear reproduction steps, expected versus actual results, versions (server, daemon / desktop app, Agent CLI), and relevant logs (you can export a redacted diagnostics bundle with `gg logs --export`); for feature requests, describe the use case.

## Code of conduct

Respect every participant, stick to the issue at hand, and communicate kindly.

## Related pages

- [Local development and testing](/en/dev/local)
- [Protocol](/en/dev/protocol)
- [Repository structure](/en/dev/structure)
