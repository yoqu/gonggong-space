# Bot Git 提交身份开发计划

目标：bot（agent）在工作区里 commit / push 时，提交记录的作者与提交者是 bot 自己的名字和邮箱，而不是机器主人的全局 git 配置。

## 1. 现状

| 项 | 现状 |
| --- | --- |
| 身份字段 | `bots` 无邮箱；`RunStart.bot` 只有 `id/name/agentKind/...` |
| agent 进程环境 | `engine.rs::adapter()` 不设任何 `GIT_*`，commit 用主人全局 `user.name/email` |
| commit/push | 由 agent 经 Bash 工具执行；push 走主人凭据（不变） |

## 2. 决策

| # | 项 | 结论 |
| --- | --- | --- |
| G1 | 名字 | `bots.git_name`，为空用 bot 名 |
| G2 | 邮箱 | `bots.git_email`，为空用 `<bot id 前 8 位>@<GONGGONG_BOT_EMAIL_DOMAIN>`，域名默认 `bots.gonggong.local` |
| G3 | 注入方式 | daemon 启动 agent 进程时注入 `GIT_AUTHOR_NAME/EMAIL`、`GIT_COMMITTER_NAME/EMAIL`，放在用户 env 之后（不可被覆盖）；不改仓库配置 |
| G4 | 生效时机 | 不重启已在运行的 agent 进程，下次启动进程时生效 |
| G5 | 权限 | 仅 bot 主人可改 |

## 3. 切片（TDD，每片测试全绿 + typecheck + lint）

### S1 协议
- `RunStart.bot` 增加 `git: { name, email }`（服务端算好下发）。
- 更新 `fixtures/s2d.run.start.json`，同步 `protocol.rs::RunBot`。

### S2 服务端
- `schema.ts` 增加 `bots.git_name`、`bots.git_email`（可空），`db:generate`。
- `BotDto` 与 bot 更新接口增加两字段，邮箱格式校验，仅主人可改。
- `scheduler.ts` 组装 `run.start` 时按 G1/G2 计算身份。
- 测试：默认回退、自定义值、非主人被拒、run.start 携带身份。

### S3 daemon
- `engine.rs::adapter()` 注入 4 个 `GIT_*` 变量。
- 测试：临时仓库用该 env 执行 `git commit`，`%an/%ae/%cn/%ce` 为 bot 身份。

### S4 Web
- bot 设置页增加「Git 提交身份」名字、邮箱输入框，占位显示默认值；补 `en.ts` 词条。

### S5 e2e
- 真实 agent 在群里 commit 后，`git log` 作者为 bot。

## 4. 说明
- `.local` 邮箱在 GitHub/GitLab 上不关联账号，只显示名字；需要关联时由主人填写平台上的真实邮箱。
