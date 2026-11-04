# Skill 市场 M3 个人层 · 开发计划

> 依据 `Skill市场-PRD.md` §5、§9 M3。契约：`market.ts`（M3 段）、`RunDto.personalSkills`。2026-11-04 姜维川确认开工。

## 结论：daemon 不用改

daemon 每轮开始都会按 `RunStart.skills` 重装 skill-set（`session.rs` `ready` → `skills::install`），名单变化时重启 adapter 并接续会话、清理旧的 Codex 链接。个人层只是服务端算名单时多一层，skill-set 键仍是「群 + Bot」（D15）。所以本期**不发 daemon 客户端**。

## 规则

- **安装**：`installs.scope='user'`、`scope_id=用户 id`。只允许 `type='skill'` 的条目（插件 400）。同一用户内名称唯一（409）。
- **可安装**：市场里我能看到的条目（M2 可见规则）+ 我维护的条目（含未审核）。我维护的条目「跟随最新」解析到最新上传版本（自测）；其余解析到 `listed_version_id`。锁定只能锁我可见的版本。
- **发起人**：`runs.origin_user_id`（@ 的人；hand_off 已继承；定时任务为创建者）。没有个人层的情况：沿用现状即可（origin 一定是人）。
- **团队边界**（每次下发时检查）：
  - 平台层条目、`visibility=public` 条目：任何群都加载；
  - `visibility=team` 条目（含我自己的草稿）：只在 `groups.team_id = 条目 team_id` 的群加载，且发起人仍是该团队成员；否则跳过；
  - `banned` 不加载；`unlisted` 照常加载已解析版本。
- **合并**：个人层最高（D8：仓库自带文件 > 个人 > 群 > 仓库 > 团队 > 平台）。群级「关闭继承」不作用于个人层。
- **daemon 拉取权限**：`GET /api/daemon/skills/:versionId` 对个人层版本放行条件：该版本被某用户的 user 安装解析到，且该用户是本机器上 Bot 的某个**未结束运行**的发起人。
- **运行显示**：`runs` 加 `personal_skills integer not null default 0`，开始下发时写入；`RunDto.personalSkills` 返回。界面只显示「使用了 N 个个人 Skill」，不显示名称。

## 接口

`GET|PUT|DELETE /api/me/installs[/:listingId]`、`GET /api/me/installable`（契约同 M1 `InstallDto`/`InstallableDto`，`scope='user'`）。

## 界面

- 个人设置（`features/settings/SettingsDialog.tsx`）新增「我的 Skill」tab：`InstallList base="/me"` + 去市场的入口。
- 市场「引入到…」弹窗加「我的个人」目标（总是可选，无需管理员）。
- 运行卡片 / 运行详情（找现有展示 model、usage 的位置）在 `personalSkills > 0` 时显示「使用了 N 个个人 Skill」。

## 验收

- A 有个人 Skill `x`、B 没有：A 发起 → 名单含 x；B 发起 → 不含；A 再发起 → 含（服务端名单层面；daemon 层的文件/链接清理由现有测试覆盖）。
- 「仅本团队」个人 Skill 在其他团队的群不下发；发起人离队后不下发；hand_off 接力到他队群时重新判断。
- 个人层覆盖群层同名 Skill；群「关闭继承」不影响个人层。
- 维护者自测：草稿可装到个人，跟随最新上传。
- daemon 拉取：无对应运行的机器拉个人版本 403/404。

## 分工

| 切片 | 范围 |
|---|---|
| S 服务端 | 迁移（runs.personal_skills）、/api/me 安装、enabledSkills 加个人层与团队边界、scheduler 传发起人并写计数、daemon 拉取权限、RunDto、测试 |
| W 前端 | 我的 Skill tab、引入弹窗「我的个人」、运行上的个人 Skill 计数、i18n、测试 |
