# 文档索引

每份文档一行：路径 — 用途 — 状态。状态：**长期有效**（现行规则与事实，改代码前先读）、**进行中**（方案还在做）、**已归档**（做完或过程记录，只在追溯来由时读）。

规则：方案做完就 `git mv` 到 `docs/archive/<年月>/` 并更新本页；仍然有效的结论写进 `docs/domains/` 的领域现状说明，过程留在提交记录里。`docs/archive/` 已被根目录 `.ignore` 排除在搜索之外，需要时按路径打开。

## 顶层

- `AGENTS.md` — 开发约定（CLAUDE.md 只导入它） — 长期有效
- `docs/AI 团队工作区指挥平台 需求规格说明书（v1.0） .md` — 需求规格 — 长期有效
- `docs/快速开始.md` — 本地开发与试用上手 — 长期有效
- `docs/发版手册.md` — 服务端部署与客户端发版步骤（公开版，内部细节在 GitLab tools/gonggong-ops） — 长期有效
- `docs/原型UI-AI 对话 agent系统界面设计方案/*.dc.html` — 界面原型（界面以原型为准） — 长期有效
- `docs/design/pane/` — Pane 设计系统：`tokens.json`（与 `apps/web/src/styles/tokens.css` 由测试锁定）与组件说明 — 长期有效
- `docs/brand/logo/README.md` — logo「对眼 gg」使用规范与 SVG 全套 — 长期有效
- `docs/brand/mascot/`、`docs/brand/roles/` — 吉祥物共字君与 Bot 角色形象 — 长期有效
- `docs/release-notes/v*.md` — 各版本更新说明（与根目录 `CHANGELOG.md` 对应） — 长期有效
- `docs/promo/` — 推广文案、公众号长文与配图 — 长期有效
- `docs/community/` — 社群二维码 — 长期有效

## 领域现状说明（docs/domains）

- `docs/domains/产物与原型编辑器.md` — 产物托管、原型编辑器（对标 Stitch）与预览的现行决定 — 长期有效
- `docs/domains/插件与Skill市场.md` — 插件体系、扩展点与 Skill 市场的现行决定 — 长期有效
- 尚未写的领域（按需补）：Git 管理与强制同步、飞书联动、审批与权限、机器与 daemon、群与团队（分区、话题、未读）、定时任务、密钥、预览与远程控制、设计系统与主题

## docs/plan（长期有效与进行中）

- `docs/plan/Agent工具与供应商统一管理-设计.md` — Agent 工具与供应商统一管理 · 设计 — 进行中（S0–S6 已实现，§11 遗留待做）
- `docs/plan/P1-开发计划.md` — 共工 P1 开发计划（地基） — 长期有效
- `docs/plan/UX走查记录.md` — UX 走查记录 — 进行中（每轮走查追加，含待办）
- `docs/plan/acp-capabilities.md` — ACP 适配器能力矩阵（M1 实测，2026-09-23） — 长期有效
- `docs/plan/acp-research.md` — ACP 客户端调研（2026-09-23） — 长期有效
- `docs/plan/terminal-protocol.md` — 网页终端协议 — 长期有效
- `docs/plan/产物托管与编辑-开发计划.md` — 产物托管与编辑 · 开发计划（P3a 托管 + P3b 批注 + P3c 直接编辑） — 进行中（P3a–c 待逐项核对是否全部上线后归档）
- `docs/plan/发布与平台说明.md` — 发布与平台说明 — 长期有效
- `docs/plan/团队密钥-方案.md` — 密钥管理方案（团队 / 群 / 个人 / 本机） — 进行中（一期已上线，二、三期未开工）
- `docs/plan/安全说明.md` — 安全说明（M5 · 需求 §13、D18、风险 6） — 长期有效
- `docs/plan/插件体系-contributes-方案.md` — 插件扩展点（contributes）方案 — 进行中（S0–S2 已完成，其余每期开工前确认）
- `docs/plan/群内多工作区-开发计划.md` — 群内多工作区开发计划 — 进行中（第一期已做，第二期（按工作区报 git 状态）待做）
- `docs/plan/远程控制-低延迟改造-设计.md` — 远程控制低延迟改造 · 设计 — 进行中（仅设计，暂不开发）
- `docs/plan/预览工作台-设计.md` — 预览工作台设计：多标签的网页 / 改动 / 文件预览 — 进行中（预览已上线，待核对与设计的差异后归档）
- `docs/plan/飞书易用性-开发计划.md` — 飞书易用性开发计划（一、二期） — 进行中（一、二期 2026-11-14 刚开发，待核对是否全部上线后归档）

## docs/archive/2026-11（已归档，2026-11-15 整理）

- `docs/archive/2026-11/2026-09-27-git-accounts-and-chat-creation-design.md` — Git 账号、仓库选择器与新建群/私聊重构 设计 — 已归档
- `docs/archive/2026-11/2026-09-27-repo-binding-design.md` — 多 Git 仓库绑定、访问预检与仓库历史库 设计 — 已归档
- `docs/archive/2026-11/Bot-Git提交身份-开发计划.md` — Bot Git 提交身份开发计划 — 已归档
- `docs/archive/2026-11/Gemini-CLI接入-开发计划.md` — Gemini CLI 接入 — 开发计划 — 已归档
- `docs/archive/2026-11/Git管理-IDEA对标-五轮迭代.md` — Git 管理对标 IntelliJ IDEA — 五轮迭代 — 已归档
- `docs/archive/2026-11/Git管理-IDEA对标-开发计划.md` — Git 管理对标 IntelliJ IDEA — 开发计划 — 已归档
- `docs/archive/2026-11/M1-验收报告.md` — M1 验收报告（2026-09-23） — 已归档
- `docs/archive/2026-11/M2-验收报告.md` — M2 验收报告（2026-09-23） — 已归档
- `docs/archive/2026-11/M3-验收报告.md` — M3 验收报告（2026-09-23） — 已归档
- `docs/archive/2026-11/M4-验收报告.md` — M4 验收报告（2026-09-23） — 已归档
- `docs/archive/2026-11/M5-验收报告.md` — M5 验收报告（2026-09-23） — 已归档
- `docs/archive/2026-11/P1-总验收报告.md` — P1 总验收报告（2026-09-24） — 已归档
- `docs/archive/2026-11/Pane设计系统落地-开发计划.md` — Pane 设计系统落地开发计划 — 已归档
- `docs/archive/2026-11/Skill市场-M1-开发计划.md` — Skill 市场 M1 底座 · 开发计划 — 已归档
- `docs/archive/2026-11/Skill市场-M2-开发计划.md` — Skill 市场 M2 市场与发布 · 开发计划 — 已归档
- `docs/archive/2026-11/Skill市场-M3-开发计划.md` — Skill 市场 M3 个人层 · 开发计划 — 已归档
- `docs/archive/2026-11/Skill市场-M4-开发计划.md` — Skill 市场 M4 审核台与申请 · 开发计划 — 已归档
- `docs/archive/2026-11/Skill市场-PRD.md` — Skill 市场 PRD — 已归档
- `docs/archive/2026-11/UX走查-2026-11-09.md` — UX 全量走查（2026-11-09） — 已归档
- `docs/archive/2026-11/macOS27-视觉与动效重构-开发计划.md` — macOS 27 视觉与动效重构开发计划 — 已归档
- `docs/archive/2026-11/stitch-对比-第1轮.md` — Stitch × 共工原型编辑器 对比评审（第 1 轮） — 已归档
- `docs/archive/2026-11/stitch-对比-第2轮.md` — Stitch × 共工原型编辑器 对比评审（第 2 轮） — 已归档
- `docs/archive/2026-11/stitch-对比-第3轮.md` — Stitch × 共工原型编辑器 对比评审（第 3 轮：能力完整性） — 已归档
- `docs/archive/2026-11/stitch-对比-第4轮.md` — Stitch × 共工原型编辑器 对比评审（第 4 轮：全流程走查 + 视觉细节） — 已归档
- `docs/archive/2026-11/stitch-对比-第5轮-验收.md` — Stitch × 共工原型编辑器 对比评审（第 5 轮：终轮验收） — 已归档
- `docs/archive/2026-11/stitch-能力清单.md` — Google Stitch 能力清单（一比一复刻用） — 已归档
- `docs/archive/2026-11/terminal-acceptance.md` — 网页终端真实验收 — 已归档
- `docs/archive/2026-11/入群工作区确认与分支策略-开发计划.md` — 入群工作区确认与分支策略 开发计划 — 已归档
- `docs/archive/2026-11/内置MCP-Skill管理-开发计划.md` — 内置 MCP：Skill 管理 开发计划 — 已归档
- `docs/archive/2026-11/内置MCP-聊天记录与群信息-开发计划.md` — 内置 MCP 扩展开发计划：聊天记录、群信息、运行记录 — 已归档
- `docs/archive/2026-11/原型提示词-Stitch对照三轮.md` — 产品原型提示词 · Stitch 对照三轮（2026-10-31） — 已归档
- `docs/archive/2026-11/原型编辑器-Stitch对标-开发计划.md` — 原型编辑器 · Stitch 对标开发计划 — 已归档
- `docs/archive/2026-11/原型预览走查-2026-11-09.md` — 原型预览界面走查（2026-11-09） — 已归档
- `docs/archive/2026-11/团队Skill-开发计划.md` — 团队 Skill 开发计划（草案，待讨论） — 已归档
- `docs/archive/2026-11/团队分区与入群申请-开发计划.md` — 团队分区与入群申请 开发计划 — 已归档
- `docs/archive/2026-11/团队层级-开发计划.md` — 团队层级开发计划 — 已归档
- `docs/archive/2026-11/定时任务-开发计划.md` — 定时任务开发计划 — 已归档
- `docs/archive/2026-11/审批降频-开发计划.md` — 审批降频开发计划 — 已归档
- `docs/archive/2026-11/客户端一键接入与Bot管理收归服务端-开发计划.md` — 客户端一键接入 + Bot 管理收归服务端 — 已归档
- `docs/archive/2026-11/富交互消息-开发计划.md` — 富交互消息（Rich UI）开发计划 — 已归档
- `docs/archive/2026-11/工作区绑定-开发计划.md` — 工作区绑定开发计划 — 已归档
- `docs/archive/2026-11/开发流程提速-方案.md` — 开发流程提速方案（编码 → 测试 → 提交推送） — 已归档
- `docs/archive/2026-11/强制同步-开发计划.md` — 强制同步开发计划 — 已归档
- `docs/archive/2026-11/接入码过期改网页确认-设计.md` — 接入码过期改网页确认 + 新人走查剩余问题（设计） — 已归档
- `docs/archive/2026-11/插件Skill市场-体验迭代.md` — 插件 / Skill 市场 · 体验迭代（5 轮） — 已归档
- `docs/archive/2026-11/插件体系-创作重构-开发计划.md` — 插件体系 · 创作重构开发计划 — 已归档
- `docs/archive/2026-11/插件体系-开发计划.md` — 插件体系 · 开发计划（一期：P1 底座 + P2 创作入口） — 已归档
- `docs/archive/2026-11/插件体系-方案.md` — 插件体系方案（open-design 融入） — 已归档
- `docs/archive/2026-11/文件预览优化-10轮.md` — 文件预览优化（10 轮） — 已归档
- `docs/archive/2026-11/未读与通知-开发计划.md` — 未读、通知与稍后处理（P0 其余项）开发计划 — 已归档
- `docs/archive/2026-11/机器-Docker与Git访问-方案.md` — 机器管理：Docker 机器与 Git 访问方案 — 已归档
- `docs/archive/2026-11/模型与推理强度-开发计划.md` — 模型与推理强度：服务端配置 + 对话内切换 — 已归档
- `docs/archive/2026-11/浅色主题-开发计划.md` — 浅色主题开发计划 — 已归档
- `docs/archive/2026-11/空间管理-开发计划.md` — 本机 daemon 空间管理 — 开发计划 — 已归档
- `docs/archive/2026-11/结果预览-开发计划.md` — 结果预览开发计划：服务托管、端口隧道与桌面应用推流 — 已归档
- `docs/archive/2026-11/群标签栏-设计.md` — 群标签栏（设计） — 已归档
- `docs/archive/2026-11/聊天内容区-飞书化重构-开发计划.md` — 聊天内容区飞书化重构开发计划（草案） — 已归档
- `docs/archive/2026-11/话题-开发计划.md` — 话题（Thread）开发计划 — 已归档
- `docs/archive/2026-11/飞书联动-开发计划.md` — 飞书联动开发计划（草案） — 已归档
