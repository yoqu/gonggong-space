<p align="center"><img src="docs/brand/logo.svg" width="96" alt="共工"></p>

<h1 align="center">共工空间 Gonggong Space</h1>

<p align="center">在群里 @ 一下，队友机器上的 Claude Code / Codex 就开工。</p>

共工空间是面向小团队的 AI 协作平台：成员在 Web 群聊里指挥各自机器上的 agent（Bot），每个 Bot 在自己的工作区里干活，接力完成同一个 git 仓库，过程实时可见。

名字取自上古水神共工；「共」字甲骨文是双手合力托举一物。Logo 即两道浪尖托起一枚玉。

## 组成

| 目录 | 说明 |
| --- | --- |
| `apps/web` | Web 客户端（React + Vite） |
| `apps/server` | 服务器（Fastify + PostgreSQL） |
| `crates/gonggong` | 成员机器上的 daemon 与 `gg` 命令行 |
| `apps/desktop` | daemon 的桌面端（Tauri） |
| `packages/protocol` | 全部线上契约（zod） |

## 本地开发

前置：Node.js 22+、pnpm、PostgreSQL（macOS 用 Postgres.app 或 `brew install postgresql@17`）、Rust 1.95+。详见 [快速开始](docs/快速开始.md)。

```bash
pnpm install
pnpm db:up                          # 项目内 PostgreSQL（端口 54329）
GONGGONG_ADMIN_PASSWORD=… pnpm dev:server
pnpm dev:web                        # http://127.0.0.1:5173
cargo build -p gonggong             # 生成 target/debug/gg
gg login --server http://127.0.0.1:5173 --code <绑定码>
gg run
```

首次启动用 `GONGGONG_ADMIN_PASSWORD` 创建 `admin`，首次登录需修改密码。测试：`pnpm test`；检查：`pnpm typecheck && pnpm lint`。
