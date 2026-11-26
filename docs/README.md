# 文档索引

长期有效 = 现行规则与事实；进行中 = 方案或待办还没做完。已归档文档见 [archive/README.md](archive/README.md)（被 `.ignore` 排除在搜索外，只在追溯来由时按路径读）。

规则：方案做完就 `git mv` 到 `docs/archive/<年月>/` 并在 archive 索引加一行；仍有效的结论写进 `docs/domains/`；做了一部分的，把剩余项压成 `docs/plan/<名>-待办.md`。

## 顶层（长期有效）

- `AGENTS.md` — 开发约定（CLAUDE.md 只导入它）
- `docs/AI 团队工作区指挥平台 需求规格说明书（v1.0） .md` — 需求规格
- `docs/快速开始.md` — 本地开发与试用上手
- `docs/发版手册.md` — 部署与发版步骤（内部细节在 GitLab tools/gonggong-ops）
- `docs/原型UI-AI 对话 agent系统界面设计方案/*.dc.html` — 界面原型（界面以原型为准）
- `docs/design/pane/` — Pane 设计系统（`tokens.json` 与 `tokens.css` 由测试锁定）
- `docs/brand/` — logo 使用规范（`logo/README.md`）、吉祥物与 Bot 角色形象
- `docs/release-notes/`、`docs/promo/`、`docs/community/` — 版本说明、推广物料、社群（已排除在搜索外）

## 领域现状（docs/domains，以代码为准）

- `docs/domains/ACP与daemon协议.md` — ACP 与 daemon 协议
- `docs/domains/产物与原型编辑器.md` — 产物与原型编辑器
- `docs/domains/供应商与Agent设置.md` — 供应商与 Agent 设置
- `docs/domains/双机构建.md` — 双机构建与测试（peer.sh、check 分流、发版 x86_64 交给对端）
- `docs/domains/工作区与Git.md` — 工作区与 Git
- `docs/domains/插件与Skill市场.md` — 插件与 Skill 市场
- `docs/domains/飞书联动.md` — 飞书联动
- 未写：审批与权限、群与团队（分区、话题、未读）、定时任务、密钥、设计系统与主题

## docs/plan

- `docs/plan/Agent工具与供应商-待办.md` — Agent 工具与供应商 · 待办（核对于 2026-11-15） — 进行中
- `docs/plan/P1-开发计划.md` — 共工 P1 开发计划（地基） — 长期有效
- `docs/plan/UX原则回归记录.md` — UX 原则定期回归审查记录（8 条原则已修与待办） — 长期有效
- `docs/plan/UX走查记录.md` — UX 走查记录 — 进行中
- `docs/plan/acp-capabilities.md` — ACP 适配器能力矩阵（M1 实测，2026-09-23） — 长期有效
- `docs/plan/acp-research.md` — ACP 客户端调研（2026-09-23） — 长期有效
- `docs/plan/terminal-protocol.md` — 网页终端协议 — 长期有效
- `docs/plan/代码整合记录.md` — 代码冗余整合扫描记录（每日定时扫描维护 P2/P3 待办） — 长期有效
- `docs/plan/产物容器-开发计划.md` — 产物容器（幻灯片 / 白板 / 动效）开发计划 — 已定待开工
- `docs/plan/产物容器-S0-spike.md` — 产物容器 S0：open-artifact 引入与幻灯片编辑器接入 spike（能力清单、URL、CSP、对计划的修正） — 进行中
- `docs/plan/产物托管与编辑-待办.md` — 产物托管与编辑 · 待办 — 进行中
- `docs/plan/原型协作-AI编辑可视化与多人光标-方案.md` — 原型协作：AI 编辑可视化 + 多人光标 — 已定待开工
- `docs/plan/发布与平台说明.md` — 发布与平台说明 — 长期有效
- `docs/plan/团队密钥-方案.md` — 密钥管理方案（团队 / 群 / 个人 / 本机） — 进行中
- `docs/plan/Skill密钥声明-方案.md` — Skill 密钥声明与配置引导（团队密钥二期） — 评审中
- `docs/plan/安全说明.md` — 安全说明（M5 · 需求 §13、D18、风险 6） — 长期有效
- `docs/plan/插件体系-contributes-方案.md` — 插件扩展点（contributes）方案 — 进行中
- `docs/plan/群内多工作区-开发计划.md` — 群内多工作区开发计划 — 进行中
- `docs/plan/群Webhook-方案.md` — 群 Webhook（入站开放接口）方案 — 代码已完成，待部署后配置 Jenkins
- `docs/plan/连接器-方案.md` — 连接器 M1（对标 WorkBuddy）调研与基础方案 — 已上线基础闭环
- `docs/plan/连接器-体验升级方案.md` — 连接器体验升级终稿（gemini大师 + 共字君综合：自动检测、弹窗一站式连接、按人隔离、多机状态；二期不打断） — 已定待开工
- `docs/plan/预览工作台-待办.md` — 预览工作台 · 待办 — 进行中
