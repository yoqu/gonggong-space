# 网页终端真实验收

## 验收边界

- `crates/gonggong/tests/terminal_acceptance.rs` 是 macOS / Linux 的真实 PTY 验收。它启动 `/bin/bash`，不使用 shell、输出或进程 mock，覆盖工作目录、TTY 输入输出、Ctrl+C、Ctrl+D、断流重放和显式结束整个进程树。
- `e2e/terminal.spec.ts` 是浏览器、服务端、daemon 和真实 PTY 的全链路验收，不调用模型。它从工作台新建终端，覆盖键盘输入输出、控制字符、关闭网页、刷新重连、非机器主人拒绝、显式结束进程树及服务端日志不记录终端内容。
- `apps/server/src/modules/terminals/audit.ts` 只把操作者、机器、群 / Bot、工作区、会话和生命周期写入现有 `audit_logs`。其输入没有命令、按键或输出字段，落库 detail 也由固定字段构造，不透传请求对象。
- 单元测试、relay fake、协议 fixture 和 UI 测试不能替代真实 PTY 或全链路 E2E。Linux 仍需在 Linux 主机或 CI 运行同一测试；macOS 通过不代表 Linux 已验收。Windows 不在首期范围内。

## 执行

真实 PTY（依赖 r02 的 `TerminalManager` 合入后）：

```bash
cargo test -p gonggong --test terminal_acceptance -- --test-threads=1
```

审计：

```bash
pnpm --filter @gonggong/server exec vitest run test/terminal-audit.test.ts
```

完整 E2E（主 Agent 接线完成后，使用现有 Playwright server / web helpers）：

```bash
GONGGONG_E2E_TERMINAL=1 pnpm exec playwright test -c e2e/terminal.config.ts
```

未设置 `GONGGONG_E2E_TERMINAL` 时全链路用例显式跳过，避免在主 Agent 集成前把缺失入口当作真实通过。专项配置不含主配置的 first-run 项目，因此不调用外部模型。测试只启动 Playwright 管理的临时进程，结束后全部回收，不需要常驻服务。

## 主 Agent 接线

1. 合入 r02 的真实 `TerminalManager`、daemon tunnel 分发及 `terminal-v1` 能力上报；保留 PTY 归 daemon 所有的生命周期。
2. 在服务端创建 `TerminalService` 和 daemon transport，注册 r03 的 REST、r04 的 `/ws/terminals/:sessionId` 中继；Cookie 鉴权后仍须逐会话校验机器主人。
3. 把 `auditTerminal` 接到创建、附着、网页断流、daemon 退出 / 撤销和确认显式终止的位置。浏览器断流只记 `detach`，不能记成 `terminate`；daemon 自退的 `actorUserId` 为 `null`。只传已经解析的 `machineId / groupId / botId / sessionId / workspace / lifecycle`，不要传 tunnel payload。
4. 保留现有 `TerminalView`：关闭标签或网页只关闭 socket；只有「结束终端」走 DELETE / terminate。把 workbench 保存的 `sessionId` 用于刷新后的重新附着。
5. 合入后运行上面的真实 PTY 与完整 E2E，再移除跳过条件，让 `terminal.spec.ts` 进入默认 E2E 回归。若浏览器无法恢复会话或进程树未退出，不得以 REST 状态或 mock 测试代替验收。

本切片不修改 `app.ts`、`context.ts`、`main.ts` 或 `TerminalView`；这些入口由主 Agent 统一接线。
