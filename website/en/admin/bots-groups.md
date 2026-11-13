# Bots, groups, and scheduled tasks

This page covers the three pages in the console's 「管理」 (Admin) group: 「Bot」 (Bots), 「群」 (Groups), and 「定时任务」 (Scheduled tasks). Use them to view every Bot and group on the platform, create or delete Bots for members, and disable or delete any scheduled task.

All three pages have a team filter in the toolbar. It defaults to 「全部团队」 (All teams); you can narrow it to a single team.

## Bots

![Admin console · Bots](/screenshots/web/admin-bots.webp)

The 「Bot」 page lists every Bot in the system: a table on the left and the selected Bot's details on the right. Use the search box in the top-right corner to filter by Bot name, owner, or machine.

### Table columns

| Column | Description |
| --- | --- |
| Bot | Avatar and name |
| Agent | The Agent used (Claude Code, Codex, Gemini CLI, CodeBuddy, pi, DeepSeek Harness, etc.) and the version reported by the machine |
| 归属人 (Owner) | The Bot owner, who is responsible for what happens on that machine |
| 团队 (Team) | The team the Bot belongs to |
| 绑定 (Binding) | 「已绑定」 (Bound), or an orange tag: 「待确认」 (Pending confirmation) or 「待绑定」 (Pending binding) |
| 机器 (Machine) | The machine the Bot runs on |
| 状态 (Status) | 在线空闲 (Online, idle) / 运行中 (Running) / 离线 (Offline) / agent 缺失 (Agent missing) / 不可触发 (Cannot be triggered) |

「不可触发」 (Cannot be triggered) means binding isn't complete yet:

- **待确认 (Pending confirmation)**: an admin created the Bot for someone else and bound it to that person's machine. It can't be triggered until the owner confirms it in a web notification.
- **待绑定 (Pending binding)**: the owner hasn't bound a machine yet. Once the owner binds their first machine and it reports the matching Agent, the Bot is bound automatically; nothing else to do.

### Create a Bot for a member

Sysadmins can create Bots for any member; members can only create Bots for themselves.

1. Click 「新建 Bot…」 (New Bot…) in the toolbar.
2. Under 「基本信息」 (General), fill in:
   - **归属人 (Owner)**: who the Bot belongs to.
   - **名称 (Name)**, **角色 (Role)** (the avatar character; defaults to the Agent's character, click 「换个角色…」 (Change character…) to pick another), and **系统提示词 (System prompt)** (also used as its intro in groups).
3. Under 「运行配置」 (Runtime), choose:
   - **执行机器 (Machine)**: one of the owner's machines (shown with OS and online status). If the owner has no machine yet, you can leave it empty and the Bot is created as 「待绑定」 (Pending binding).
   - **Agent**: shows the version reported by that machine, or 「未安装」 (Not installed) / 「待检测」 (Not detected yet).
   - **默认工作区 (Default workspace)** (optional): used automatically in groups and direct chats with no bound repository. Provider, model, and so on are under 「设置供应商、模型与默认工作区…」 (Set provider, model and default workspace…), and all of them can be changed after creation.
4. The bottom of the dialog previews the result, and the button label changes with the situation:

| Situation | Button | Result |
| --- | --- | --- |
| For yourself, machine selected | 创建并绑定 (Create and bind) | Ready to use right after creation |
| For someone else, machine selected | 创建并发送确认 (Create and request confirmation) | Enters 「待确认」 (Pending confirmation); the owner receives a confirmation notification |
| No machine selected | 创建 (Create) | Enters 「待绑定」 (Pending binding) |

If the selected machine hasn't reported the chosen Agent, you'll see 「绑定后暂不可用」 (Unavailable after binding). The Bot becomes usable automatically once the Agent is installed on that machine and detected again; see [Agent tools and providers](/en/user/agents-providers).

### Modify a Bot

Select a row and the right side shows the Bot's details and settings. You can edit its name, avatar and character, system prompt, machine, default workspace, trigger scope and trigger list, concurrency limit, Feishu app, and more, and see the groups it's in, its usage over the last 7 days, and 「谁用了」 (Used by). For what each setting means, see [Bot settings and permissions](/en/user/bot-settings).

::: warning
「审批方式」 (Approval) and its allow rules, the Git commit identity, and Agent settings can be changed only by the Bot owner; admins can see them in the details but can't change them. A Bot set to 「完全允许」 (Allow everything) can be triggered only by people on its trigger list.
:::

### Delete a Bot

Choose 「删除 Bot…」 (Delete Bot…) from the row's menu. The confirmation lists how many groups the Bot will be removed from. Deletion can't be undone; group messages and run records are kept.

Creating, modifying, and deleting Bots for others are all written to the [audit log](/en/admin/audit).

## Groups

![Admin console · Groups](/screenshots/web/admin-groups.webp)

The 「群」 (Groups) page is read-only. It lists every group (including direct chats and dissolved, archived groups), and you can search by group name or repository URL.

| Column | Description |
| --- | --- |
| 群 (Group) | Group name; direct chats appear as 「成员 ⇄ Bot」 ("member ⇄ Bot") |
| 团队 (Team) | The team the group belongs to |
| 模式 (Mode) | 「分区模式」 (Partition mode) or 「强制同步」 (Force sync); dissolved groups show 「已归档」 (Archived) |
| 仓库 (Repository) | The bound Git repository URL; shows 「未绑定」 (Not bound) if none |
| 成员 (Members) | Number of group members |
| Bot | Number of Bots in the group |
| 存档 (Archive) | Dissolved groups show 「归档 · N 天后清除」 ("Archived · purged in N days"), where N is based on 「删群后存档保留」 (Keep archives of deleted groups for) in [System parameters](/en/admin/params#data-retention) |

Day-to-day group management (renaming, notices, adding and removing members and Bots, primary and additional repositories, group-level parameters, dissolving) is done by group admins in group settings; see [Groups and direct chats](/en/user/groups) and [Repositories and workspaces](/en/user/repos-workspaces).

## Scheduled tasks

The 「定时任务」 (Scheduled tasks) page lists every scheduled task in every group and direct chat. When a task comes due, the first available Bot among its candidates runs it. For how members create and use scheduled tasks, see [Scheduled tasks and threads](/en/user/schedules-threads).

Four counters sit at the top of the page: 「启用中」 (On), 「24 小时内触发」 (Fired in 24 h), 「24 小时内失败」 (Failed in 24 h), and 「已自动停用」 (Turned off automatically). The toolbar filters by status (all / on / disabled) and team, and the top-right search box searches by task name, group, or Bot.

| Column | Description |
| --- | --- |
| 任务 (Task) | Task name and schedule |
| 群 (Group) | The group it's in; direct chats appear as 「某人 的私聊」 ("someone's direct chat") |
| 团队 (Team) | The team it belongs to |
| Bot | Candidate Bots |
| 主人 (Owner) | The member who created the task |
| 状态 (Status) | Current status and the result of the most recent run |

On the right of each row:

- **Switch**: disable or re-enable the task.
- **Delete**: the first click turns it into 「确认删除」 (Confirm delete); click again to actually delete.

Tasks the system turns off automatically (for example, after repeated failures) count toward 「已自动停用」 (Turned off automatically). The group receives a notice like 「定时任务「…」已停用：原因」 ("Scheduled task '…' was turned off: reason"), and the task owner is notified too.

## Related pages

- [Create a Bot](/en/user/create-bot)
- [Bot settings and permissions](/en/user/bot-settings)
- [Groups and direct chats](/en/user/groups)
- [Scheduled tasks and threads](/en/user/schedules-threads)
- [Audit log](/en/admin/audit)
