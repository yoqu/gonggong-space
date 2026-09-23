# AIWS 开发约定

需求：`docs/AI 团队工作区指挥平台 需求规格说明书（v1.0） .md`；计划与决策：`docs/plan/P1-开发计划.md`；ACP 事实：`docs/plan/acp-research.md`；原型：`docs/原型UI-AI 对话 agent系统界面设计方案/*.dc.html`（界面以原型为准）。

## 结构
- `packages/protocol` 全部线上契约（zod）。`fixtures/*.json` 是 daemon 协议的共享样例，TS 与 Rust 都要能往返。
- `apps/server` Fastify + Drizzle + PostgreSQL。`src/modules/<domain>/` 按领域组织路由与服务；`src/db/schema.ts` 唯一表定义。
- `apps/web` React + Vite。`src/ui/` 设计系统组件；`src/features/<domain>/` 按领域组织页面与组件。
- `crates/aiws` Rust daemon + `aiws` CLI。
- `e2e/` Playwright 端到端（真实 server + web + daemon + agent）。

## 命令
- `pnpm db:up` 启动项目内 PostgreSQL（端口 54329，不碰系统服务）
- `pnpm -r test`、`cargo test --workspace`、`pnpm typecheck`、`pnpm lint`（biome）
- HTTPS 开发：`bash scripts/dev-cert.sh` 生成自签证书并打印 `AIWS_TLS_CERT/AIWS_TLS_KEY` 与指纹，daemon 用 `aiws login --server https://127.0.0.1:<port> [--fingerprint sha256:…]`（见 `docs/plan/安全说明.md`）
- `pnpm e2e`；迁移：改 `schema.ts` 后 `pnpm --filter @aiws/server db:generate`

## 规则
- **TDD**：先写失败测试（验收 → 集成 → 单元），再实现。切片完成 = 本切片测试全绿 + 全量不回归 + typecheck + lint。
- 服务端测试用 `test/support/db.ts` 的 `createTestDb()`（每个文件独立数据库），用 `test/support/app.ts` 的种子助手造数据，不要依赖其他切片的 HTTP 流程。
- 协议变化：先改 `packages/protocol`，daemon 消息同步加 fixture 并更新 `crates/aiws/src/protocol.rs`。
- 代码、注释、标识符用英文；界面文案用中文，与原型一致。注释非必要不写，只解释「为什么」。
- 保持精简：不引入未使用的抽象、不加兜底分支掩盖错误、不改与需求无关的代码。
- 引入新依赖前用 `npm view` / `cargo search` 核实最新版本并查官方文档，禁止凭记忆写 API。
- 不提交生成的迁移冲突：并行切片若都改了 schema，由集成者合并后重新生成。
