# Changelog

## v0.2.0 — 2026-10-05

- 强制同步 / Force sync：同一个群里多台机器上的 Bot 共享一份工作区——乐观并发替代群锁，逐路径提交，冲突时自动三方合并，合并不了交给管理员或 Bot 主人逐文件处理；群顶部状态栏与同步面板显示版本与各副本状态；离线补齐、本地改动保留或丢弃、疑似密钥文件拦截；已在两台机器间跨机验证（10 万文件仓库）
  Bots on different machines share one workspace per group: optimistic concurrency instead of a group lock, per-path commits, automatic three-way merges, manual per-file resolution by the admin or Bot owner when needed; status bar and sync panel; offline catch-up, keep-or-discard for local edits, secret-file guard; tested across two machines (100k-file repo)
- 定时任务 / Scheduled tasks：群与私聊可挂定时任务，到点 @ 最合适的 Bot 执行；Agent 也能通过内置 MCP 创建 / Groups and DMs run tasks on a schedule, picking the best-suited Bot; agents can create them through the built-in MCP
- 团队层级 / Teams：多团队切换，Bot 归团队、机器归个人 / Switch between teams; Bots belong to teams, machines to people
- 飞书联动 / Feishu (Lark)：扫码一键创建应用、飞书登录、群绑定；运行卡片流式打字机上屏、状态表情回复、预览卡片同步到飞书 / One-scan app setup, Feishu login, group binding; streaming run cards, status reactions, preview cards in Feishu
- 演示模式 / Demo mode：后台一键开启，限制公开链接、远程操作、完全访问档位与改密码 / One switch in the admin console limits public links, remote control, full access and password changes
- 自动更新 / Auto update：`gg` 在服务器未发布版本时每 6 小时检查 GitHub Releases 并在空闲时自升级；macOS 桌面端后台下载新版本，提示「立即重启」/ `gg` checks GitHub Releases every 6 hours when the server publishes no build and upgrades itself when idle; the macOS app downloads updates in the background and offers a restart
- 帮助手册新增视频介绍（宣传片与功能讲解）/ Video intro (promo and walkthrough) in the docs

## v0.1.0 — 2026-10-01

首个公开版本 / First public release.

- 群聊协作：在群里 @ Bot，成员机器上的 Claude Code / Codex 开工；追加、打断、`/stop`，Bot 之间接力
- 自托管：server（Fastify + PostgreSQL）只做路由、中继与审计；daemon `gg`（Rust）只向外连接，模型 Key 与 git 凭据留在成员机器
- 过程与改动：思考、工具调用、命令输出实时回传；diff、Git 状态、文件树、token 与上下文用量
- 结果预览：网页、接口、静态报告、桌面应用窗口、微信小程序模拟器在群里打开，可生成限时公开链接
- 权限与审批：只读 / 工作区可写 / 完全访问三档，越档操作由 Bot 主人审批；Bot 可在群里向成员提问
- 国内开箱即用：默认 npmmirror，一键安装 Node、Claude Code、Codex，内置模型厂商预设，可导入 CC Switch 配置
- macOS 桌面端（内置 daemon，已签名公证）；`gg` 支持 macOS / Linux / Windows
- Docker Compose 一键部署
- 中文 / English 界面
