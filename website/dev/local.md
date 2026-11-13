# 本地开发与测试

本页讲怎样在本机跑起服务器、Web、daemon 和桌面端，以及自检、各类测试、迁移和文档站的命令。

## 前置依赖

- **Node.js 24+** 与 **pnpm**：`corepack enable` 即可，pnpm 版本由根 `package.json` 锁定。
- **PostgreSQL**（推荐 17）。只需装好命令行工具，不需要启动系统服务：
  - macOS：Postgres.app 或 `brew install postgresql@17`，脚本会自动找到，无需改 PATH。
  - Debian/Ubuntu：`sudo apt install postgresql`，再把 `/usr/lib/postgresql/<版本>/bin` 加入 PATH。
- **Rust**：用 rustup 安装，版本由 `rust-toolchain.toml` 固定，构建 daemon 与桌面端。
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
- 服务器监听地址可用 `HOST`、`PORT` 调整。
- Web 开发服务器把 `/api`、`/ws`、`/livekit` 转发到服务器；上游地址可用 `GONGGONG_SERVER` 指定，端口和监听地址可用 `WEB_PORT`、`WEB_HOST` 调整。

其余服务器环境变量见 [环境变量](/deploy/env)。

## 构建并绑定 daemon

```bash
cargo build -p gonggong        # 生成 target/debug/gg
```

1. 在 Web 上打开「绑定新机器」，复制绑定码或接入链接。
2. 登录并运行：

```bash
./target/debug/gg login --server http://127.0.0.1:5173 --code <绑定码>
# 或直接粘贴接入链接：./target/debug/gg login '<接入链接>'
./target/debug/gg run
```

`http://` 只允许连本机地址（`localhost`、`127.0.0.1` 等）；局域网或远端服务器必须用 `https://`，见下文 [HTTPS 开发](#https-开发)。

::: tip 一台机器跑多个 daemon
daemon 的本地状态默认在 `~/.gonggong`。设置 `GONGGONG_HOME`（以及 `GONGGONG_MACHINE_ID`）可以在同一台机器上跑多个互相隔离的 daemon，端到端测试就是这么做的。
:::

::: tip 不调用真实 Agent
调试 daemon 时可以用仓库自带的模拟 Agent 代替真实适配器，不消耗模型额度：

```bash
GONGGONG_ADAPTER_CMD="node tools/mock-agent/agent.js" ./target/debug/gg run
```

模拟 Agent 按提示词决定行为，例如 `mock:echo`、`mock:slow`、`mock:crash`、`mock:exec <命令>`，完整列表见 `tools/mock-agent/agent.js` 文件头。
:::

## 桌面端开发

```bash
pnpm --filter @gonggong/desktop tauri dev
```

桌面端的界面在 `apps/desktop/src`，并通过别名直接引用 Web 的源码（`apps/web/src`）；Rust 壳 `apps/desktop/src-tauri` 在进程内运行 `crates/gonggong` 的 daemon。改 `apps/web/src/ui/` 等共享代码时，要同时检查桌面端。

## HTTPS 开发

要调试 HTTPS 路径，或让局域网里的其他机器接入，需要带证书启动：

```bash
bash scripts/dev-cert.sh        # 生成自签证书（含 localhost、127.0.0.1 和本机局域网 IP）
```

脚本默认把证书写到 `.gonggong-dev/tls/`，并打印 `GONGGONG_TLS_CERT=… GONGGONG_TLS_KEY=…`。

```bash
export GONGGONG_TLS_CERT=… GONGGONG_TLS_KEY=…     # 粘贴上一步打印的值
GONGGONG_ADMIN_PASSWORD=初始密码 pnpm dev:server
WEB_HOST=0.0.0.0 pnpm dev:web                    # 服务器与 Web 共用这份证书
```

daemon 会校验服务器证书：默认按系统 CA，自签证书需要显式信任它的 SHA-256 指纹：

```bash
openssl x509 -in .gonggong-dev/tls/cert.pem -noout -fingerprint -sha256
./target/debug/gg login --server https://127.0.0.1:5173 --code <绑定码> --fingerprint <上一行输出的指纹>
```

私有 CA 签发的证书用 `--ca-file <CA 证书.pem>`。只在本地调试时，也可以设置 `GONGGONG_INSECURE_DEV=1` 关闭证书校验（daemon 会打印警告，不要在其他场合使用）。详见 [HTTPS 与证书](/deploy/https)。

## 推送前自检 pnpm check

```bash
pnpm check          # typecheck + lint + 按改动选的测试
pnpm check --all    # typecheck + lint + 全量测试
```

`scripts/check.sh` 以 `origin/main` 的合并基点为准，未提交和未跟踪的文件也算改动：

- 始终跑 `pnpm typecheck` 与 `pnpm lint`。
- Web、服务器只跑**与改动文件同名或同领域**的测试文件（例如改了 `features/market/` 下的文件，就跑名字里带 `market` 的测试）；找不到对应测试时跑该包全量。改 Web 时也会跑桌面端测试。
- daemon 按模块过滤 `cargo test`；改了 `lib.rs`、`main.rs`、`Cargo.toml` 等会跑全部。
- 改了 `packages/protocol`、锁文件、根配置或 `scripts/` 时，等同 `--all`。
- 只改文档（`*.md`、`docs/`、`website/`、`videos/`）或 `e2e/` 时不跑测试。
- 本机存在 `.internal-patterns` 时，先检查仓库里没有混入内部地址。

`cargo test` 和整包 Vitest 这类重任务会通过 `/tmp/gonggong-check.lock` 排队，多个检出同时自检时不会互相挤占。机器负载高时并行测试偶尔会超时，失败的用例要单独重跑确认，不能直接忽略。

## 测试

| 命令 | 内容 |
| --- | --- |
| `pnpm check` / `pnpm check --all` | 推送前自检，见上文 |
| `pnpm test` | 全量：`tools/*.test.mjs` + 所有包的 Vitest + `cargo test --workspace` |
| `pnpm -r test` | 所有 pnpm 包的 Vitest（protocol、server、web、desktop） |
| `cargo test --workspace` | daemon 与桌面端的 Rust 测试，包括协议 fixture 往返 |
| `pnpm typecheck` | 所有包的 TypeScript 类型检查 |
| `pnpm lint` | Biome 检查（`biome check .`） |
| `pnpm e2e` | Playwright 端到端测试 |

只跑一个包：`pnpm --filter @gonggong/server test`；只跑一个文件：`pnpm --filter @gonggong/server exec vitest run test/groups.test.ts`。

服务器测试需要数据库在运行（先 `pnpm db:up`）。daemon 的集成测试大多在 `crates/gonggong/tests/it/`，合成一个测试二进制，可以用 `cargo test -p gonggong --test it <名称>` 只跑一部分。

### 端到端测试需要什么

`pnpm e2e` 使用 `e2e/playwright.config.ts`，会自动：

- 重建 `gonggong_e2e` 数据库，在 8790 端口启动服务器（初始管理员密码固定为测试值）；
- 在 5190 端口启动 Web，浏览器语言为 `zh-CN`；
- 用 `cargo build -p gonggong` 构建 daemon，每台「成员机器」用独立的临时 `GONGGONG_HOME` 运行 `gg run`。

大部分用例驱动**真实 Agent**，所以本机需要装好并登录 Claude Code 与 Codex（Codex 用例复用 `~/.codex/auth.json` 里的登录，模型可用 `GONGGONG_E2E_CODEX_MODEL` 指定）。真实 Agent 依赖外部模型服务，失败会自动重试一次。预览等用例使用 `tools/mock-agent`，MCP 注入用例使用 `tools/mcp-echo`。

另有几套按需运行的配置：

| 场景 | 命令 |
| --- | --- |
| HTTPS 路径 | `GONGGONG_E2E_TLS=1 pnpm exec playwright test -c e2e/tls.config.ts` |
| 真实终端 | `GONGGONG_E2E_TERMINAL=1 pnpm exec playwright test -c e2e/terminal.config.ts` |
| 两台机器强制同步（需要另一台可 SSH 的机器，所需变量见 `e2e/two-machines.spec.ts` 文件头） | `pnpm exec playwright test -c e2e/remote.config.ts` |
| Linux 桌面预览（需要 Docker） | `bash scripts/gui-e2e.sh` |
| Linux daemon 集成（需要 Docker） | `bash scripts/linux-e2e.sh` |

## 服务器测试数据库助手

服务器测试放在 `apps/server/test/`，约定用两个助手，不要依赖其他功能的 HTTP 流程造数据：

- `test/support/db.ts` 的 `createTestDb()`：为每个测试文件新建一个随机命名、已执行全部迁移的独立数据库，`close()` 时删除。
- `test/support/app.ts` 的 `createTestApp()`：在随机端口启动真实的应用，连着一个新的测试库，并提供直接写库的种子助手 `seed`（`seed.user()`、`seed.team()`、`seed.machine()`、`seed.bot()`、`seed.group()`、`seed.cookie()`）。第一个创建的用户会拥有一个默认团队，之后创建的用户、群和 Bot 默认加入它。

```ts
import { createTestApp } from './support/app.js'

const t = await createTestApp()
const owner = await t.seed.user()
```

`test/support/` 下还有 Git、强制同步、产物等场景的助手（如 `git-daemon.ts`、`sync.ts`、`artifacts.ts`），写同类测试时优先复用。

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

页面源文件在 `website/`，写作规范与截图清单见 `website/WRITING.md`；截图由 `website/scripts/` 下的脚本重拍。

## 相关页面

- [仓库结构](/dev/structure)
- [贡献指南](/dev/contributing)
- [环境变量](/deploy/env)
- [HTTPS 与证书](/deploy/https)
