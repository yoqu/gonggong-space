# 内置 MCP：Skill 管理 开发计划

依据：`团队Skill-开发计划.md`（存储/下发已完成）、`内置MCP-聊天记录与群信息-开发计划.md`（内置工具形态）。

## 已定（2026-10-10，姜维川）
1. 权限按**发起本轮的人**（`run.originUserId`）在网页上的权限：群管理员可改群层，团队管理员可改团队层；平台层只读，不开放给 bot 修改。
2. 首期工具：`skill_list`、`skill_get`、`skill_create`、`skill_update`、`skill_delete`、`skill_toggle`、`skill_versions`、`skill_rollback`。
3. 不另做内置「Skill 创作」skill：SKILL.md 规范（frontmatter `name`/`description`、目录结构、5 MB 上限、禁用名）写进 `skill_create` / `skill_update` 的工具描述。

## 方案
- 契约：`packages/protocol/src/tools.ts` 加 8 个工具（参数含 `layer: 'group' | 'team'`，默认 `group`；文件为 `[{ path, content, encoding? }]`），同步 `gonggong-tools.json`、`tool-titles.ts` 与中英词条。
- 服务：`apps/server/src/modules/agent-tools/skills.ts`，复用 `skills/routes.ts` 的 `snapshot`、`addVersion`、`nameTaken`、审计等逻辑（抽成 service，HTTP 路由与工具共用）；权限复用 `requireAdmin` / `requireTeam(...,'admin')`，以发起人身份执行，审计记 bot 与 run。
- `skill_list` 返回本群生效清单（平台/团队/群合并结果，标注层级与是否可改）；写操作只作用于本群或本群所属团队。
- 错误一律 `refuse(...)` 给 agent 可纠正的提示（如「发起人不是本群管理员，不能修改群层 Skill」）。
- 生效：沿用下发逻辑，下一轮生效；名单变化时重启适配器续接会话（已实现）。

## 切片（TDD）
| 切片 | 内容 | 验收 |
| --- | --- | --- |
| S1 | 抽 skill service，HTTP 路由行为不变 | 现有 skills 集成测试全绿 |
| S2 | 协议 + 8 个工具 + 权限 | `test/skill-tools.test.ts`：各层权限、版本、回滚、校验错误 |
| S3 | 端到端 | e2e：群里让 bot 新建 skill → 配置中心可见 → 下一轮 `/` 候选出现 |
