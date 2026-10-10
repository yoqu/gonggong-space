# 团队 Skill 开发计划（草案，待讨论）

需求依据：规格 §7 配置中心（skill 走「仓库基线 → 平台层 → 团队层 → 群层」叠加，写入 agent 本地专用位置并加 `.git/info/exclude`，不碰 `~/.claude`、`~/.codex`）、§8.7 `/` 候选。

## 现状
- 配置中心 MCP 三层（平台/团队/群）已落地：`mcp_servers` 表 + `RunStart.mcpServers` 下发，同名下层覆盖。
- Skill 标签页是占位（`ConfigPage.tsx` `UnsupportedArt`）；`/` 候选的 skill 只来自 agent 经 ACP 上报的命令。
- daemon 已有写 `.git/info/exclude` 的现成逻辑（`attachments.rs`）。

## 目标
管理员在网页维护一份 skill，全员 bot 下一轮自动生效；可按平台/团队/群分层启用；工作树保持干净，不随强制同步传播。

## 方案

### 1. 数据模型（server）
- `skills`：`scope/teamId/groupId/name/enabled/description/currentVersion`，唯一键同 `mcp_servers`。
- `skill_versions`：`skillId/version/files(jsonb 或对象存储)/digest/createdBy/createdAt`。文件 = `SKILL.md` + 附属脚本/参考文档，单 skill 上限如 5 MB。
- 校验：`SKILL.md` frontmatter 必须有 `name`、`description`；name 不得与系统命令（/stop /new /cd）及 `gonggong` 重名。

### 2. 维护方式（web）
- 配置中心 Skill 页：列表（层级、启用开关、版本、更新人）+ 上传 zip / 文件夹 + 在线编辑 `SKILL.md`。
- 版本历史与回滚；每次保存生成新版本，记审计日志。

### 3. 下发（protocol + daemon）
- `RunStart` 新增 `skills: [{ name, digest, url }]`（合并后的最终清单，server 计算覆盖）。
- daemon 按 digest 缓存 skill 文件（`<home>/skills/<digest>/`），变化才下载；每个 bot 组装一个插件目录 `<home>/skill-sets/<botId>/`（`.claude-plugin/plugin.json` name=`gonggong-team` + `skills/<name>` 软链到缓存）。
- 落地映射（K0 实测，见 `acp-capabilities.md`「Skill 落地」）：
  - Claude：`session/new|resume` 的 `_meta.claudeCode.options.plugins` 指向插件目录，不落工作区。
  - Codex：`<cwd>/.agents/skills/<name>` 软链到插件目录内的 skill，加入 `.git/info/exclude`；移除的 skill 删软链。
  - 两边都显示为 `gonggong-team:<name>`。
- 与仓库基线同名（cwd 到仓库根的 `.claude/skills/<name>` 或 `.agents/skills/<name>`）：跳过团队版，运行卡片提示。
- 生效时机：只改内容，下一轮直接生效；skill 名单变化时，沿用「换供应商」的逻辑起新适配器进程并 resume 原会话（Claude 会话内不发现新增 skill）。

### 4. `/` 候选
- 未 @ bot：显示平台+团队+群层 skill；已 @ bot：再合并该 bot 上报的命令，去重。

## 切片（TDD，每片独立可验收）
| 切片 | 内容 | 验收 |
| --- | --- | --- |
| K0 实测 ✅ | Claude/Codex 的 skill 落地位置、热加载、ACP 注入可行性，产出映射表 | `acp-capabilities.md` 补表 |
| K1 存储与 API ✅ | 表、迁移、CRUD、版本、三层合并、校验 | server 集成测试 |
| K2 配置中心 UI ✅ | 列表/上传/编辑/版本回滚，中英词条 | web 单测 + 原型对齐 |
| K3 下发 ✅ | protocol + fixture + Rust 解析、缓存、落地、exclude、同名冲突提示 | cargo test + fixture 往返 |
| K4 候选与端到端 | `/` 候选合并；e2e：管理员上传 → bot 下一轮可用 → 工作树干净 | Playwright |

预估：K0 0.5 天，K1 1 天，K2 1.5 天，K3 1.5 天，K4 1 天。

## 已定（2026-10-10，姜维川）
1. 来源：仅网页上传 / 在线编辑，不做 Git 仓库同步。
2. 层级：平台 / 团队 / 群三层首期全做。
3. 与仓库已有 skill 同名：跳过团队版，在运行卡片提示。
4. 首期做版本历史与回滚。
