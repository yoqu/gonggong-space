# Changelog

## v0.4.1 — 2026-10-26

- macOS 新增「关闭窗口后隐藏程序坞图标」设置：开启后关闭窗口仅保留菜单栏图标，可从菜单栏重新打开；后台 daemon 继续运行，默认保持原行为 / macOS adds "Hide the Dock icon when the window closes": leave only the menu-bar icon after closing, reopen it from there, and keep the daemon running; the previous behavior remains the default

## v0.4.0 — 2026-10-23

- Git 管理对标 IntelliJ IDEA：Commit 窗口、完整差异视图、带提交图的 Git Log、比较、分支弹窗、合并冲突三方解决、贮藏、注解和文件历史 / IDEA-style Git management: Commit window, full diff viewer, Git Log with commit graph, compare, branch popup, three-way conflict resolution, stashes, blame and file history
- Git 写操作扩到 23 种：分支、合并、变基、优选、还原、重置、贮藏、标签与冲突解决；新增 `gitOps3` 协议能力、`git_operations.args` 迁移，以及所有 Git 读写的仓库选择 / Git writes expand to 23 actions including branch, merge, rebase, cherry-pick, revert, reset, stash, tags and conflict resolution, with the `gitOps3` capability, `git_operations.args` migration and repository selection on every Git read and write
- 受控写操作沿用主人直执行、成员审批、运行中拒绝与基准分支保护；危险操作二次确认，非基准分支只允许 `--force-with-lease`；提交类操作显式使用 Bot 身份 / Guarded writes keep owner-direct execution, member approval, refusal during runs and base-branch protection; dangerous actions ask again, non-base force pushes use only `--force-with-lease`, and commit-oriented actions use the Bot identity explicitly

## v0.3.9 — 2026-10-23

- 后台任务跑完后 Bot 自主续跑单独开一轮运行（「后台任务完成后继续」），回复、审批、改动与用量照常记录，不再丢失或被自动拒绝；有后台任务时不再回收空闲的 agent 进程 / A Bot's own continuation after a background task runs as a new run ("Continued after background task") with its reply, approvals, changes and usage recorded instead of dropped or refused; idle agent processes are no longer recycled while background tasks run
- 新增 Bot 工具 `plugin_catalog` 与 `creation_propose`：对话里的创作需求由 Bot 发「创作确认卡」，成员开始、改参数或不用了 / New Bot tools `plugin_catalog` and `creation_propose`: Bots answer creation requests in the chat with a proposal card members start, edit or dismiss

## v0.3.8 — 2026-10-22

- 子仓库与嵌套仓库并入 Git 分支下拉，按「仓库 → 分支」两级树展示，可直接切换或拉取主仓库和子仓库分支；执行位置、Git 操作与文件入口合并到统一的工作区菜单 / Subrepositories and nested repositories join the Git branch picker as a two-level repository → branch tree; switch or pull branches in the main repository and subrepositories, and use one workspace menu for location, Git, and files
- `git.refs` / `git.action` 支持可选 `repo` 参数，daemon 拒绝越出工作区或附加目录的路径，并上报新的 `gitRepos` 能力 / `git.refs` / `git.action` accept an optional `repo` parameter; the daemon rejects paths outside the workspace or extra folders and advertises the new `gitRepos` capability
- 托管目录 / 本机目录标签与基准分支说明收进菜单，去掉重复的当前分支、未提交数量与独立子仓库入口 / Workspace kind and base-branch details move into the menu; duplicate current-branch, uncommitted-count, and standalone subrepository entries are removed

## v0.3.7 — 2026-10-22

- 手动 Git 第一期：Git 状态实时刷新、「获取远程更新」，提交可只选部分文件（成员申请同样），提交历史与文件对比显示差异，推送说明与被拒提示，切换分支、提交、推送进群事件 / Manual Git, phase one: live status and "Fetch remote updates", commits of selected files only (member requests too), diffs in the history and file compare, clearer push, and group events for switch, commit and push
- 定时任务每次在独立的新会话中运行，不续接群内会话 / Scheduled tasks run in a fresh session each time and no longer resume the group's session
- `client_release_publish` 支持 `dir` 一次上传整个发布目录，审批一次 / `client_release_publish` takes `dir` to upload a whole release directory with one approval

## v0.3.6 — 2026-10-21

- 手动 Git 操作：Git 状态条切换分支、拉取、提交、推送，非主人发起需 Bot 主人审批，运行中禁止写操作，推送基准分支需二次确认 / Manual Git: switch branches, pull, commit and push from the Git bar; non-owners' requests need the Bot owner's approval, writes are refused during runs, pushing the base branch asks again
- 提交历史与按分支/提交查看、对比文件树 / Commit history, and file trees at any branch or commit with a compare mode
- 客户端更新提示显示具体更新说明，后台可上传或编辑 / Client update prompts show the release notes, uploaded or edited in the admin

## v0.3.5 — 2026-10-21

- 插件：配置中心/团队/群上传与启用插件，「✦ 创作」面板把创作任务交给 Bot，内置「网页原型」插件；系统参数总开关，默认关闭 / Plugins: upload and enable plugins per platform, team and group, hand creative work to Bots from the "✦ Create" panel, official "Web prototype" plugin; behind a system switch, off by default
- 密钥管理：平台/团队/群/个人四层，运行时只以环境变量注入并按值打码，MCP 用 `${secret:NAME}` 引用，「填写密钥」卡片 / Secrets: platform, team, group and personal layers, injected only as environment variables and masked by value, referenced from MCP as `${secret:NAME}`, "Fill in secret" cards
- 输入框上方「待处理」区；Bot 进度卡片（飞书同步）；图片预览多图切换；手机端多处布局修复 / Pending dock above the composer; Bot progress cards (mirrored to Feishu); multi-image preview; mobile layout fixes

- 刷新模型：Bot 设置页「刷新模型」让所在机器立即重新探测 agent 的可选模型；`~/.codex/config.toml`、`~/.claude/settings.json` 改动后，机器自动重新探测，不必重启 / Refresh models: a "Refresh models" button in Bot settings makes the machine probe the agent's models again now; editing `~/.codex/config.toml` or `~/.claude/settings.json` triggers a re-probe automatically, no restart needed

## v0.3.4 — 2026-10-19

- 上下文与压缩：圆环按 Claude Code 实际压缩点（窗口 − 输出预留 − 13k）标记与变色，关闭自动压缩时提示停下点；压缩开始/结束上报，群里显示「已自动压缩 167k → 12k」，运行过程可看压缩摘要；压缩可附保留重点；上下文占用不再计入用量；桌面端工作区与概览显示占用圆环 / Context & compaction: the ring marks and colours by where Claude Code really compacts (or where it stops when auto-compaction is off); compactions are reported in the group and the run process with their summary; manual compaction takes instructions; occupancy no longer counts as usage; context rings in the desktop app
- 群聊上下文按 token 预算附带（默认 8000，恢复失败补送 16000），不再限条数 / Group context is attached within a token budget instead of a message count
- 群知识库：群内 markdown 条目所有 Bot 可读，成员手动维护、Bot 用 kb_* 工具维护，版本历史与回滚，管理员置顶/删除，消息「存入知识库」 / Group knowledge base: markdown entries every Bot of the group reads, maintained by members and Bots (kb_* tools), versioned with rollback, pinned by admins, "Save to knowledge base" on messages
- 运行详情：过程带时间点、可按失败/需处理/命令筛选，命令输出可搜可复制；直接审批与回答提问；失败原因横幅（含桌面端）与「重新运行」 / Run details: timestamps, filters, searchable output, approve and answer in place, failure banners (desktop too) and Re-run
- 定时任务可按候选 Bot 选模型与思考程度；群已读时清掉对应「被 @」通知；搜索、未读、实时推送与 daemon 多项性能优化 / Per-Bot model and effort for scheduled tasks; reading a group clears its mention notifications; many performance improvements

## v0.3.3 — 2026-10-17

- Agent 设置：供应商常用配置改为控件（上下文窗口按模型带出、自动压缩、输出上限、思考、beta、工具搜索、API 超时）；机器级「Agent 设置」（语言、思考、署名、git 指令、自动记忆、自动压缩、Bash 超时、非必要流量、继承本机 CLI 配置），Bot 可覆盖语言/思考/署名；每项标来源，下一轮生效；圆环标压缩点、运行详情显示设置来源、`gg agents settings`、环境变量密钥打码 / Agent settings: provider controls (context window from the model, auto-compact, output limit, thinking, betas, tool search, API timeout); per-machine Agent settings with per-Bot overrides; sources shown, applied from the next turn; compaction point on the context ring, settings in run details, `gg agents settings`, masked secrets
- 撤回 5 分钟内可重新编辑；Bot 回复里的文件路径可点击；分支到新聊天；引用 Bot 消息不再触发它 / Edit after recall, clickable file paths, branch into a new chat, quoting a Bot no longer triggers it
- 会话列表按最新消息排序并显示运行状态；⌘K 搜会话名；「执行位置」面板 / Conversations sorted by latest message with run status; ⌘K finds conversations; execution location panel
- 飞书：单聊 Bot 的飞书应用即可对话；审批与提问合进运行卡片；可关闭网页消息同步 / Feishu: direct chats with a Bot's app, approvals in the run card, optional web sync
- `hand_off` 跨群；成员只读查看群 MCP / Skill；自装 Codex、Claude Code 一键升级；更少的只读命令审批 / Cross-group `hand_off`, read-only MCP / Skill view, upgrades for self-installed CLIs, fewer approvals

## v0.3.2 — 2026-10-15

- 桌面端私服优先更新：先向已绑定的服务器检查更新（`GET /api/desktop-update/:target/:arch/:current`），服务器发布了本平台的更新包与签名就从服务器下载，否则照旧检查 GitHub；「客户端发布」接受 `Gonggong_*.app.tar.gz(.sig)` 与 `*-setup.exe.sig`，新增「桌面端自动更新」列 / Server-first desktop updates: the app asks its server first and downloads from it once the platform's update package and signature are published, else GitHub as before; Client releases take `Gonggong_*.app.tar.gz(.sig)` and `*-setup.exe.sig`, with a new "Desktop auto update" column
- Bot 通过内置 MCP 管理平台/团队/群三层 MCP，密钥经「填写密钥」卡片由发起人填写 / Bots manage platform, team and group MCP servers through the built-in MCP; secrets are filled in by the requester on a card
- 群可单独关闭继承的 Skill 与 MCP / Groups can switch off inherited Skills and MCP servers
- 飞书：Bot 发自定义卡片（`feishu_send_card`）、从飞书群创建共工群或反向创建、同步群成员、飞书通知 / Feishu: custom cards from Bots, create groups either way, member sync, notifications
- 会话列表右键菜单（置顶、免打扰、标记、完成）、被 @ 提醒、聊天顶栏可点击、悬停名片一键 @ / Conversation context menu (pin, mute, mark, complete), mention alerts, clickable chat header, @ from hover cards
- Bot 可在多个附加目录工作；入群不再静默克隆、等主人确认；群可解绑仓库、禁止直推基准分支 / Extra folders for Bots; joining no longer clones silently; unbind repos, block direct pushes to the base branch
- 文件工作区「用本地应用打开」：由 Bot 所在机器用访达、Cursor、VS Code、终端等打开工作区 / "Open with" in the files workspace: the Bot's machine opens the workspace in Finder, Cursor, VS Code, a terminal…
- 头像上传与裁剪、申请共享他人的 Bot、会话统计、Codex 启动前检查 CLI、手机端输入框与布局修复 / Avatar upload and crop, requesting shared Bots, conversation stats, Codex CLI check, mobile composer and layout fixes

## v0.3.1 — 2026-10-10

- Bot 共享 / Bot sharing：主人可把 Bot 共享给团队成员，对方能私聊它（每个私聊独立托管工作区，命令审批仍归主人，主人可在通知里直接批准）并查看配置；取消共享后私聊转为只读 / Owners share a Bot with teammates, who can DM it (each DM in its own managed workspace; approvals stay with the owner, who can decide right from the notification) and see its settings; unsharing turns those DMs read-only
- Bot 详情页按编辑表单分组展示全部配置，宽屏双栏 / The Bot page shows every setting, grouped like the editor, in two columns on wide screens
- 团队 Skill：上传、在线编辑、版本历史与回滚，随运行下发给 Claude Code / Codex，Agent 也能通过内置 MCP 管理 / Team Skills: upload, edit online, version history and rollback, delivered to Claude Code / Codex with each run, manageable by agents through the built-in MCP
- 群成员批量添加、普通成员可拉人（可设为仅管理员）、私聊可改名；输入栏上方显示运行中的 Agent / Add several members at once, members may invite (or admins only), rename DMs; running agents pinned above the composer
- 工作区 diff 与 Git 状态按仓库拆分（子模块 / 嵌套仓库）；中文文件名不再显示为转义 / Diffs and git status split per repo (submodules, nested repos); Chinese file names no longer escaped
- 审批降频：只读命令免审、「始终允许」记为最小前缀并跨群生效、高危命令始终询问 / Fewer approvals: read-only commands run unasked, 始终允许 remembers the smallest prefix across groups, dangerous commands always ask
- 内置 MCP 新增 `client_release_publish`：系统管理员可让 Bot 把本机构建的客户端直接发布到当前空间 / New built-in MCP tool `client_release_publish`: a sysadmin can have a Bot publish client builds made on its machine straight to the current space
- 飞书：客户端内静默登录、群成员双向同步 / Feishu: silent sign-in inside the Feishu client, two-way group member sync

## v0.3.0 — 2026-10-07

- 绑定即用 / Binding just works：`gg` 与桌面端不再校验或固定服务器 HTTPS 证书指纹（自签证书直接可用，换证书无需重新绑定），`http://` 可连接任意服务器；旧服务器生成的 `--fingerprint` / `fp=` 仍可粘贴，会被忽略 / `gg` and the desktop app no longer verify or pin the server's HTTPS certificate (self-signed works as is, no re-binding after a certificate change) and accept `http://` for any server; `--fingerprint` / `fp=` from older servers are still accepted and ignored
- 默认演示环境 / Default demo environment：[http://gg.uyoqu.com](http://gg.uyoqu.com/)，注册即可体验 / sign up and try it without deploying
- Windows 桌面端 / Windows desktop app：NSIS 安装包（内置 daemon、托盘、自动更新），由 GitHub Actions 在发布时构建并加入更新源 / NSIS installer (built-in daemon, tray, auto update), built by GitHub Actions on release and added to the update feed
- Windows：双击 `gg.exe` 不再一闪而过，改为说明用法并等待回车；桌面端启动的 git、node 等子进程不再弹出控制台窗口；首次运行不再打印日志目录错误 / Double-clicking `gg.exe` explains how to run it instead of flashing; child processes of the desktop app open no console windows; no log-directory error on first run
- Windows 目录选择器可切换磁盘，「上一级」停在盘符根目录 / The Windows folder picker switches between drives, and Up stops at the drive root
- 仓库统一 LF 换行（`.gitattributes`），修复 Windows 检出后 Docker 部署的服务端无法启动 / LF line endings everywhere (`.gitattributes`): the Docker server failed to start from a Windows checkout

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
