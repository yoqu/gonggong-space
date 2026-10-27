# 网页终端真实验收

## 验收边界

- `crates/gonggong/tests/terminal_acceptance.rs` 是 macOS / Linux 的真实 PTY 验收。它启动 `/bin/bash`，不使用 shell、输出或进程 mock，覆盖工作目录、TTY 输入输出、Ctrl+C、Ctrl+D、断流重放和显式结束整个进程树。
- `e2e/terminal.spec.ts` 是浏览器、服务端、daemon 和真实 PTY 的全链路验收，不调用模型。它从工作台新建终端，覆盖键盘输入输出、控制字符、关闭网页、刷新重连、非机器主人拒绝、显式结束进程树及服务端日志不记录终端内容。
- `apps/server/src/modules/terminals/audit.ts` 只把操作者、机器、群 / Bot、工作区、会话和生命周期写入现有 `audit_logs`。其输入没有命令、按键或输出字段，落库 detail 也由固定字段构造，不透传请求对象。
- 单元测试、relay fake、协议 fixture 和 UI 测试不能替代真实 PTY 或全链路 E2E。macOS 和 Linux 分别验收，Windows 不在首期范围内。

## 执行

真实 PTY（依赖 r02 的 `TerminalManager` 合入后）：

```bash
cargo test -p gonggong --test terminal_acceptance -- --test-threads=1
```

审计：

```bash
pnpm --filter @gonggong/server exec vitest run test/terminal-audit.test.ts
```

完整 E2E（使用现有 Playwright server / web helpers）：

```bash
GONGGONG_E2E_TERMINAL=1 pnpm exec playwright test -c e2e/terminal.config.ts
```

未设置 `GONGGONG_E2E_TERMINAL` 时全链路用例显式跳过，避免普通测试意外启动 shell。专项配置不含主配置的 first-run 项目，因此不调用外部模型。测试只启动 Playwright 管理的临时进程，结束后全部回收，不需要常驻服务。

## 实现边界

1. 真实 `TerminalManager` 接入 daemon tunnel，并上报 `terminal-v1` 能力；PTY 归 daemon 所有。
2. `TerminalService` 和 daemon transport 提供 REST 与 `/ws/terminals/:sessionId` 中继；Cookie 鉴权后逐会话校验机器主人。
3. `auditTerminal` 记录创建、附着、网页断流、daemon 退出 / 撤销和确认显式终止。浏览器断流只记 `detach`；daemon 自退的 `actorUserId` 为 `null`。不记录命令、按键或输出。
4. 关闭标签或网页只关闭 socket；只有「结束终端」走 DELETE / terminate。workbench 保存的 `sessionId` 用于刷新后重新附着。

## 验收结果（2026-10-27）

| 环境 | 真实 PTY | 浏览器全链路 | 其他验证 |
| --- | --- | --- | --- |
| macOS arm64 | `terminal` 9/9、`terminal_acceptance` 3/3、`terminal_lifecycle` 9/9 | 1/1，19.8s | `pnpm check --all` 通过；隔离环境 Rust 集成 281 passed / 1 ignored；服务端终端专项 35/35；TLS 8/8 |
| Debian 12 aarch64（Docker） | 同一组 PTY 测试 21/21 | 1/1，15.9s | 浏览器、server、daemon 和真实 shell 均在 Linux 容器内运行 |

两端浏览器验收均覆盖命令输入输出、工作目录、TTY、Ctrl+C、Ctrl+D、关闭网页及刷新恢复、非机器主人拒绝、显式结束进程树和日志不记录终端内容。Windows 未验收，也不属于首期范围。
