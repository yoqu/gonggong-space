# 工作区与 Git · 现状

> 范围：托管工作区与本机目录、群仓库（主仓库/附加仓库/自带目录）、入群工作区确认、强制同步、Bot 提交身份、Git 管理面板、空间管理。只写仍有效的决定，以代码为准，更新于 2026-11-15。

## 群仓库与仓库身份
- 群仓库存 `group_repos`：每群至多一个主仓库（`is_primary`，唯一索引 `group_repos_primary`），其余为附加仓库；只存 `url + baseBranch`（`apps/server/src/db/schema.ts`）。
- 主仓库：`PATCH /api/groups/:id/repo`（群管理员）；换仓库所有 Bot 重走 `joinWorkspace`；分区群可解绑，但须先移除附加仓库；强制同步群不能换、不能解绑（`groups/routes.ts`）。
- 附加仓库：`POST/PATCH/DELETE /api/groups/:id/repos[/:repoId]`，须先有主仓库、同 repoKey 不能重复，分区与强制同步群都可加；PATCH 只能改成同一仓库的其他地址（`groups/extra-repos.ts`）。
- 仓库身份 `repoKey = host/path`（小写、去端口与凭据、去 `.git`），TS `packages/protocol/src/repo.ts` 与 Rust `crates/gonggong/src/repo.rs` 各一份，共享用例 `packages/protocol/cases/repo-keys.json`。
- 历史库按团队：`repos`（`teamId + key` 唯一，URL 去凭据，`hiddenAt` 隐藏）、`repo_users`（我最近用过排前）、`machine_repos`（机器 × 本地路径 → 仓库）（`modules/repos/service.ts`）。
- 访问预检 `POST /api/repos/probe` → daemon `repo.probe`（`git ls-remote`），用各 Bot 所在机器的凭据，按机器去重；ssh↔https 自动回退，主人偏好 `users.git_protocol`（auto/ssh/https）（`modules/repos/probe.ts`）。
- 预检失败不拦绑定：`failed` 且 `workspace_reason ∈ PAUSING(denied/network/timeout)` 的 Bot 暂停、@ 不执行；主人或群管理员 `POST …/bots/:botId/recheck` 重试（`workspaces/provision.ts`、`runs/trigger.ts`）。
- Git 账号：`git_accounts`（GitHub/GitLab PAT，`seal()` 加密，只用于列仓库与分支，不用于 clone）（`modules/git-accounts/`）。

## Bot 在群里的工作区
- 状态在 `group_bots`：`workspace_kind`（managed|cd）、`cd_path`、`workspace_state`（pending/cloning/ready/failed/unbound/confirm）、`workspace_reason`、`extra_dirs`、`repo_paths`。没建 `group_bot_workspaces` 表。
- 托管路径：`~/gonggong/workspaces/<群名>/<Bot名>/<仓库名|_empty>`，首次放置时命名并记在 `<home>/workspaces.json`，改名不搬家；旧 id 布局 `<home>/workspaces/<g>/<b>/<repoId>` 在下次运行或绑定时迁移（`crates/gonggong/src/layout.rs`）。
- 托管克隆带 `core.autocrlf=false`（`workspace.rs`）；每轮前不 fetch、不快进，只记录改动跟踪（`session.rs::pre_turn`）。
- 默认工作区 `bots.default_workspace`，仅主人设，daemon 校验后才写（`PUT /api/bots/:id/default-workspace`）。
- `joinWorkspace`：有仓库的群用托管克隆；无仓库群有默认目录则用（快照进 `cd_path`），否则直接用托管空目录（`adoptManaged`）；共享私聊一律独立托管（`workspaces/provision.ts`）。
- 本机目录只由主人显式选择（`/cd` 或选择器），`PUT /api/groups/:id/bots/:botId/workspace`（仅主人，`path=null` 即托管）；强制同步群只能托管。
- `/cd @bot <路径>`：仅主人、仅分区群；路径指向某附加仓库的克隆（remote 一致）则改用该克隆，否则重绑主工作区（`commands/cd.ts`）；有主仓库时 daemon `check_cd` 要求 remote 一致。
- 路径校验 `unusable`：绝对、存在、是目录，不是根、主目录或 `SYSTEM_DIRS`（`workspace.rs`）；目录浏览 `dir.list` 最多 500 项（`DIR_LIST_MAX`），`GET /api/machines/:id/dirs` 仅机器主人。
- 换主工作区开新会话并在群里说明；改自带目录 `PUT …/extra-dirs`、附加仓库本机克隆 `PUT …/repos/:repoId` 也开新会话（`newSessionReason: 'config_changed'`）。
- 附加仓库的本机克隆存 `repo_paths`，服务端经 `dir.list` 校验 remote，不走 `workspace.cd`；下发时 `splitExtras` 拆成 `extraRepos`（托管）+ `extraDirs`（本机克隆与自带目录）（`workspaces/state.ts`、`runs/scheduler.ts`）。
- 同一目录并发（写时确认，2026-11-26）：daemon 按真实路径占用。目录空的轮次是「写者」；后来的轮次切到只读档模式（Claude `default`、Codex `read-only`、插件 readonly 模式）不提问开跑，只读照常，第一次要改文件时目录里有写者才问「并行修改 / 等它结束再改」，拿到写权后切回本档模式并照常走审批（工作区档的工作区内编辑直接放行）。没有守护模式的 agent 有写者时开跑前问「并行开始 / 排队等待」；手动 Git 操作独占。只读的轮次不认领别人的改动。见 `workspace/gate.rs`、`session/gate.rs`；真机用例 `tests/it/real_gate.rs`（Codex 运行中切模式本 prompt 不生效）。
- 「Bot 与工作区」界面每行显示分支、↓落后 ↑领先、未提交改动（取 `GitStatus.repos` 里 `kind:'extra'`），强制同步群附加项标「不参与同步」（`apps/web/src/features/repos/BotWorkspaces.tsx`）。
- 清理只删托管目录，永不删本机目录。

## 入群工作区确认
- 分区群、非共享私聊、新入群且主人在线：置 `confirm`，不发 ensure，群事件「等待 {owner} 确认工作区」（`joinWorkspace`、`confirmable`）。主人离线、强制同步群、换仓库仍直接托管克隆。
- `confirm`/`unbound` 被 @ 不执行并提示；重连不自动 ensure（`runs/trigger.ts`、`provision.ts`）。
- 本机候选：`GET /api/groups/:id/bots/:botId/repo-candidates`（仅主人）→ daemon `repo.find`，主目录下最深 4 层（`FIND_DEPTH`）找 origin 一致的仓库，并给出托管克隆目标路径；另有 `GET /api/groups/:id/local-paths` 读 `machine_repos`（`WorkspacePicker.tsx`）。

## 禁止直推基准分支
- 群开关 `groups.protect_base`：新建群默认开（`groups/create.ts`），群管理员可切；下发 `RunStart.workspace.protectBase`。
- 提示词：服务端在本轮上下文加 `branchHint`；附加仓库各以自己的默认分支为基准（`extraReposHint`，`runs/scheduler.ts`）。
- daemon 审批：推向基准分支（显式目标、`--all/--mirror`、在基准分支上裸推/`HEAD`）一律问主人且不可记住（`local.rs::pushes_base`）；Claude auto 模式加 `PUSH_ASK_RULES` 把推送拉回审批（`inject.rs::ask_pushes`）。

## Bot 提交身份
- `bots.git_name`/`git_email`，空时用 Bot 名与 `<id前8位>@${GONGGONG_BOT_EMAIL_DOMAIN || bots.gonggong.local}`（`modules/bots/git.ts`），经 `RunStart.bot.git` 下发。
- daemon 在用户 env 之后注入 `GIT_AUTHOR_*`/`GIT_COMMITTER_*`，不改仓库配置（`engine.rs`）；手动 Git 写操作也用该身份（`git_write.rs`）。

## Git 管理面板
- 只在分区群可用（`git/service.ts`：「仅分区模式群可以使用 Git 操作」）；读操作群成员都可用，所有读写带 `repo` 选子仓库/附加目录仓库。
- 能力分级：`gitOps` → `gitOps2`（refresh）→ `gitOps3`（多仓库、changes/show/blame/stashes/conflict、多数写操作）→ `gitOps4`（add/ignore/apply/restore、`expect` 防漂移）；旧 daemon 409「客户端版本过旧」（`featureFor`）。
- 写操作 `GitActionKind`（27 种，`packages/protocol/src/daemon/git.ts`），记录在 `git_operations`（`args`、`detail`、`pushesBase`）。
- 主人直接执行，运行中 409；非主人提交申请，主人审批，30 分钟过期（`PENDING_MS`），`POST /api/git-operations/:id/decide`。
- 审批前状态漂移：请求带 `expect`/`expectHead`，审批时校验（gitOps4）。
- `guardBase`：受保护基准分支不能强推、不能远程删除、不能交互式变基改写；推到基准分支主人须 `confirmBase` 二次确认；推送目标按 upstream 钉住（`pinTarget`）。
- 冲突中操作失败但保留冲突状态，`continue/abort/skip/resolve` 收尾；`resolve` 拒绝含脱敏掩码的结果。
- daemon：读操作不碰索引与工作树；写操作经目录占用检查（`hold`），`GIT_EDITOR=true`（`git_ops.rs`、`git_write.rs`）。
- Web：工作台 Git 标签（提交/日志/贮藏视图）、`GitLogTab`、`GitCompareTab`、`GitMergeTab`（三栏合并），对话框在 `features/git/dialogs`，操作入口 `gitCommands`（`features/git/commands.ts`）。

## 强制同步（`groups.mode = 'force'`）
- 乐观并发、无锁：一轮结束后 `sync.submit`，服务器逐路径比对 `baseHash`，一版整体原子；冲突时提交方先 `git merge-file` 自动三方合并，仍冲突转人工（`apps/server/src/modules/sync/engine.ts`、`crates/gonggong/src/sync/merge.rs`）。
- 只同步主仓库托管工作区；本机目录、附加仓库不参与；`.git` 不同步；范围为 `git ls-files -co --exclude-standard`，符号链接整版挂起。
- 改动单元 `SyncChange {path, hash, baseHash, exec}`；提交种类 `init/run/local/interrupted/merge`；副本问题 `drift/held/dirty/error/lost`（`packages/protocol/src/sync.ts`）。
- 上限：单文件 50 MB、单版 200 MB（`SYNC_FILE_MAX_BYTES`/`SYNC_VERSION_MAX_BYTES`，协议常量）；blob 内容寻址经 HTTPS `/api/daemon/sync/:groupId/blobs/:hash`。
- 副本状态 consistent/syncing/behind/drift/conflict/error/excluded/offline；新版本 60 秒内未一致为「同步中」，之后「落后」（`SYNCING_MS`）。
- 人工处理（群管理员或 Bot 主人）：每文件保留我的/采用最新/交给 Bot 合并，或整版丢弃（`POST /api/groups/:id/sync/conflicts/:id/{resolve,discard}`）；本地手改由主人「提交为一版/丢弃」（`…/replicas/:botId/drift`）。
- 中断：/stop 保留即提交（`interrupted`），丢弃即回滚（先备份）；断线待提交改动存 `pending.json`，同 `submitId` 幂等重发；副本状态落 `state.json` + `journal.jsonl`。
- 切换：`/sync/preview` → `/sync/enable` 由基准 Bot 整树生成一版，其余干净托管副本对齐；切回分区 `/sync/disable` 后 30 天清理数据（`sync/switch.ts`、`sync/blobs.ts`）。
- 未声明 `sync` 能力的旧 daemon 为「不参与」；托管克隆 `core.autocrlf=false`；未被跟踪且像密钥的文件拒绝提交。
- Web：`features/sync/`（`SyncBar` 状态栏、`SyncPanel`、`ConflictDialog`、`RunSyncLine`、`SyncModeTab`）。

## 空间管理
- 机器弹窗「空间」：工作区列表带大小、`lastUsedAt`、未提交/未推送 `changes`、磁盘剩余；标「可释放」只提醒不自动删（`features/machines/AdminPanels.tsx`）。
- 删除/瘦身需能力：`machineAdmin`（`workspace.delete`），`storageAdmin`（`workspace.gc` 即 `git gc --prune=now`，`POST /api/machines/:id/workspaces/gc`）；删除前持目录占用，有运行即拒（`machines/admin.ts`、`workspace.rs`）。
- daemon janitor 启动时与每 24 小时：拉活跃 pair 失败则跳过；清超过 1 天的孤儿（skill-sets、plugin-links、sync）与 30 天未用的旧 plugin-sets、旧 Node，以及旧版本留下的全部未占用 gg-cast；不碰工作区、备份、本机目录（`janitor.rs`）。

## 仍未做
- 主工作区设成任意一项（群有仓库时仍固定为主仓库）、`group_bot_workspaces` 表（`docs/plan/群内多工作区-开发计划.md` D1/D4）。
- 强制同步同步附加仓库；同仓库共享 mirror 去重、备份管理。
- Git 控制台：协议有 `GitActionDetail.commands`，web 未见展示视图。

## 来源
- `docs/plan/群内多工作区-开发计划.md`（只取已实现部分）
- `docs/archive/2026-11/工作区绑定-开发计划.md`、`入群工作区确认与分支策略-开发计划.md`、`强制同步-开发计划.md`、`Bot-Git提交身份-开发计划.md`
- `docs/archive/2026-11/Git管理-IDEA对标-开发计划.md`、`Git管理-IDEA对标-五轮迭代.md`、`空间管理-开发计划.md`
- `docs/archive/2026-11/2026-09-27-repo-binding-design.md`、`2026-09-27-git-accounts-and-chat-creation-design.md`
