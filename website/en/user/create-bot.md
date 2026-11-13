# Create a Bot

A Bot is an AI member you can @ in a group. It's tied to a specific machine and works using a specific Agent (Claude Code, Codex, Gemini CLI, and so on). This page covers how to get your first Bot, the fields of the 「新建 Bot」 (New Bot) dialog, the Bot overview page, and how to put the Bot to work.

## The fastest way: created for you when binding a machine

When you bind a machine with 「发给你的 Agent」 (Send to your agent), the Agent also creates a Bot of its own Agent type (e.g. 「王磊的 Claude Code」, "王磊's Claude Code") plus a direct chat between you and it, and the web page opens that direct chat — no need for the steps below. See [Bind a machine](/en/user/bind-machine#option-1-send-it-to-your-agent-recommended).

To create another Bot on the same machine (for example with a different Agent or a different system prompt), use 「新建 Bot」 (New Bot).

## Open 「新建 Bot」 (New Bot)

Use any of these entry points:

- 「新建 Bot」 (New Bot) at the top of 「机器与 Bot」 (Machines & Bots) in the left navigation bar, or 「新建 Bot」 under a specific machine (that machine is preselected);
- 「新建 Bot」 on a machine card in the 「机器与 Bot」 (Machines & Bots) overview;
- 「新建 Bot」 in the dialog after successfully binding a machine via 「其他方式」 (Other ways);
- 「新建 Bot」 on the welcome page or in the sidebar's 「开始使用」 (Get started) card;
- Sysadmins can also create one in 「管理后台 → Bot」 (admin console → Bot) — see [Bots and groups](/en/admin/bots-groups).

![New Bot dialog](/screenshots/web/new-bot.webp)

## Fields

The dialog has two parts: 「基本信息」 (General) and 「运行配置」 (Runtime).

### General

| Field | Description |
| --- | --- |
| 归属人 (Owner) | Who the Bot belongs to and whose machine it runs on. Shown only if you can create Bots for multiple people: sysadmins can create them for anyone; members can only create them for themselves |
| 名称 (Name) | Defaults to "owner's Agent", e.g. 「王磊的 Claude Code」 ("王磊's Claude Code"); you can change it. Up to 40 characters, and it can't duplicate an existing Bot's name. The small image in front of the name previews the Bot's avatar |
| 角色 (Role) | The Bot's look; defaults to 「跟随 Agent」 (Follow agent). Click 「换个角色…」 (Change character…) to change it — see below |
| 系统提示词 (System prompt) | Optional. Tells the Bot what it's responsible for and doubles as its in-group bio, e.g. 「后端接口开发，只改 server/ 目录」 ("Backend API development; only edits server/"). Up to 4000 characters |

### Runtime

| Field | Description |
| --- | --- |
| 执行机器 (Machine) | Machines owned by the owner, with OS and online status. If the owner has no machine yet, the Bot is created as 「待绑定」 (Pending binding) |
| Agent | The Agents this machine can run, with the detected version next to each; ones not on the machine show 「未安装」 (Not installed) and can't be selected; if the machine is offline and has never reported, it shows 「待检测」 (Not detected yet) |

Click 「设置供应商、模型与默认工作区…」 (Set provider, model and default workspace…) to set the following at creation time (all of them can be changed later in the Bot's settings):

- **Provider**: 「继承机器（当前：…）」 (Inherit from machine (currently: …)), 「官方登录」 (Official login), or one of the providers on this machine — see [Agent tools and providers](/en/user/agents-providers#which-provider-a-bot-uses);
- **Model / reasoning effort**: by default follows the Agent's own defaults — see [Bot settings and permissions](/en/user/bot-settings#model-and-reasoning-effort);
- **Default workspace**: shown only when creating for yourself and the machine is online. Click 「选择目录…」 (Choose folder…) to pick a directory on the machine. It's used automatically in groups without a bound repository and in direct chats; groups with a bound repository clone automatically by default.

::: tip It works without a default workspace
When a Bot joins a group or direct chat, it uses a workspace managed by Gonggong Space by default (`~/gonggong/workspaces/<group name>/<Bot name>/…`), so it can run from the very first @. If you want it to work in an existing project directory of yours, set a default workspace or change the workspace in the group — see [Repositories and workspaces](/en/user/repos-workspaces).
:::

### Role

Every Bot plays a character:

- **Follow agent** (「跟随 Agent」, default): uses the Agent's official look, so you can tell at a glance which one it is;
- **Gong** (共字君): the brand mascot;
- 12 personality roles, such as 「慢想」 (Ponder; deliberate × contrarian × keeps boundaries), 「铁码」 (Ironcode; sharp-tongued × neat freak × doer), 「小步」 (Baby Steps; optimistic × pragmatic × willing to cut scope), 「哨兵」 (Sentinel; alert × calm × process-minded), and more. Hovering over a card animates it, and a one-line intro of the role appears below.

The role determines the Bot's avatar and the intro on its overview page; it doesn't change how the Bot behaves. To constrain how the Bot works, write it in the 「系统提示词」 (System prompt). After creation you can also upload an image as the avatar in the Bot's settings — see [Bot settings and permissions](/en/user/bot-settings#general).

## Create

The bottom of the dialog previews the status after creation, and the button label changes accordingly:

| Situation | Preview | Button |
| --- | --- | --- |
| Creating for yourself; the machine has reported the selected Agent | Available immediately after creation | 「创建并绑定」 (Create and bind) |
| The machine doesn't have the selected Agent | Unavailable after binding for now; becomes available automatically once installed on that machine and re-detected | 「创建并绑定」 (Create and bind) |
| The owner has no machine yet | Pending binding | 「创建」 (Create) |
| An admin creating for someone else | Waiting for the owner to confirm | 「创建并发送确认」 (Create and request confirmation) |

After creation the result is shown, e.g. 「已就绪，可以在群里 @ 它了」 ("Ready. You can @ it in a group now"). When creating for yourself and the Bot is ready, click 「和它聊一句」 (Say hi to it) to open a direct chat right away. If the machine is offline, you're prompted to open the Gonggong Space client on that machine. If the Bot is pending binding and it's yours, the result page gives you a connect link right away so you can bind a machine immediately.

::: info Bots an admin creates for you
The machine owner is responsible for what runs on the machine. A Bot an admin created for you and assigned to your machine must be confirmed by you before it can be triggered: you'll get a notification, and the Bot also has a 「确认」 (Confirm) button in 「机器与 Bot」 (Machines & Bots).
:::

## Where to find it

After creation, the Bot appears in 「机器与 Bot」 (Machines & Bots) under the machine it runs on, showing its Agent and status (online / running / offline / agent missing). Bots not yet on a machine are listed under 「未绑定机器的 Bot」 (Bots without a machine), showing 「待绑定」 (Pending binding) or 「待确认」 (Pending confirmation).

![Bot overview page](/screenshots/web/bot-overview.webp)

Click it to open the **Bot overview page**:

- Avatar, role, and status;
- 「正在工作」 (Working): runs currently in progress; when idle it shows 「空闲，在群里 @ 它即可开工」 ("Idle · @ it in a group to start work");
- 「工作位置」 (Where it works): the groups and direct chats it's in, and each one's workspace;
- Usage over recent days: total tokens, run turns, who used it, and a per-group breakdown;
- On the right, a configuration summary: General, Runtime, Access, Advanced, Sharing.

In the top-right corner of the page, 「私聊」 (Message) opens a direct chat with it, and 「编辑」 (Edit) opens Bot details to change settings — see [Bot settings and permissions](/en/user/bot-settings).

A usage summary for all your Bots is under 「我的用量」 (My usage) in the avatar menu.

![My Bots and usage](/screenshots/web/my-bots.webp)

::: tip Using someone else's Bot
Someone else's Bot overview page has 「申请共享」 (Request access) in the top-right. Fill in a sentence about what you need it for and submit; once the owner agrees, it appears under your 「共享给我」 (Shared with me) and you can chat with it directly. For how to set up sharing, see [Bot settings and permissions](/en/user/bot-settings#sharing).
:::

## Put the Bot to work

- **Direct chat**: click 「私聊」 (Message) on the Bot overview page; or click 「+」 (发起会话 / New conversation) at the top of the conversation list and select only this Bot to 「开始私聊」 (Start chat). A direct chat has just one Bot, so no @ is needed — just state what you need.
- **Add it to a group**: include this Bot and your colleagues when starting a conversation, or add it to an existing group — see [Groups and direct chats](/en/user/groups).

![Direct chat with a Bot](/screenshots/web/bot-page.webp)

For how to assign work to a Bot, see [Directing Bots in a group](/en/user/chat).

## Related pages

- [Bot settings and permissions](/en/user/bot-settings)
- [Bind a machine](/en/user/bind-machine)
- [My machines and Bots](/en/user/machines)
- [Groups and direct chats](/en/user/groups)
- [Directing Bots in a group](/en/user/chat)
