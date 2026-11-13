# Configuration center

This page explains how layers stack in the configuration center, and the platform-layer MCP, Skills, plugins, secrets, and market review that sysadmins configure here.

![Admin console · Configuration center](/screenshots/web/admin-config.webp)

## Layering

When a Bot works, the configuration its Agent actually uses is built from several layers, from lowest to highest:

| Layer | Where it's configured | Priority |
| --- | --- | --- |
| Repository baseline | `.mcp.json`, `.claude/`, `AGENTS.md`, etc. in the group's bound repository | Low |
| Bot system prompt | Set per Bot on the Bot page; see [Bot settings and permissions](/en/user/bot-settings) | — |
| Platform layer | Admin console · Configuration center (this page) | Medium |
| Team layer | Configured by team admins in 「团队设置」 (Team settings) | Medium |
| Group layer | Configured by group admins in group settings | High |

When names collide, the lower layer in the table wins (group layer over team layer, team layer over platform layer). A group can also turn off individual MCP servers and Skills inherited from the platform and team layers. The configuration center **never modifies repository files**:

- Merging happens in daemon memory.
- MCP servers are injected into the Agent over ACP when a new session starts; nothing is written to disk.
- Skills are cached on the machine by the daemon: Claude Code receives them as a plugin; for Codex, symlinks are created in the workspace and added to `.git/info/exclude`, so they're never committed.

The 「合并预览 · 全部 Bot」 (Merged preview · All Bots) panel on the right lists what's currently in effect, layer by layer.

## What you can configure

In the layer switcher at the top left, only 「平台层」 (Platform) is selectable (team and group layers are managed in their own settings). The type switcher on the right has these options:

| Type | Contents |
| --- | --- |
| MCP | Platform-layer MCP servers; see below |
| Skill | Platform-layer Skills: upload the folder containing `SKILL.md` or a zip, edit online, with version history and rollback |
| 插件 (Plugins) | Platform plugins: built-in plugins and ones you upload, visible to all teams |
| 指令 (Instructions) | Not supported yet |
| 密钥 (Secrets) | Platform-layer secrets: Bots read them at run time as environment variables of the same name |
| 待审核 (Pending review) | Public entries in the Skill market awaiting platform review |

The link `/admin/config?type=plugin` opens the 「插件」 (Plugins) type directly; the 「管理插件」 (Manage plugins) button on the [System parameters](/en/admin/params#plugins) page points here.

### Built-in gonggong

The last item in the MCP list is the built-in `gonggong` MCP, marked 「内置」 (Built-in) with the description 「系统内置 · 始终注入，不受层级影响」 (Built-in · Always injected, regardless of layers). It can't be turned off, and `gonggong` can't be used as the name of a custom MCP. It gives the Agent tools to ask group members questions, read and search chat history, get group info and members, view run records, and more; see [Architecture](/en/guide/architecture).

### Add an MCP

1. Click 「添加 MCP…」 (Add MCP…).
2. Choose a **传输方式 (Transport)**:
   - **Stdio**: fill in 「命令」 (Command) (e.g. `npx`) and 「参数」 (Arguments) (one per line).
   - **HTTP**: fill in 「URL」, which must start with `http://` or `https://`.
3. Enter a **名称 (Name)** (e.g. `wiki-search`); it can't duplicate an existing MCP.
4. Optional: expand 「环境变量」 (Environment variables) (Stdio) or 「请求头」 (Headers) (HTTP), click 「添加一项」 (Add item), and enter a name and value. **Values can only reference secrets**, written as `${secret:NAME}`, which is replaced with the real value at run time. Secrets are maintained under 「密钥」 (Secrets) on this page, or under 「密钥」 in team or group settings.
5. Click 「添加」 (Add). The new entry is marked 「未保存」 (Unsaved).
6. When everything looks right, click 「保存」 (Save) below the list.

![The 「添加 MCP」 (Add MCP) dialog](/screenshots/web/admin-config-mcp.webp)

Each MCP has a switch (enable / disable) and a delete button on the right; these changes also take effect only after you click 「保存」 (Save).

### Skills

Click 「添加 Skill…」 (Add Skill…) and upload with 「导入文件夹…」 (Import Folder…) or 「导入 zip…」 (Import zip…). The name and description come from the frontmatter at the top of `SKILL.md`. Every save creates a new version; you can view old versions in the history or 「回滚到此版本」 (Roll Back to This Version). If a Skill bundled in the repository has the same name, the version here is skipped and the run card says so. A member's 「我的 Skill」 (My Skills) apply only to runs they start, and take precedence over same-named Skills from the group, repository, and team. After you save, the affected Bots can use the Skill from their next turn.

Teams and groups can also bring in Skills from the [Skill market](/en/user/market-plugins).

### Plugins

Plugins require the 「插件」 (Plugins) master switch in [System parameters](/en/admin/params#plugins) to be on. Click 「上传文件夹…」 (Upload folder…) or 「上传 zip…」 (Upload zip…) to upload a plugin containing `gonggong-plugin.json`. Uploading a plugin with the same name again creates a new version, effective from the next task.

- Built-in plugins are installed automatically with the server and marked 「内置」 (Built-in); they can't be overwritten or deleted. To replace one, upload your own to a team or group.
- Each plugin shows the Agents it supports, the secrets it needs, the minimum machine version, its permissions, and the MCP servers it brings.
- Plugins that need to run code on the machine (such as a local MCP server) also require the 「插件代码」 (Plugin code) switch to be on, and the machine owner must authorize each version on their own machine.

For using plugins in groups, see [Market and plugins](/en/user/market-plugins).

### Secrets

Click 「新建密钥…」 (New secret…) and fill in:

- **名称 (Name)**: the environment variable name; uppercase letters, digits, and underscores only, starting with a letter, e.g. `FEISHU_DEVOPS_TOKEN`.
- **用途 (Purpose)**: what it's for and how to obtain one.
- **模式 (Mode)**: 「统一值」 (Shared value: everyone uses the same value), 「统一值可个人覆盖」 (Shared, member may override: a member's own value is used if they've set one), or 「每人自填」 (Per member: no shared value; everyone fills in their own).
- **可用 Bot (Available to)**: 「全部 Bot」 (All bots) or 「指定 Bot」 (Selected bots).
- **到期时间 (Expires)**: leave empty for no expiry.
- **统一值 (Shared value)**: at least 8 characters; can be filled in later.

Values are stored encrypted. Once saved, nobody can see the plaintext; you can only overwrite or clear it. At run time secrets are injected only as environment variables, and any secret value that appears in output is masked. Same-named secrets at the team or group layer override the platform layer. See [Knowledge base and secrets](/en/user/knowledge-secrets) for more.

### Pending review

Public entries in the Skill market are reviewed by platform admins; entries visible only within a team are reviewed by team admins under 「待审核」 (Pending review) in team settings. Click 「审核」 (Review) on a version to see its update notes and the file diff against the previous version, then 「通过」 (Approve) or 「驳回」 (Reject) it (a review comment is required when rejecting).

In an entry's details, reviewers can also 「封禁」 (Ban) a listed entry (a reason is required): from the next turn on, every install stops loading it, it disappears from the market, and it can't be newly installed. 「解封」 (Unban) restores it to its state before the ban. The market has the same 「待审核」 (Pending review) tab; see [Market and plugins](/en/user/market-plugins).

## When changes take effect

After an MCP save you'll see 「已保存，全员下一轮新会话生效」 ("Saved; applies to everyone's next new session"):

- By default, runs in progress aren't affected, existing sessions keep using the old configuration, and a Bot picks up the new configuration the next time it starts a new session.
- If you check 「强制相关 Bot 下一轮开新会话」 (Force affected Bots to start a new session next run) before saving, the affected Bots discard their existing sessions on the next turn and start fresh with the new configuration; the run card explains why. The cost is that the Bots lose the context from their previous sessions.

Changes to Skills, plugins, and secrets take effect on the affected Bots' next turn without interrupting running tasks.

Adding, modifying, and deleting platform-layer MCP servers, Skills, plugins, and secrets are all written to the [audit log](/en/admin/audit).

## Related pages

- [Architecture](/en/guide/architecture)
- [Market and plugins](/en/user/market-plugins)
- [Knowledge base and secrets](/en/user/knowledge-secrets)
- [Bot settings and permissions](/en/user/bot-settings)
