# 参与开发

本页介绍共工空间的技术栈，以及第一次读代码时从哪里入手。

共工空间是一个 pnpm + Cargo 的单仓（monorepo）：TypeScript 写服务器、Web 与桌面端界面，Rust 写成员机器上的 daemon 与 `gg` 命令行，两边共用一份协议定义。

## 技术栈一览

| 部分 | 技术 | 版本（以仓库锁定为准） |
| --- | --- | --- |
| Web 客户端 `apps/web` | React + Vite，路由 react-router，状态 zustand，代码高亮 shiki | React 19.3、Vite 8.3 |
| 服务器 `apps/server` | Fastify + Drizzle ORM + PostgreSQL（驱动 `postgres`） | Fastify 5.12、drizzle-orm 0.45、drizzle-kit 0.31 |
| daemon 与 `gg` `crates/gonggong` | Rust（edition 2024）、tokio、clap、`agent-client-protocol` | agent-client-protocol 2.2 |
| 桌面端 `apps/desktop` | Tauri 2 + React，复用 `crates/gonggong` | tauri 2.11 |
| 协议 `packages/protocol` | zod 定义全部线上契约 | zod 4.6 |
| 测试 | Vitest（TS 单元/集成）、`cargo test`、Playwright（端到端） | Vitest 5.0、Playwright 1.63 |
| 代码检查 | Biome（格式化 + lint）、TypeScript | Biome 2.5、TypeScript 5.9 |
| 文档站 `website` | VitePress | 1.6 |

包管理器为 pnpm（版本由根 `package.json` 的 `packageManager` 字段锁定，`corepack enable` 即可）。前置环境：Node.js 22+、PostgreSQL、Rust 1.95+。

## 从哪里读起

1. 先读 [系统架构](/guide/architecture)，弄清服务器、Web、daemon、Agent 之间的关系。
2. 看 [仓库结构](/dev/structure)，知道每块代码在哪。
3. 按 [本地开发与测试](/dev/local) 把服务器、Web 和 daemon 在本机跑起来，自己建一个 Bot 走一遍。
4. 读 `packages/protocol/src/`：这里是所有接口与消息的契约，读懂它就能顺着找到服务器和 daemon 的对应实现。详见 [协议](/dev/protocol)。
5. 按兴趣深入：
   - 一次运行怎么调度：`apps/server/src/modules/runs/`（`scheduler.ts`、`engine.ts`）
   - daemon 怎么驱动 Agent：`crates/gonggong/src/engine.rs`、`session.rs`、`turn.rs`
   - 界面：`apps/web/src/features/chat/`、`apps/web/src/ui/`
6. 动手前读 [贡献指南](/dev/contributing)。

::: tip
仓库根目录的 `CLAUDE.md`（与 `AGENTS.md` 内容相同）是开发约定的简版，用 AI 编码工具参与开发时它会被自动读取。
:::

## 相关页面

- [仓库结构](/dev/structure)
- [本地开发与测试](/dev/local)
- [协议](/dev/protocol)
- [贡献指南](/dev/contributing)
