# 本地开发与测试

本页讲怎样在本机跑起服务器、Web 和 daemon，以及各类测试、迁移和文档站的命令。

## 前置依赖

- **Node.js 22+** 与 **pnpm**：`corepack enable` 即可，pnpm 版本由根 `package.json` 锁定。
- **PostgreSQL**（推荐 17）。只需装好命令行工具，不需要启动系统服务：
  - macOS：Postgres.app 或 `brew install postgresql@17`，脚本会自动找到，无需改 PATH。
  - Debian/Ubuntu：`sudo apt install postgresql`，再把 `/usr/lib/postgresql/<版本>/bin` 加入 PATH。
- **Rust 1.95+**：构建 daemon 与桌面端。
- 至少一个 Agent CLI（Claude Code 或 Codex）并已登录，用于真实运行和端到端测试。

安装依赖：

```bash
pnpm install
```

## 启动数据库

```bash
pnpm db:up      # 启动项目内 PostgreSQL
pnpm db:down    # 停止
```

`scripts/pg.sh` 把数据放在仓库内的 `.gonggong-dev/pg`，监听 **54329** 端口（可用 `GONGGONG_PG_PORT` 改），并自动创建 `gonggong` 与 `gonggong_test` 两个库。它不碰系统里的 PostgreSQL 服务；多个 git worktree 共用主检出目录下的同一个库。

## 启动服务器与 Web

```bash
GONGGONG_ADMIN_PASSWORD=初始密码 pnpm dev:server   # 默认监听 127.0.0.1:8787，改代码自动重启
pnpm dev:web                                      # http://127.0.0.1:5173
```

- 服务器启动时自动执行迁移，无需手动建表。
- 首次启动用 `GONGGONG_ADMIN_PASSWORD` 创建 `admin` 账号，首次登录需修改密码。
- Web 开发服务器把 `/api`、`/ws`、`/livekit` 转发到服务器；上游地址可用 `GONGGONG_SERVER` 指定，端口和监听地址可用 `WEB_PORT`、`WEB_HOST` 调整。

其余服务器环境变量见 [环境变量](/deploy/env)。

## 构建并绑定 daemon

```bash
cargo build -p gonggong        # 生成 target/debug/gg
```

1. 在 Web 右上角头像菜单里点「绑定新机器」，复制绑定码或接入链接。
2. 登录并运行：

```bash
./target/debug/gg login --server http://127.0.0.1:5173 --code <绑定码>
# 或直接粘贴接入链接：./target/debug/gg login '<接入链接>'
./target/debug/gg run
```

::: tip 一台机器跑多个 daemon
daemon 的本地状态默认在 `~/.gonggong`。设置 `GONGGONG_HOME`（以及 `GONGGONG_MACHINE_ID`）可以在同一台机器上跑多个互相隔离的 daemon，端到端测试就是这么做的。
:::

::: tip 不调用真实 Agent
调试 daemon 时可以用仓库自带的模拟 Agent 代替真实适配器，不消耗模型额度：

```bash
GONGGONG_ADAPTER_CMD="node tools/mock-agent/agent.js" ./target/debug/gg run
```

模拟 Agent 按提示词决定行为，例如 `mock:echo`、`mock:slow`、`mock:crash`，完整列表见 `tools/mock-agent/agent.js` 文件头。
:::

桌面端开发：

```bash
pnpm --filter @gonggong/desktop tauri dev
```

## HTTPS 开发

daemon 只允许用明文 http 连接回环地址。要让局域网里的其他机器接入，或调试 HTTPS 路径，需要带证书启动：

```bash
bash scripts/dev-cert.sh        # 生成自签证书（含 localhost、127.0.0.1 和本机局域网 IP）
```

脚本默认把证书写到 `.gonggong-dev/tls/`，并打印两样东西：`GONGGONG_TLS_CERT=… GONGGONG_TLS_KEY=…` 环境变量，以及证书的 `sha256:` 指纹。

```bash
export GONGGONG_TLS_CERT=… GONGGONG_TLS_KEY=…     # 粘贴上一步打印的值
GONGGONG_ADMIN_PASSWORD=初始密码 pnpm dev:server
WEB_HOST=0.0.0.0 pnpm dev:web                    # 服务器与 Web 共用这份证书
./target/debug/gg login --server https://127.0.0.1:5173 --code <绑定码> --fingerprint sha256:…
```

daemon 在登录时固定服务器证书指纹，之后只信任这张证书。不传 `--fingerprint` 时会信任当前出示的证书并把指纹打印出来供核对。详见 [HTTPS 与证书](/deploy/https)。

## 测试

| 命令 | 内容 |
| --- | --- |
| `pnpm test` | 全量：`tools/*.test.mjs` + 所有包的 Vitest + `cargo test --workspace` |
| `pnpm -r test` | 所有 pnpm 包的 Vitest（protocol、server、web、desktop） |
| `cargo test --workspace` | daemon 与桌面端 Rust 测试，包括协议 fixture 往返（`crates/gonggong/tests/contract.rs`） |
| `pnpm typecheck` | 所有包的 TypeScript 类型检查 |
| `pnpm lint` | Biome 检查（`biome check .`） |
| `pnpm e2e` | Playwright 端到端测试 |

只跑一个包：`pnpm --filter @gonggong/server test`；只跑一个文件：`pnpm --filter @gonggong/server exec vitest run test/groups.test.ts`。

服务器测试需要数据库在运行（先 `pnpm db:up`）。

### 端到端测试需要什么

`pnpm e2e` 使用 `e2e/playwright.config.ts`，会自动：

- 重建 `gonggong_e2e` 数据库，在 8790 端口启动服务器（初始管理员密码固定为测试值）；
- 在 5190 端口启动 Web；
- 用 `cargo build -p gonggong` 构建 daemon，每台「成员机器」用独立的临时 `GONGGONG_HOME` 运行 `gg run`。

大部分用例驱动**真实 Agent**，所以本机需要装好并登录 Claude Code 与 Codex（Codex 用例只复用 `~/.codex/auth.json` 里的登录，模型可用 `GONGGONG_E2E_CODEX_MODEL` 指定）。真实 Agent 依赖外部模型服务，失败会自动重试一次。预览相关用例使用 `tools/mock-agent`，MCP 注入用例使用 `tools/mcp-echo`。

另有两套按需运行的配置：

- HTTPS 路径：`GONGGONG_E2E_TLS=1 pnpm exec playwright test -c e2e/tls.config.ts`
- Linux 桌面预览：`bash scripts/gui-e2e.sh`（需要 Docker）

## 服务器测试数据库助手

服务器测试放在 `apps/server/test/`，约定用两个助手，不要依赖其他功能的 HTTP 流程造数据：

- `test/support/db.ts` 的 `createTestDb()`：为每个测试文件新建一个随机命名、已执行全部迁移的独立数据库，`close()` 时删除。
- `test/support/app.ts` 的 `createTestApp()`：在随机端口启动真实的应用，连着一个新的测试库，并提供直接写库的种子助手 `seed`（如 `seed.user()`、`seed.machine()`、`seed.bot()`、`seed.group()`、`seed.cookie()`）。

```ts
import { createTestApp } from './support/app.js'

const t = await createTestApp()
const owner = await t.seed.user()
```

## 数据库迁移

表结构唯一定义在 `apps/server/src/db/schema.ts`。修改后生成迁移：

```bash
pnpm --filter @gonggong/server db:generate
```

迁移文件生成到 `apps/server/drizzle/`，服务器启动时自动应用。已经应用过的迁移不要改写或重新生成，追加变更请生成新的迁移。

## UI 画廊

开发模式下访问 `http://127.0.0.1:5173/_ui` 可以看到设计系统组件画廊（`apps/web/src/ui/`）。该路由只在 `pnpm dev:web` 时存在，生产构建里没有。

## 文档站本地预览

```bash
pnpm --filter @gonggong/website dev
```

页面源文件在 `website/`，写作规范见 `website/WRITING.md`。

## 相关页面

- [仓库结构](/dev/structure)
- [贡献指南](/dev/contributing)
- [环境变量](/deploy/env)
- [HTTPS 与证书](/deploy/https)
