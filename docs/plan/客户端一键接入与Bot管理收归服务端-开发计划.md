# 客户端一键接入 + Bot 管理收归服务端

## 目标

1. 桌面端绑定机器改为「网页点一下 → 客户端确认」，或「复制一次 → 客户端粘贴一次」，不用再手填服务器和绑定码
2. Bot 的所有管理动作（确认、并发、命令审批、白名单）都在 Web 端完成，桌面端和 CLI 只能查看

## 决策

| # | 决策 |
|---|---|
| J1 | 接入链接 `gonggong://bind?server=<url>&code=<XXXX-XXXX>[&fp=sha256:<hex>]`：既用来唤起客户端，也是粘贴用的文本 |
| J2 | 唤起客户端引入 `tauri-plugin-deep-link` 2.4.10 和 `tauri-plugin-single-instance` 2.4.5（带 `deep-link` feature，Windows/Linux 靠它把链接转给已运行的实例），前端 `@tauri-apps/plugin-deep-link` 2.4.10（已用 `npm view` / crates.io 核实版本）；读剪贴板另需 `tauri-plugin-clipboard-manager` / `@tauri-apps/plugin-clipboard-manager` 2.3.3（WebKit 的 `navigator.clipboard.readText()` 需要用户手势），只开 `allow-read-text`，只在输入框为空时预填 |
| J3 | **链接不自动绑定**：客户端先显示服务器地址，用户点「绑定」后才登录，防止恶意链接把本机绑到陌生服务器。本机已经绑定时，提示先解绑 |
| J4 | 服务端配置了 TLS 时，由服务端计算自身证书的 sha256 并放进 `BindCodeDto.fingerprint`，写入链接的 `fp`；没有 TLS 时为 null |
| J5 | 客户端引导页只留一个输入框：接受接入链接，也接受完整的 `gg login --server … --code … [--fingerprint …]`。窗口获得焦点时读剪贴板，识别成功就预填 |
| J6 | 首次引导压成一屏：绑定成功后自动启动 daemon、检测 agent，直接进主界面；没有可用 agent 时在概览页提示，不再拦在引导页。去掉「确认 Bot」这一步 |
| J7 | `pending_confirm` 保留，只能在 Web 确认（通知或 Bot 设置）。删除 `POST /api/daemon/bots/:id/confirm` 和 `PATCH /api/daemon/bots/:id`（机器 token 不再有任何写 Bot 的接口） |
| J8 | 命令审批、白名单从本机 `local.json` 迁到服务端 `bots.approval / bots.allowlist`，随 `RunStart.bot` 下发，daemon 用下发值决策（取代 P1 D15 的「本机配置」） |
| J9 | **审批和白名单只有 Bot 主人能改**，系统管理员不能改（包括替别人创建时，只能用默认值「每次询问」）。并发上限维持现有规则（主人或系统管理员） |
| J10 | 旧 `local.json` 里的 `bots` 字段读取时忽略、不迁移（同 M6）：升级后回到安全默认「每次询问」，需要的话由主人在 Web 重新设置 |
| J11 | 桌面端 Bot 页只读：展示状态、agent、并发、审批；每个 Bot 一个「在 Web 中管理」按钮，用系统浏览器打开 `<server>/?bot=<id>`（ChatPage 读取参数，打开 BotDialog）。待确认的 Bot 显示「在 Web 中确认」 |
| J12 | CLI 同步收口：删除 `gg bots confirm`、`gg config bot`；`gg bots` 只读，输出里附 Web 链接；`gg config agent --path` 保留（属于机器配置）。另外 `gg login` 也能接受接入链接：`gg login 'gonggong://bind?…'` |

## 协议

- `BindCodeDto` 加 `fingerprint: string | null`，另加 `link: string`（服务端拼好的接入链接）
- `BotDto` 加 `approval: 'ask' | 'allowlist' | 'all'` 和 `allowlist: string[]`
- `UpdateBotReq` 加可选的 `approval` / `allowlist`（服务端校验：非主人传了就返回 `forbidden`；白名单去空白、去重、不能为空串）
- `RunStart.bot` 加 `approval` 和 `allowlist`（默认 `ask` / `[]`，兼容旧服务端）；同步 fixture 与 `crates/gonggong/src/protocol.rs`
- 删除 `DaemonBotPatchReq`

## 实现要点

- **服务端**：`bots` 增加 `approval text not null default 'ask'`、`allowlist jsonb not null default []`（新迁移）；`PATCH /api/bots/:id` 按 J9 鉴权；`scheduler.ts` 把两个字段写进 `RunStart.bot`；`POST /api/bind-codes` 返回 `fingerprint` 和 `link`（`tls.ts` 加载证书时算好指纹）
- **daemon**：`session.rs` 的 `rules` 改为从 `req.start.bot` 构造 `BotSettings`；`LocalSettings` 删除 `bots` 字段（serde 会忽略旧文件里的字段）；`bind.rs` 新增 `parse_link()`，同时解析接入链接和 `gg login` 命令文本
- **Web**：`BindMachineDialog` 以「在客户端中打开」（`<a href={link}>`）为主按钮，「复制接入链接」为次按钮，命令行方式折叠到「使用命令行」里；`NewBotDialog` 创建成功后按状态给下一步（机器在线 → 已就绪；离线 → 提示启动客户端；没有机器 → 直接在弹窗里生成接入链接）；`BotDialog` 加「并发上限」，主人可见「命令审批 / 白名单」（沿用桌面端现有的 SegmentedControl + TokenField 交互和文案）
- **桌面端**：注册 `gonggong` scheme 和 deep-link / single-instance 插件，收到链接后发事件给前端；`Onboarding.tsx` 重写为一屏（J3、J5、J6）；`Bots.tsx` 删除 BotDialog 和确认按钮（J11）；删除 Tauri 命令 `save_bot`、`confirm_bots`，`bots` 命令不再合并 local 设置

## 任务（按顺序，每项先写失败测试）

1. **协议**：`packages/protocol` 字段与 fixture；`protocol.rs` 同步；TS 与 Rust 往返测试
2. **服务端审批字段**：迁移 + `PATCH /api/bots/:id` 鉴权 + `RunStart` 下发。测试 `test/bot-approval.test.ts`：主人可改；系统管理员改返回 403；非法白名单返回 400；派发的 `run.start` 带有下发值
3. **服务端收口**：删除两个 daemon 写接口，并同步删除相关测试；`bind-codes` 返回 fingerprint 和 link（有无 TLS 两种情况都测）
4. **daemon 决策改用下发值**：`tests/engine.rs` 覆盖「下发 allowlist 后本地放行 / 下发 ask 后转主人审批」；`local.rs` 测试把旧 `bots` 字段被忽略写进断言
5. **接入链接解析**：`bind.rs` 单元测试覆盖链接、`gg login` 命令、带和不带指纹、非法输入；`gg login <link>`
6. **CLI 收口**：删除 `gg bots confirm` 和 `gg config bot`，以及 `configure.rs` 里对应的代码与测试
7. **Web**：`test/bind.test.tsx`（主按钮链接、复制内容）、`test/bots.test.tsx`（主人看得到审批项，系统管理员看不到；创建后的下一步提示）
8. **桌面端**：Rust 侧删除命令并注册插件；前端 `test/onboarding.test.tsx`（粘贴解析、剪贴板预填、深链预填后仍需点「绑定」、已绑定时提示）和 `test/bots.test.tsx`（只读、没有设置按钮）
9. **e2e**：`e2e/bind-link.spec.ts`：Web 生成链接 → `gg login <link>` → 在 Web 设白名单 → 群里触发命令，本机按白名单自动放行
10. **收尾**：`pnpm -r test`、`cargo test --workspace`、`pnpm typecheck`、`pnpm lint`、`pnpm e2e`；更新 P1 计划 D15 的注记和 `docs/plan/安全说明.md`（J3、J9）

## 风险

- Windows/Linux 的 scheme 注册要到安装包安装后才生效，开发时只能在 macOS 用 `tauri dev` 验证；Windows 无真机，照旧只做交叉编译（D16）
- J10 会让已经配置了白名单的用户回到「每次询问」，发版说明里要写清楚
