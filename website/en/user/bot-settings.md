# Bot settings and permissions

This page covers the settings in Bot details: name and appearance, provider and model, default workspace, approval mode, trusted list and everyone else, concurrency, Git commit identity, sharing, and deleting a Bot.

## Open Bot details

In 「机器与 Bot」 (Machines & Bots), click a Bot to open its overview page, then click 「编辑」 (Edit) in the top-right corner to open 「Bot 详情」 (Bot details). Sysadmins can also edit it from 「管理后台 → Bot」 (Admin console → Bot) — see [Bots and groups](/en/admin/bots-groups).

![Bot settings](/screenshots/web/bot-settings.webp)

Settings are split into the tabs 「基本信息」 (General), 「运行配置」 (Runtime), 「权限」 (Access), 「高级」 (Advanced), 「飞书」 (Feishu, Bot owners and sysadmins only), and 「共享」 (Sharing). When you're done, click 「保存」 (Save) at the bottom; you'll see 「已保存 · 下一次新开会话时生效」 ("Saved · Applies from the next new session"): **sessions in progress are not affected** — the new settings take effect the next time a session starts.

::: info Who can change what
- The Bot owner and sysadmins can change most settings; anyone else who opens it can only view.
- Only the Bot owner — not even a sysadmin — can change these: switching between 「帮我审批」 (Review for me) and 「每次问我」 (Ask me every time), 「已允许的命令」 (Allowed commands), 「Git 提交身份」 (Git commit identity), 「Agent 设置」 (Agent settings) overrides, 「默认工作区」 (Default workspace), and 「供应商」 (Provider).
- 「默认工作区」 (Default workspace) and 「供应商」 (Provider) also require the machine to be online.
:::

A notice may appear at the top, for example 「agent 版本低于适配器要求」 ("Agent version is below the adapter requirement" — the CLI on the machine is too old; upgrade it in [Agent tools](/en/user/agents-providers#install-and-upgrade)), 「Claude Code 未安装」 ("Claude Code not installed"), or a 「确认」 (Confirm) button for a Bot an admin created for you that is still 「等待确认」 (waiting for confirmation).

## General

- **Name**: up to 40 characters.
- **Avatar**: upload an image and crop it to show instead of the role character; you can also remove it to go back to the role character.
- **Role**: defaults to 「跟随 Agent」 (Follow agent); you can also pick Gong (共字君) or one of the 12 personality roles — see [Create a Bot](/en/user/create-bot#role).
- **System prompt**: the Bot's role description and in-group bio, up to 4000 characters. Groups can add to it — see [Groups and direct chats](/en/user/groups).

## Runtime

Shows the 「执行机器」 (Machine) and 「Agent」 (CLI name and version), plus the items below.

### Provider

Choose the provider the Bot uses to call models: 「继承机器（当前：…）」 (Inherit from machine (currently: …)), 「官方登录」 (Official login), or one of this machine's providers for the same Agent. The setting is stored only on the machine the Bot runs on; sessions in progress switch only after a new session starts. If some group is still using the old provider when you save, a confirmation dialog appears first.

When the dropdown is unavailable, the reason is shown next to it, such as 「只有 Bot 主人可以设置其供应商」 ("Only the Bot owner can set its provider"), 「只能在自己的机器上设置 Bot 的供应商」 ("A Bot's provider can only be set on your own machine"), 「机器离线，上线后才能设置」 ("The machine is offline; set this once it is online"), or 「请先升级该机器的 daemon」 ("Upgrade this machine's daemon first"). For adding and managing providers, see [Agent tools and providers](/en/user/agents-providers#providers).

### Model and reasoning effort

![Bot model and reasoning effort](/screenshots/web/bot-agent-config.webp)

- **Model**: 「默认（…）」 (Default (…)) follows the Agent's default model; you can also pick a model reported by the machine. With a third-party provider, the list shows that provider's models. When the Bot owner's machine is online, a 「刷新模型」 (Refresh models) button next to it makes the machine re-read the available models.
- **Reasoning effort**: offered by some models; the options vary by model, such as 「低」 (Low), 「中」 (Medium), 「高」 (High), 「超高」 (Extra high), 「最高」 (Max). 「默认（…）」 (Default (…)) means the model's starting level. When you switch models and the new one lacks the previous level, it falls back to the default.

If the machine hasn't reported its available models yet, it shows 「跟随默认 · 机器上报可选模型后可设置」 ("Follows default · Available once the machine reports its models").

What you set here is the Bot's default. The effective value, from highest to lowest priority:

1. Set for a single message below the input box when sending;
2. This group's default;
3. The Bot's default (here);
4. The Agent's own default.

For switching within a group and per-message settings, see [Directing Bots in a group](/en/user/chat).

### Agent settings

Claude Code Bots only. 「语言」 (Language), 「扩展思考」 (Extended thinking), and 「提交署名」 (Commit attribution) can each be set to 「跟随机器设置」 (Follow machine settings) or specified individually; changes take effect the next time the agent starts. The machine-level defaults are set in [Agent tools and providers](/en/user/agents-providers#agent-settings-claude-code).

### Default workspace

Only the Bot owner sees this item. Click 「选择…」 (Choose…) to pick a directory on the machine, or 「清除」 (Clear) to unset it.

- In groups without a bound repository and in direct chats, the Bot automatically works in this directory;
- Groups with a bound repository clone automatically by default;
- You can leave it unset: the Bot uses a workspace managed by Gonggong Space by default and can start working on the first @.

See [Repositories and workspaces](/en/user/repos-workspaces).

## Access

### Approval mode

Decides what happens when the Bot wants to do something risky in tasks **you** start. Pick one of three (for tasks others start, see [Trusted list and everyone else](#trusted-list-and-everyone-else) below):

| Option | Meaning |
| --- | --- |
| 每次问我 (Ask me every time) | Read-only commands are allowed automatically; everything else sends you an approval card |
| 帮我审批 (Review for me) | Build, test, lint, format, git, viewing files, and reading or writing inside the workspace and the temporary directory (`/tmp`) are allowed directly (which amounts to trusting the scripts in the repository); everything else sends you an approval card. Decided by rules alone, spending no tokens; see [Approvals and questions](/en/user/approvals#review-for-me) |
| 完全允许 (Allow everything) | Never asks; the Bot can do anything |

Under 「每次问我」 (Ask me every time) and 「帮我审批」 (Review for me), high-risk commands (such as `sudo` or `git push --force`), pushes to a protected base branch, and client releases **always need your confirmation**.

**Built-in review**: under 「帮我审批」 (Review for me), Claude Code (official login) and Codex (official OpenAI login) are gated by the agent's own built-in auto-review instead. Operations it blocks make the agent try another approach, without sending a card. Built-in review isn't available with third-party providers or unsupported models; approvals then work as described above, and the run's process notes who reviewed it.

::: danger Allow everything
With 「完全允许」 (Allow everything), the Bot never asks before running any command, dangerous commands included. This only covers tasks you start yourself; when others @ it, the mode you set for them below applies — they are neither refused nor given Allow everything just because you turned it on.
:::

Older Bots may still be on the 「只读」 (Read-only) tier: the Bot can only read, and everything else sends an approval card. Once you switch to another mode, this option no longer appears.

This is the Bot's default. Each group can also set this Bot's 「本群审批方式」 (Approval in this group) separately in the group info — see [Groups and direct chats](/en/user/groups).

### Allowed commands

The allowlist for 「每次问我」 (Ask me every time) and 「帮我审批」 (Review for me). When you choose 「批准，不再询问」 (Approve, don't ask again) on an approval card, a rule is added here and applies in every group this Bot is in.

- Commands starting with these prefixes (or `tool:tool name`) are approved automatically;
- You can also type a command prefix manually, such as `go build`, and press Enter to add it;
- Click the × on a rule to delete it; it will be asked about again afterward.

For handling approval cards and how rules are generated, see [Approvals and questions](/en/user/approvals).

### Trusted list and everyone else

When others @ it, they fall into two groups by who started the task, each with its own mode:

- **「信任名单」 (Trusted list)**: members on the list (type member names to add them). People who DM this Bot through a share count here too.
- **「其他成员」 (Everyone else)**: everyone else in the group.

Relayed (hand_off) tasks count as started by whoever started the chain.

| Option | Meaning |
| --- | --- |
| 完全允许 (Allow everything) | Never asks; the Bot can do anything. Choosing it asks you to confirm once more |
| 自动审批 (Auto-approve) | Allowed by the 「帮我审批」 (Review for me) rules; red lines (dangerous commands, possible changes to a protected base branch) are **rejected outright** without a card bothering you, and the agent tries another way; anything else the rules aren't sure about (network, file edits, unparsable commands…) sends you an approval card |
| 需要审批 (Needs approval) | Read-only commands run; everything else sends you an approval card |
| 只读 (Read-only) | The Bot can only read; everything else sends you an approval card |
| 不可触发 (Cannot be triggered) | An @ starts no run; the run card shows 「无权触发」 (Not allowed) |

New Bots default to Needs approval for the trusted list and Auto-approve for everyone else. While everyone else may trigger it, the trusted list can't be set to Cannot be triggered.

A group's own 「本群审批方式」 (Approval in this group) is a ceiling for both groups: set to Read-only there, list members and everyone else can only read in that group; for you it still replaces your mode.

## Advanced

- **Concurrency limit**: the number of turns running at the same time, from 1–8; extra turns queue on that machine. The default for new Bots comes from the system parameter 「Bot 并发上限 · 新建默认」 (Bot concurrency limit · default for new Bots), which defaults to 2.
- **Git commit identity**: the author name and email used when the Bot commits code. Leave empty to use the defaults (the name defaults to the Bot name); takes effect the next time the agent starts. Only the Bot owner can change it.

## Feishu

Bot owners and sysadmins see this tab. Connect a dedicated Feishu custom app to the Bot so you can @ it in Feishu chats and message it directly in Feishu. Click 「扫码创建或接入」 (Create or connect by scanning) and scan with Feishu; once connected, the checklist below says what's left (waiting for your organization's Feishu admin to approve it, widening the app's availability to the members who need it). Changes here take effect at once; there's no 「保存」 (Save) button at the bottom.

The 「飞书应用」 (Feishu app) row on the Bot overview shows its status: 未接入 (Not connected), 连接中 (Connecting), 等待审核 (Awaiting approval), 连接失败 (Connection failed) or 已接通 (Connected and approved). In group settings · Feishu, a Bot without a Feishu app has 「去接入」 (Connect), which opens this tab. For setup details, see [Feishu](/en/admin/feishu).

## Sharing

Share the Bot with others on your team: under 「共享给」 (Shared with), click 「添加成员…」 (Add members…). It takes effect immediately.

- They can chat with the Bot directly and view its configuration; each direct chat uses its own managed workspace;
- Command approvals are still handled by the Bot owner;
- After you stop sharing, their direct chats become read-only.

Others can also click 「申请共享」 (Request access) on the Bot overview page; once you agree, they're added to the list automatically.

## When sessions start over

- Changed settings and switched providers both take effect only from the **next new session**. Send `/new @BotName` in the group to start a new session immediately — see [Command reference](/en/user/commands).
- After a Bot has been idle in a group for more than 6 hours, the next conversation starts a new session automatically, to avoid re-reading a long history whose cache has expired and wasting tokens. The duration is set by the system parameter 「Bot 闲置后下次对话自动开新会话」 (Start a new bot session after idle for) — see [System parameters](/en/admin/params).

## Delete a Bot

Click 「删除 Bot」 (Delete Bot) in the bottom-left corner of Bot details, then 「删除」 (Delete) to confirm:

- The Bot is removed from every group it's in;
- Group messages and run records are kept;
- Deletion can't be undone.

## Related pages

- [Create a Bot](/en/user/create-bot)
- [Agent tools and providers](/en/user/agents-providers)
- [Approvals and questions](/en/user/approvals)
- [Groups and direct chats](/en/user/groups)
- [My machines and Bots](/en/user/machines)
