# 共工（Gonggong）开发约定

需求：`docs/AI 团队工作区指挥平台 需求规格说明书（v1.0） .md`；计划与决策：`docs/plan/P1-开发计划.md`；ACP 事实：`docs/plan/acp-research.md`；原型：`docs/原型UI-AI 对话 agent系统界面设计方案/*.dc.html`（界面以原型为准）。

## 结构
- `packages/protocol` 全部线上契约（zod）。`fixtures/*.json` 是 daemon 协议的共享样例，TS 与 Rust 都要能往返。
- `apps/server` Fastify + Drizzle + PostgreSQL。`src/modules/<domain>/` 按领域组织路由与服务；`src/db/schema.ts` 唯一表定义。
- `apps/web` React + Vite。`src/ui/` 设计系统组件；`src/features/<domain>/` 按领域组织页面与组件。
- `crates/gonggong` Rust daemon + `gg` CLI。
- `e2e/` Playwright 端到端（真实 server + web + daemon + agent）。

## 命令
- `pnpm db:up` 启动项目内 PostgreSQL（端口 54329，不碰系统服务）
- `pnpm -r test`、`cargo test --workspace`、`pnpm typecheck`、`pnpm lint`（biome）
- HTTPS 开发：`bash scripts/dev-cert.sh` 生成自签证书并打印 `GONGGONG_TLS_CERT/GONGGONG_TLS_KEY`，daemon 用 `gg login --server https://127.0.0.1:<port>`（不校验证书，见 `docs/plan/安全说明.md`）
- `pnpm e2e`；迁移：改 `schema.ts` 后 `pnpm --filter @gonggong/server db:generate`

## 多语言（zh 默认 + en）
- Gettext 风格：**中文原文即 key**，只维护英文词典；缺词条时回退中文。同一中文需不同英文时加上下文后缀 `'关闭#off'`（中文输出自动去掉）；web 各领域词典会合并，同 key 只能一个英文。占位 `{name}`，英文复数 `{n:item|items}`。
- TS 核心 `packages/protocol/src/i18n.ts`（`createTranslator`、`resolveLocale`、`I18nText`）；`protocolEn`（`i18n-en.ts`）放群事件消息等跨端文案。
- web：`import { t } from '<rel>/i18n'`，词条写在所在领域的 `en.ts`（`features/<d>/en.ts`、`ui/en.ts`…），`t()` 的 key 类型即词典 key，漏词条 typecheck 报错。语言存 `localStorage['gg.locale']`，切换即刷新；模块级常量可直接调 `t()`。
- desktop：`src/i18n`（复用 web 的 locale）。server：`src/i18n`，按请求 `Accept-Language` 经 AsyncLocalStorage 取语言，`fail(code, '中文 {x}', { x })` 自动翻译；群事件 `postEvent(ctx, groupId, key, params)` 存中文 body + `meta.i18n`，客户端按本地语言渲染。
- Rust：`gonggong::t!("中文 {x}", x = v)`，词条在 `crates/gonggong/src/i18n/en.rs`，测试扫描保证全覆盖；语言取 `GG_LANG` → `LC_ALL` → `LC_MESSAGES` → `LANG`。
- 给 AI agent 看的文本（提示词、工具描述与结果）不翻译。测试默认中文（web/desktop setup 固定 `gg.locale=zh`，e2e `locale: 'zh-CN'`）。

## 规则
- **TDD**：先写失败测试（验收 → 集成 → 单元），再实现。切片完成 = 本切片测试全绿 + 全量不回归 + typecheck + lint。
- **完成即自检**：提交前跑 `pnpm typecheck && pnpm lint && pnpm test`（全部包含 desktop 与 cargo，与 Jenkins 一致），再审查一遍 diff 并修完问题。改 `apps/web/src/ui/` 等共享代码时，同时检查所有使用方（desktop 复用 web 组件）。机器负载高时并行测试会偶发超时，失败用例要单独重跑确认，不能直接忽略。
- 服务端测试用 `test/support/db.ts` 的 `createTestDb()`（每个文件独立数据库），用 `test/support/app.ts` 的种子助手造数据，不要依赖其他切片的 HTTP 流程。
- 协议变化：先改 `packages/protocol`，daemon 消息同步加 fixture 并更新 `crates/gonggong/src/protocol.rs`。
- 代码、注释、标识符用英文；界面文案用中文，与原型一致。注释非必要不写，只解释「为什么」。
- 保持精简：不引入未使用的抽象、不加兜底分支掩盖错误、不改与需求无关的代码。
- 引入新依赖前用 `npm view` / `cargo search` 核实最新版本并查官方文档，禁止凭记忆写 API。
- 不提交生成的迁移冲突：并行切片若都改了 schema，由集成者合并后重新生成。
