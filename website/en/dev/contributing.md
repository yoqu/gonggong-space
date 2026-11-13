# Contribution guide

This page describes the conventions for contributing code to Gonggong Space: test first, the definition of done, how to change the protocol and migrations, i18n, code style, and the commit and PR process.

## Test first (TDD)

Write a failing test first, then the implementation. Fill in tests from the outside in:

1. **End-to-end**: Playwright (`e2e/`), describing the complete behavior users can see.
2. **Integration**: the server uses the real app plus an isolated test database (`createTestApp()`); the daemon uses the integration tests under `crates/gonggong/tests/it/`; the web client and desktop app use Vitest + Testing Library.
3. **Unit**: pure logic functions.

Conventions:

- Server tests use `createTestDb()` from `test/support/db.ts` (an isolated database per test file) and the seed helpers in `test/support/app.ts` to create data. Don't depend on other features' HTTP flows. See [Local development and testing](/en/dev/local#server-test-database-helpers).
- daemon integration tests go in `crates/gonggong/tests/it/`, which compiles into a single test binary. Only tests that change process-level state (environment variables, global tracing), or that use a paused clock to test global HTTP client timeouts, go in separate `tests/*.rs` files.
- Tests use the Chinese UI by default: web and desktop test setup pins `gg.locale=zh`, and the end-to-end browser locale is `zh-CN`.

## Definition of done

A change is done when all of the following hold:

- All tests added in this change pass;
- You ran `pnpm check` before pushing (typecheck + lint + tests selected by the changed files; see [Local development and testing](/en/dev/local#pre-push-self-check-pnpm-check)), and `pnpm check --all` when the change has a wide impact;
- You reviewed your own diff once more and fixed what you found.

CI runs the full test suite as a backstop; if it breaks, the committer fixes it right away. When you change shared code such as `apps/web/src/ui/`, check every consumer too (the desktop app reuses web components). Changes that affect end-to-end behavior should also run the relevant `pnpm e2e` cases.

## Protocol change process

1. Change `packages/protocol` (zod definitions) first.
2. For daemon messages, add matching samples under `packages/protocol/fixtures/`.
3. Update `crates/gonggong/src/protocol.rs` to match.
4. For new messages or fields that older daemons can't understand, add a capability to `DaemonFeature`; the server sends them based on capabilities.
5. When you change built-in MCP tools, update `gonggong-tools.json` / `gonggong-daemon-tools.json` to match.
6. Make sure the round-trip tests pass on both the TS and Rust sides.

For how it works, see [Protocol](/en/dev/protocol).

## Database migrations

- Tables are defined only in `apps/server/src/db/schema.ts`. After changing it, generate a migration with `pnpm --filter @gonggong/server db:generate` and commit it with the code.
- Don't modify or regenerate migrations that have already been merged; generate a new migration for additional changes.
- Don't commit conflicting generated migrations: when several branches change the schema at the same time, whoever merges them merges `schema.ts` and regenerates.
- Call out changes that include database migrations separately in the PR description.

## i18n

The UI defaults to Chinese, with English as well. It's Gettext-style: **the Chinese source text is the key**, only the English dictionary is maintained, and missing entries fall back to Chinese.

- When the same Chinese text needs different English, add a context suffix, such as `'关闭#off'` (stripped automatically in Chinese output). Write placeholders as `{name}` and English plurals as `{n:item|items}`.
- The core is in `packages/protocol/src/i18n.ts`; English text shared across clients, such as group event messages, is in `i18n-en.ts`.
- Web: `import { t } from '<relative path>/i18n'`, with entries in the `en.ts` of the relevant domain (such as `features/<domain>/en.ts`, `ui/en.ts`). The key type of `t()` is the dictionary's keys, so a missing entry fails typecheck. Domain dictionaries are merged, so a key can have only one English translation.
- Desktop: `apps/desktop/src/i18n`, reusing the web's language setting.
- Server: `apps/server/src/i18n`, choosing the language from the request's `Accept-Language`; errors from `fail(code, '中文 {x}', { x })` are translated automatically. Group events store the Chinese source text and translation parameters, and clients render them in the local language.
- daemon: `gonggong::t!("中文 {x}", x = v)`, with entries in `crates/gonggong/src/i18n/en.rs`; a test scans the source to ensure full coverage. The language is taken from `GG_LANG`, `LC_ALL`, `LC_MESSAGES`, then `LANG`.
- Text meant for AI Agents (prompts, tool descriptions, and tool results) isn't translated.

## Code style

- **Language**: code, comments, and identifiers in English; UI copy in Chinese.
- **Terminology**: UI copy follows the unified terminology: 「Bot」 (not BOT/bot), 「机器」 (machine; not 电脑/设备), 「群」 (group; not 群聊); permission tiers are 「只读 / 工作区写入 / 完全访问」 (Read-only / Workspace write / Full access). No internal development notes in the UI.
- **Comments**: write them only when necessary, and then only to explain "why", not to restate what the code does.
- **Keep it lean**: don't introduce unused abstractions, don't add fallback branches that hide errors, and don't change code unrelated to the task at hand.
- **Formatting**: TS/JS/CSS is formatted by Biome (see `biome.json`); Rust uses `rustfmt` (see `rustfmt.toml`).
- **No internal information**: the repository is public, so code, docs, and commits must not contain internal domains, IPs, hostnames, or CI credentials. If you have a local `.internal-patterns` file, `pnpm check` blocks them.

## Adding dependencies

Before adding a new dependency:

- Verify the latest version with `npm view <package>` or `cargo search <crate>`;
- Read the official docs to confirm the API usage; don't write it from memory.

Pin exact versions in `package.json` and `Cargo.toml`, consistent with the existing style in the repository.

## Commits and PRs

1. Fork the repository and create a branch from `main`.
2. Develop following the conventions above, and pass the checks in the definition of done locally.
3. Write a one-line commit message that says what changed and why, using the existing history's `feat:` / `fix:` / `docs:` / `test:` prefixes, optionally with a scope, e.g. `fix(web): …`, `feat(server): …`.
4. Open a pull request. The description should include:
   - **Background**: the problem being solved or the related issue;
   - **Changes**: the main parts changed;
   - **Testing**: the tests added and the commands run;
   - **UI changes**: screenshots, if any.
5. PRs that change the protocol, the database schema, or built-in MCP tools should call this out separately in the description.

When filing an issue, for bugs include reproduction steps, expected and actual results, versions (server, daemon / desktop app, Agent CLI), and relevant logs (you can export a redacted diagnostics bundle with `gg logs --export <path>`, or click 「导出诊断包…」 (Export diagnostics bundle…) on the 「日志与诊断」 (Logs & diagnostics) page in the desktop app). For feature requests, describe the use case.

## Code of conduct

Respect every participant, stick to the issues, and communicate kindly.

## Related pages

- [Local development and testing](/en/dev/local)
- [Protocol](/en/dev/protocol)
- [Repository structure](/en/dev/structure)
