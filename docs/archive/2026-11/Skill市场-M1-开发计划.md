# Skill 市场 M1 底座 · 开发计划

> 依据 `Skill市场-PRD.md` §9 M1。契约：`packages/protocol/src/market.ts`。2026-11-04 姜维川确认开工。

## 范围

- 条目（Listing）= 现有 `plugins` 表，新增 `type`（plugin|skill）、`authorId`、`visibility`、`status`。
- 安装（Install）= 新表 `installs`，取代 `group_plugins`。
- 下发：Skill 按 **群 > 仓库 > 团队 > 平台** 合并（手写 Skill 与 skill 条目的安装一起参与），仓库自带同名文件仍由 daemon 跳过。插件条目只看安装，不参与 Skill 合并。
- 不做：个人层（M3）、市场页与导入（M2）、审核（M2/M4）。daemon 不改。

## 数据

- `plugins` 加列：`type text not null default 'plugin'`、`author_id uuid null → users`、`visibility text null`（public|team，M2 用）、`status text not null default 'listed'`。`plugin_versions.manifest` 对 skill 条目存 `SkillListingManifest`。
- 新表 `installs`：`id, listing_id → plugins (cascade), scope (group|repo|team|user), scope_id uuid, pin_version_id null, resolved_version_id → plugin_versions, enabled, updated_by, updated_at`；唯一 `(listing_id, scope, scope_id)`。
- 迁移：`group_plugins` 每行 → `installs(scope='group', scope_id=group_id, enabled 原值, resolved = 条目当前版本)`，然后删表。没有行的群不生成安装（保持关闭）。

## 规则

- **仓库层**：群的主仓库 `group_repos.is_primary` 的 url → `repoKey` → 同团队 `repos(team_id, key)`。
- **可见性**：可安装到某作用域的条目 = 平台层 + 该作用域所属团队层（+ 群作用域时该群层）的条目，`status = 'listed'`。
- **同层冲突**（409「同名 Skill 已存在」）：同一作用域内 skill 条目安装名与另一 skill 安装名重复；群/团队作用域内与同层手写 Skill 重名。反向：在群/团队创建或改名手写 Skill 时与同层 skill 安装重名也 409。
- **跟随 / 锁定**：`pin_version_id = null` 时 `resolved` 跟随条目当前版本（条目出新版本时在同一事务里前移）；锁定时等于 pin。
- **状态**：`unlisted` 照常下发 resolved 版本；`banned` 不下发、不可新装。
- **插件**：`GET/PUT /api/groups/:id/plugins…` 接口形状不变，改为读写群作用域安装；`runPlugins` 读群 + 仓库 + 团队的插件安装（一个条目在多层都装了只发一次，以最高层的启用状态为准）。
- **Skill 条目下发**：并入 `enabledSkills` 的 `SkillRef`（`versionId` 为 `plugin_versions.id`），`GET /api/daemon/skills/:versionId` 同时能取 skill 条目的版本文件。群级「关闭继承」(`group_skill_overrides`) 对继承来的 skill 条目同样生效。
- **上传 skill 条目**：现有各层插件上传接口收到根目录有 `SKILL.md`、没有 `gonggong-plugin.json` 的文件夹时存为 `type='skill'`（名称规则同手写 Skill，≤64）。现有插件列表接口只返回 `type='plugin'`。`PluginManifest.license` 改为可选。

## 接口（契约见 market.ts）

- `GET|PUT|DELETE /api/groups/:id/installs[/:listingId]`、`GET /api/groups/:id/installable` —— 群管理员写，成员读。
- `GET|PUT|DELETE /api/teams/:id/installs[/:listingId]`、`…/installable` —— 团队 admin。
- `GET|PUT|DELETE /api/teams/:id/repos/:repoId/installs[/:listingId]`、`…/installable` —— 团队 admin。

## 界面

- 共享组件 `features/market/InstallList.tsx`：已安装列表（名称、类型、来源层、版本「跟随最新 / 锁定 rN」、开关、移除）+「从已有条目引入」弹窗（读 installable）。
- 群设置 Skill tab、团队设置 Skill tab 下方加「已引入」区块；团队设置新增「仓库」tab：团队仓库列表，点开显示该仓库的 InstallList。
- 桌面端只读（D14）。

## 分工（并行）

| 切片 | 负责 | 范围 |
|---|---|---|
| S 服务端 | 子 Agent A | `apps/server`：schema、迁移、installs 服务与路由、合并/下发、skill 条目上传、测试 |
| W 前端 | 子 Agent B | `apps/web`（+ desktop 只读）：InstallList、仓库 tab、i18n、测试 |

集成者（共字君）合并后跑 `pnpm check --all` 与迁移确认。
