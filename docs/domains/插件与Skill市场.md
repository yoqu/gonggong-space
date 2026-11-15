# 插件与 Skill 市场 · 现状

> 范围：插件包、Skill、市场条目与引入、插件扩展点（contributes）、安全约束。只写仍有效的决定，以代码为准，更新于 2026-11-15。

## 核心概念
- 插件 = 目录 + 清单 `gonggong-plugin.json`（`PluginManifest`，`packages/protocol/src/plugins.ts`）；单包 ≤5MB、≤600 文件（`PLUGIN_MAX_BYTES/FILES`）。
- 清单要点：`category`（web/deck/poster/dashboard/video/other/tool/agent/provider，市场按 `PluginShelf` 分创作/工具/Agent/供应商四栏）、`agents`（支持的 Agent）、`minDaemon`、`entry`（可空，有模板/设计系统/输入项时必填）、`permissions`、`contributes`、`secrets`、`templates`/`designSystems`/`inputs`/`composer`/`artifact.kit`、`license` 可选。
- Skill：手写 Skill 存 `skills`/`skill_versions` 表（平台/团队/群三层）；市场 Skill 条目是根目录只有 `SKILL.md` 的包，`type='skill'`，下发名不加前缀。
- 市场条目（Listing）= `plugins` 表一行，`type` 为 `plugin|skill`；字段 `authorId`、`visibility`（public|team）、`status`（listed|unlisted|banned）、`listedVersionId`、`ghSource`、`banReason`、`statusBeforeBan`（`apps/server/src/db/schema.ts`）。
- 版本 = `plugin_versions` 不可变快照（files jsonb + manifest + digest），`reviewStatus` 为 draft|pending|approved|rejected，带 `changelog`；内容不变不出新版本。
- 引入（Install）= `installs` 表，`scope` 为 user|group|repo|team（`InstallScope`）；`pinVersionId=null` 为跟随最新已审核版本，`resolvedVersionId` 为实际生效版本。平台层不走引入，直接是平台层条目。
- 群里启用插件 = 群作用域的 install（旧 `group_plugins` 已迁移并删除）；群「关闭继承」用 `group_skill_overrides`，不作用于个人层。
- 合并优先级：仓库自带同名文件 > 个人(user) > 群 > 仓库 > 团队 > 平台（`LAYER_RANK`、`mergeSkills`，`apps/server/src/modules/skills/service.ts`）；仓库自带同名由 daemon 跳过（`crates/gonggong/src/skills.rs`）。
- 同层同名一律 409，不自动覆盖（`market/service.ts` 同名检查）。
- 仓库层：群主仓库（`group_repos.is_primary`）按 repo key 匹配团队仓库的引入。
- 个人层：只在本人发起的运行（`runs.origin_user_id`，hand_off 继承、定时任务为创建者）里生效；只能引入 Skill；`visibility=team` 的只在该团队群且本人仍在队时下发；运行只记个数 `runs.personal_skills`。
- 下发：Claude 每个插件一个本地插件目录（skill 名 `<插件>:<skill>`），团队/市场 Skill 合成 `gonggong-team` 插件；Codex/Gemini 用 `<cwd>/.agents/skills/` 软链并写 `.git/info/exclude`（`crates/gonggong/src/plugins.rs`、`skills.rs`）。名单变化重启 adapter 并接续会话，下一轮生效。
- 内置插件 `apps/server/plugins/official/*` 启动时 `syncBuiltinPlugins` 装到平台层：不可删、平台层不可同名覆盖，团队/群层可上传同名替换；仍需群里打开才生效。
- 只带供应商预设或只带 Agent 的插件不出现在群插件列表。

## 发布与审核
- 作者在「我的发布」上传（文件夹/ZIP/粘贴 SKILL.md）或 GitHub 导入，条目挂在所选团队（须是成员）；每次发布生成 draft，`/submit` → pending（`market/publish.ts`）。
- 审核人：`visibility=team` 为团队 admin，`public` 为 sysadmin；不能审自己的版本（sysadmin 自己的公开条目例外）；驳回必填原因。
- 通过后 `listedVersionId` 前移，跟随最新的引入同一事务前移并通知引入方；锁定版本的引入显示「有新版本」由管理员手动升级。
- 已有版本审核通过后不能再改可见范围；各层管理员直接上传的版本直接 approved。
- 市场可见：已审核且 listed；来源分 official（平台层）/team（我所在团队）/public（他队公开）。
- 下架：不能新引入，已有引入停在 resolved 版本；封禁：所有作用域（含个人）下一轮停止下发、不可新装，必填原因；解封恢复封禁前状态。
- 审核 diff 对比该版本之前最近的 approved 版本（`/api/market/:id/versions/:v/diff`）。
- 引入权限：群管理员/团队 admin 直接引入，成员发「申请引入」（`install_requests`，`market/requests.ts`），通过时在同一事务内引入；个人引入无需审批，可装自己维护的草稿自测。
- GitHub 导入：只认 github.com/codeload/api.github.com，重定向 ≤3、超时 20s、下载 ≤20MB，拒绝 `..`、绝对路径、软链；只做手动「检查上游更新」，新提交生成新草稿（`market/github.ts`）。
- 通知：提交审核、审核结果、封禁、自动升级、申请与处理都发站内通知并推送。
- 桌面端只读（`apps/desktop/src/pages/Market.tsx`），上传、引入、审核只在 web。
- Agent 侧 MCP 工具：`skill_*`（8 个，按发起人权限改群/团队层）、`market_*`（list/get/publish/mine/submit/update/installs/install/uninstall/reviews/review，以发起人身份执行）、`plugin_catalog`、`creation_propose`（`packages/protocol/src/tools.ts`、`apps/server/src/modules/agent-tools/`）。

## 插件扩展点（`contributes`）
- 现有四项：`mcp`、`commands`、`providers`、`agents`（`PluginContributes`）。Tab 未实现。
- `mcp`：stdio（`command`，`{node}`/`{pkg}` 占位，脚本须用 `{pkg}/…` 绝对路径且上传时校验存在）或 http（`url`+`headers`）；下发名 `<插件>-<name>`；值里 `${secret:NAME}` 必须在清单 `secrets` 中，缺密钥本轮不下发；需 daemon 能力 `pluginMcp`。
- `commands`：`where: 'chat'` 进输入框 `/` 的「插件」分组，发送时追加 `prompt`（`{args}`）和入口 skill；`where: 'artifact'` 进画布「生成」与 `/` 菜单（`{dir}`，`GET /api/artifacts/:id/commands`）；与系统命令重名上传即拒。
- 画布指令：平台只留通用指令，产品原型专属指令在 `web-prototype` 插件清单里。
- `providers`：只允许平台层插件；daemon 连上和平台插件变化时下发 `presets.sync`（能力 `presetSync`），叠加在二进制自带预设上；官方预设为内置插件 `provider-presets`，由 `scripts/sync-provider-presets.mjs` 生成。
- `agents`：声明式适配器 `PluginAgent`（install/acp/systemPrompt/mcp/skills/tiers/provider/home/login/state/launchScript 等封闭策略）；`launchScript` 用 daemon 的 Node 运行，stdin/stdout JSON，超时 10 秒，失败本轮报错。
- 内置 Agent 插件：`agent-gemini`、`agent-codebuddy`、`agent-pi`、`agent-deepseek`、`agent-antigravity`，daemon 用 `include_str!` 编进二进制（`crates/gonggong/src/adapters.rs`），按摘要写到 `<home>/agent-pkgs/`；Claude、Codex 仍是代码适配器。
- 通用「共工审批请求」：扩展发 `confirm`，体为 `{"gonggong":{toolCallId,title?,input}}`，daemon 转成对该工具调用的审批。
- 创作：`POST /api/groups/:id/creations`（`plugins/creations.ts`），步骤由 `creationSteps` 推导；对话里 AI 先 `creation_propose` 发确认卡，成员点「开始」才开工。
- 样例插件：`examples/plugins/dashboard`。

## 安全约束
- 两个系统参数，默认都关：`pluginsEnabled`（插件总开关，关闭时零下发）、`pluginCodeEnabled`（插件代码）（`apps/server/src/modules/admin/params.ts`）。
- 路径白名单：只收 `gonggong-plugin.json`、根目录 `*.md`、`LICENSE`、`skills/`、`previews/`、`assets/`、`contrib/{mcp,agents,tabs}/`（`ALLOWED_PATH`，`plugins/service.ts`）；daemon 解包时 `confine` 再删一遍其余路径。
- `permissions` 只有 `exec`、`network`，必须正好等于 `requiredPermissions(contributes)`（stdio MCP 或 agents → exec，http MCP → network）。
- 带 `exec`：需 `pluginCodeEnabled`、机器主人按（机器，版本）授权（`plugin_trusts`，`plugin_trust` 通知，「我的机器 → 插件授权」，`PluginTrustsPanel.tsx`），拒绝不再追问，新版本要重新授权。
- 带 `exec`：市场引入必须锁定版本；不能公开（上传、预检、改可见范围都拦），只能团队内可见。
- 下发条件统一由 `pluginBlocker` 判定：agent 不符、离线、daemon 版本/能力不足、代码开关关、缺密钥、未授权。
- 不变底线：插件不能提高 Bot 权限档位，工具调用照常走审批，拿不到平台会话凭据。

## 主要代码入口
- 协议：`packages/protocol/src/plugins.ts`、`market.ts`、`daemon.ts`（`PluginRef`、`DaemonFeature`）、`tools.ts`。
- 服务端：`apps/server/src/modules/plugins/`（service/routes/creations/trusts/presets/builtin）、`modules/market/`（service 引入、publish 发布审核、requests 申请、github 导入、routes）、`modules/skills/`、`modules/agent-tools/{market,skills,plugins}.ts`、`modules/runs/scheduler.ts`（`buildRunStart` 调 `runPlugins`、`enabledSkills`）。
- 内置插件：`apps/server/plugins/official/`（web-prototype、slides、provider-presets、agent-*）。
- Web：`apps/web/src/features/market/`、`features/plugins/`（创作面板、插件层管理）、`features/machines/PluginTrustsPanel.tsx`。
- daemon：`crates/gonggong/src/plugins.rs`、`skills.rs`、`adapters.rs`、`protocol.rs`。

## 仍未做（plan 明确待做）
- S4 开放自定义 Agent：`AgentKind` 改字符串 id、安装范围加 `machine`、`adapters.sync`、去掉 `LATER_AGENTS`、界面读 daemon 上报的 `AgentInfo`（目前仍是封闭枚举，`scheduler.ts` 仍有 `LATER_AGENTS`）。
- S5 工作台 Tab：`contributes.tabs`、`GroupTabTarget` 加 `plugin`、`ui` 权限。
- `contributes.mcp` 的 `npm` 字段（daemon 按插件装固定版本 npm 包）。
- `client_release_*` 迁成私有插件（插件拿不到平台凭据，需另行设计）。

## 来源
- `docs/plan/插件体系-contributes-方案.md`
- `docs/plan/Agent工具与供应商统一管理-设计.md`
- `docs/archive/2026-11/插件体系-方案.md`、`插件体系-开发计划.md`、`插件体系-创作重构-开发计划.md`
- `docs/archive/2026-11/Skill市场-PRD.md`、`Skill市场-M1-开发计划.md` ~ `Skill市场-M4-开发计划.md`
- `docs/archive/2026-11/插件Skill市场-体验迭代.md`、`团队Skill-开发计划.md`、`内置MCP-Skill管理-开发计划.md`
