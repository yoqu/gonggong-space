# Skill 市场 M2 市场与发布 · 开发计划

> 依据 `Skill市场-PRD.md` §9 M2。契约：`packages/protocol/src/market.ts`（M2 段）。2026-11-04 姜维川确认开工。

## 范围

市场页、详情页、我的发布（上传文件夹 / ZIP / 粘贴 SKILL.md / GitHub 导入）、检查上游更新、引入弹窗（群/团队/仓库）、最小审核（提交 → 通过/驳回）。附带 M1 遗留：`GET /api/teams/:id/repos`、作品页逐群查询改批量。

不做：个人层（M3）、申请引入、审核 diff、封禁、通知（M4）、桌面端（D14 只读，M4 一并做）。

## 数据（一个迁移）

- `plugin_versions` 加：`review_status text not null default 'approved'`、`reviewer_id uuid null → users`、`review_note text null`、`changelog text not null default ''`。存量与各层管理员上传 = approved。
- `plugins` 加：`listed_version_id uuid null`（最新已审核版本；回填 = `version_id`）、`gh_source jsonb null`（`ListingSource`）。
- 作者条目：`scope='team'`、`team_id` = 发布时选的团队（必须是成员）、`author_id` = 作者、`visibility` 必填。各层设置页的插件/Skill 列表只显示 `author_id is null` 的条目（行为不变）。

## 规则

- **版本**：作者每次发布生成 `draft`；`submit` → `pending`；审核通过 → `approved`，`listed_version_id` 前移，跟随最新的安装在同一事务里把 `resolved` 前移；驳回 → `rejected`（必填原因，可改后再提交）。M1 中「新上传即前移安装」改为「`listed_version_id` 变化时前移」；管理员层上传仍直接 approved 并前移。
- **审核人**：`visibility=team` → 该团队 admin；`public` → sysadmin。作者不能审核自己的版本（sysadmin 自己的公开条目例外，避免无人可审）。
- **市场可见**：有 `listed_version_id` 且 `status='listed'`；`official` = 平台层；`team` = 我所在团队的团队层条目（含管理员上传）；`public` = 其他团队 `visibility=public` 的作者条目。`installable` 同步加入可见的公开条目，安装解析到 `listed_version_id`。
- **维护者**（D13）：作者；作者已不在该团队时，该团队 admin。
- **重名**：同团队同名条目 409（沿用唯一约束）；作者再次发布同名即新版本。
- **导入安全**：
  - 文件夹 / ZIP / 粘贴：web 端解析成文件（已有 `features/config/skillFiles.ts`），服务端沿用 `checkFiles`（路径、大小 5MB、文件数 `PLUGIN_MAX_FILES`）。
  - GitHub（服务端 `modules/market/github.ts`）：只接受 `https://github.com/<owner>/<repo>[/tree/<ref>/<path>]`；先调 `api.github.com/repos/<o>/<r>/commits/<ref|HEAD>` 拿 commit，再下 `codeload.github.com/<o>/<r>/zip/<commit>`；只跟随到 `github.com`/`codeload.github.com`/`api.github.com` 的重定向，最多 3 次；超时 20s；下载体积上限 20MB；fflate 解压时按条目原始大小累计，超 5MB 或超文件数即中止；拒绝 `..`、绝对路径和符号链接条目（zip 外部属性 S_IFLNK）；取 `<path>` 子目录作为根。
  - 检查上游更新：用同一 url/ref 重新取 commit，不同则生成新 draft 并更新 `gh_source`。
- **密钥/绝对路径提示**：发布接口返回 `warnings: string[]`（形如 `sk-…`、`ghp_…`、`/Users/…`），web 显示，不拦截。

## 接口

见契约。另：`GET /api/teams/:id/repos`（团队成员可读，返回 `RepoDto[]`），web 仓库 tab 改用它。

## 界面

- 左侧导航「市场」→ `features/market/MarketPage.tsx`：搜索、类型（全部/Skill/插件）、来源（官方/本团队/公开）筛选；卡片网格；点开详情（README 用现有 markdown 渲染、文件列表、版本历史与更新说明、GitHub 来源）与「引入到…」。
- 引入弹窗：目标分组「群 / 团队 / 仓库」，只列我是管理员的；版本策略 跟随最新 / 锁定当前；复用 M1 的 PUT installs 与 409 提示。
- 「我的发布」（市场页 tab）：发布（选团队、可见范围；来源：文件夹 / ZIP / 粘贴 SKILL.md / GitHub 链接）、列表（最新版本状态、驳回原因）、提交审核（填更新说明）、检查上游更新、下架/重新上架、改可见范围。
- 审核：团队设置新增「待审核」tab（团队 admin），平台配置新增「待审核」（sysadmin）：列表 + 详情 + 通过 / 驳回（填原因）。

## 分工（并行）

| 切片 | 负责 | 范围 |
|---|---|---|
| S 服务端 | 子 Agent A | schema+迁移、发布/版本/审核/市场列表与详情、installable 与跟随规则调整、teams repos 接口、作品页批量查询 |
| G GitHub 导入 | 子 Agent B | 仅 `apps/server/src/modules/market/github.ts` + 测试：`fetchGithubSkill(url, { fetch? })` → `{ files: SkillFile[], source: ListingSource }`，以及 `upstreamCommit(source, { fetch? })`。A 负责接到路由 |
| W 前端 | 子 Agent C | 市场页、详情、引入弹窗、我的发布、审核 tab、导航入口、i18n、测试 |

集成者（共字君）合并后跑 `pnpm check --all`，迁移推送前确认。
