# 贡献指南

本页说明给共工空间提交代码的约定：测试先行、完成标准、协议与迁移的改法、多语言、代码风格，以及提交与 PR 流程。

## 测试先行（TDD）

先写失败的测试，再写实现。测试从外到内依次补齐：

1. **端到端**：Playwright（`e2e/`），描述用户能看到的完整行为。
2. **集成**：服务器用真实应用 + 独立测试库（`createTestApp()`）；daemon 用 `crates/gonggong/tests/it/` 下的集成测试；Web 与桌面端用 Vitest + Testing Library。
3. **单元**：纯逻辑函数。

约定：

- 服务器测试用 `test/support/db.ts` 的 `createTestDb()`（每个测试文件一个独立数据库）和 `test/support/app.ts` 的种子助手造数据，不要依赖其他功能的 HTTP 流程。详见 [本地开发与测试](/dev/local#服务器测试数据库助手)。
- daemon 集成测试写在 `crates/gonggong/tests/it/`，它们合成一个测试二进制。只有会改进程级状态（环境变量、全局 tracing），或用暂停时钟测全局 HTTP 客户端超时的测试，才单独放在 `tests/*.rs`。
- 测试默认使用中文界面：Web 与桌面端的测试初始化固定 `gg.locale=zh`，端到端测试的浏览器语言是 `zh-CN`。

## 完成标准

一项改动完成，需要同时满足：

- 本次新增的测试全部通过；
- 推送前跑 `pnpm check`（typecheck + lint + 按改动选的测试，见 [本地开发与测试](/dev/local#推送前自检-pnpm-check)），影响面大时跑 `pnpm check --all`；
- 再审查一遍自己的 diff，修完发现的问题。

CI 会跑全量测试兜底，挂了由提交人立即修。改 `apps/web/src/ui/` 等共享代码时，同时检查所有使用方（桌面端复用 Web 的组件）。涉及端到端行为的改动，还应跑相关的 `pnpm e2e` 用例。

## 协议变更流程

1. 先改 `packages/protocol`（zod 定义）。
2. 如果是 daemon 消息，在 `packages/protocol/fixtures/` 加对应样例。
3. 同步更新 `crates/gonggong/src/protocol.rs`。
4. 旧 daemon 读不懂的新消息或字段，在 `DaemonFeature` 里加能力，服务器按能力下发。
5. 修改内置 MCP 工具时，同步更新 `gonggong-tools.json` / `gonggong-daemon-tools.json`。
6. 确认 TS 与 Rust 两边的往返测试都通过。

原理见 [协议](/dev/protocol)。

## 数据库迁移

- 表结构只在 `apps/server/src/db/schema.ts` 里定义，改完用 `pnpm --filter @gonggong/server db:generate` 生成迁移，与代码一起提交。
- 已合入的迁移不要修改或重新生成，追加变更请生成新的迁移。
- 不要提交有冲突的生成迁移：多个分支同时改了 schema 时，由合并的人合并 `schema.ts` 后重新生成。
- 带数据库迁移的改动，在 PR 描述里单独说明。

## 多语言

界面默认中文，另有英文。采用 Gettext 风格：**中文原文就是 key**，只维护英文词典，缺词条时回退中文。

- 同一句中文需要不同英文时，加上下文后缀，如 `'关闭#off'`（中文输出时自动去掉）。占位写 `{name}`，英文复数写 `{n:item|items}`。
- 核心在 `packages/protocol/src/i18n.ts`；群事件消息等跨端文案的英文在 `i18n-en.ts`。
- Web：`import { t } from '<相对路径>/i18n'`，词条写在所在领域的 `en.ts`（如 `features/<领域>/en.ts`、`ui/en.ts`）。`t()` 的 key 类型就是词典的 key，漏写词条 typecheck 会报错。各领域词典会合并，同一 key 只能有一个英文。
- 桌面端：`apps/desktop/src/i18n`，复用 Web 的语言设置。
- 服务器：`apps/server/src/i18n`，按请求的 `Accept-Language` 选语言；`fail(code, '中文 {x}', { x })` 的报错会自动翻译；群事件存中文原文与翻译参数，由客户端按本地语言渲染。
- daemon：`gonggong::t!("中文 {x}", x = v)`，词条在 `crates/gonggong/src/i18n/en.rs`，有测试扫描保证全部覆盖；语言依次取 `GG_LANG`、`LC_ALL`、`LC_MESSAGES`、`LANG`。
- 给 AI Agent 看的文本（提示词、工具描述与工具结果）不翻译。

## 代码风格

- **语言**：代码、注释、标识符用英文；界面文案用中文。
- **术语**：界面文案遵循统一术语：「Bot」（不写 BOT/bot）、「机器」（不写电脑/设备）、「群」（不写群聊）；权限档位为「只读 / 工作区写入 / 完全访问」。界面上不出现内部开发备注。
- **注释**：非必要不写；需要时只解释「为什么」，不复述代码在做什么。
- **保持精简**：不引入用不到的抽象，不加掩盖错误的兜底分支，不改与本次需求无关的代码。
- **格式**：TS/JS/CSS 由 Biome 统一（配置见 `biome.json`），Rust 用 `rustfmt`（配置见 `rustfmt.toml`）。
- **不写内部信息**：仓库是公开的，代码、文档和提交里不要出现内部域名、IP、主机名或 CI 凭据。本机放有 `.internal-patterns` 时，`pnpm check` 会拦截。

## 引入依赖

引入新依赖前：

- 用 `npm view <包名>` 或 `cargo search <crate>` 核实最新版本；
- 阅读官方文档确认 API 用法，不要凭记忆写。

依赖版本在 `package.json` 与 `Cargo.toml` 中写精确版本，与仓库现有写法保持一致。

## 提交与 PR

1. Fork 仓库，从 `main` 拉出分支。
2. 按上面的约定开发，本地通过完成标准里的检查。
3. 提交信息用一句话说清改了什么、为什么，沿用现有历史的 `feat:` / `fix:` / `docs:` / `test:` 前缀，可带范围，例如 `fix(web): …`、`feat(server): …`。
4. 发起 Pull Request，描述里建议包含：
   - **背景**：要解决的问题或关联的 Issue；
   - **改动**：主要改了哪些部分；
   - **测试**：新增了哪些测试、跑了哪些命令；
   - **界面变化**：如有，附截图。
5. 改协议、数据库 schema 或内置 MCP 工具的 PR，请在描述里单独说明。

提 Issue 时，Bug 请写清复现步骤、期望与实际结果、版本（服务器、daemon / 桌面端、Agent CLI）和相关日志（可用 `gg logs --export <路径>` 导出脱敏诊断包，桌面端在「日志与诊断」页点「导出诊断包…」）；功能建议请写清使用场景。

## 行为准则

尊重每一位参与者，就事论事，友善交流。

## 相关页面

- [本地开发与测试](/dev/local)
- [协议](/dev/protocol)
- [仓库结构](/dev/structure)
