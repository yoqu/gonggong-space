# Core concepts

This page explains the concepts that come up again and again in Gonggong Space and how they relate. Reading it first makes the other pages much easier to follow.

## How it fits together

```text
Account (Wang Lei)
 ├─ Machine (wanglei-mbp) ── runs the daemon (gg background service or desktop app)
 │    ├─ Bot "王磊的 Claude Code" ── Agent: Claude Code
 │    └─ Bot "后端助手" ── Agent: Codex
 │         └─ Each group or direct chat it joins → one workspace (group × Bot)
 └─ Group "todo-app" ── primary repo todo-app (base branch main), extra repos optional
      ├─ Members: Wang Lei, Li Na, Chen Chen
      ├─ Bots: 后端助手 (Wang Lei's), 前端助手 (Li Na's)
      ├─ Knowledge base, secrets, scheduled tasks, threads
      └─ Message ──@Bot──→ run ──→ process / diff / approvals / questions / previews
```

(The Bot names are from the demo data: 王磊的 Claude Code = "Wang Lei's Claude Code", 后端助手 = "backend assistant", 前端助手 = "frontend assistant".)

| Concept | Belongs to | In one sentence |
| --- | --- | --- |
| Account | — | Your identity for logging in to the web app; the role is sysadmin or member |
| Machine | An account | A machine with the daemon installed and bound to that account |
| daemon | A machine | The resident program on the machine that picks up tasks and calls the local Agent |
| Bot | An account (the owner) | An AI member you can @ in a group; always runs on one of its owner's machines |
| Group / direct chat | Group members | Where people and Bots work together; a direct chat has only you and one Bot |
| Workspace | A Bot in a group | The directory a Bot works in; one per "group × Bot" |
| Run | A Bot in a group | One round of work triggered by @ing a Bot |

## Accounts and roles

- **Sysadmin**: can open the 「管理后台」 (Admin console) to manage accounts, all Bots and groups, machines, the configuration center, system parameters, and more. The account `admin` is created automatically the first time the server starts.
- **Member**: after logging in, binds their own machines, creates their own Bots, and starts groups and direct chats.

Self sign-up is off by default (a system parameter can turn it on); the sysadmin creates accounts, and the initial password must be changed on first login. See [Login and account](/en/user/login) and [Accounts and roles (admin console)](/en/admin/users).

Within a group, members are either **group admins** (who manage group settings, members, and Bots) or regular members. A Bot's owner is also called the **Bot owner**, and only they can act on that Bot's approval cards.

## Machines and the daemon

A **machine** is a Mac, PC, Linux server, or Docker container a member uses to run Bots. It runs the Gonggong Space daemon, and once bound to your account it belongs to you.

The easiest way to bind is 「发给你的 Agent」 (Send to your agent): in 「绑定新机器」 (Bind new machine), copy a message and paste it to the Claude Code or Codex on that machine. It downloads and installs `gg`, binds the machine, installs it as a background service, and automatically sets up a Bot and your direct chat with it (macOS and Linux). You can also open a connect link in the desktop app, run `gg login` in a terminal, or run it in Docker. See [Bind a machine](/en/user/bind-machine).

The **daemon** comes in two forms with the same features:

- The `gg` CLI (macOS, Linux): `gg run` runs it, and `gg service install` installs it as a background service that starts at login. See [Command-line gg](/en/cli/).
- The desktop app (macOS, Windows): bundles the daemon and keeps running in the background after you close the window. See [Desktop app](/en/desktop/).

The daemon reports the machine name, OS, CPU, memory, and the Agent versions available on the machine to the server. When the daemon disconnects, the machine shows as 「离线」 (Offline), and tasks for its Bots queue until it comes back.

On the 「机器与 Bot」 (Machines & Bots) page you can see the Bots on each machine; manage Agent tools, providers, and Git access; check workspace disk usage and free up space; upgrade the daemon from the web; and open a terminal on the machine. See [My machines and Bots](/en/user/machines).

## Bots

A Bot is an AI member you can @ in a group. It is defined by:

| Property | Description |
| --- | --- |
| Owner | Who the Bot belongs to. Members can only create Bots for themselves; a sysadmin can create one for anyone, in which case the owner must confirm it in their notifications before it can be triggered |
| Machine | One of the owner's machines; all of the Bot's work happens there |
| Agent | Claude Code, Codex, Gemini CLI, CodeBuddy, pi, DeepSeek Harness, or Antigravity CLI, using the CLI on that machine |
| Character | Avatar and personality look: follows the Agent by default, or pick Gong (共字君) or one of 12 personality characters |
| System prompt | Tells the Bot its job; also shown as its intro in the group |
| Trigger scope | Who can @ it to start work: any group member / a specified list / owner only |
| Approval mode | How actions that need a check are handled: Ask me every time / Review for me / Allow everything; only the Bot owner can change it |
| Concurrency limit | How many turns can run at once; extra ones queue on the machine |

When you connect with 「发给你的 Agent」 (Send to your agent), the server automatically creates a Bot named "your name + 的 + Agent name" (for example 「王磊的 Claude Code」, "Wang Lei's Claude Code"). After that you can 「新建 Bot」 (New Bot) on the same machine with a different Agent, character, and prompt. A Bot owner can also share a Bot with team members so they can chat with it directly. See [Create a Bot](/en/user/create-bot) and [Bot settings and permissions](/en/user/bot-settings).

## Groups and direct chats

- **Group**: where members and Bots work together. It can be bound to a git repository or not, and it can be made a public channel so team members can find it in 「浏览频道」 (Browse channels) and join on their own.
- **Direct chat**: just you and one Bot, for personal use. No @ needed: any message you send triggers it.

In a group, only `@BotName request` triggers a Bot; messages without an @ don't trigger anything and are passed to the Bot as context. Use 「回复话题」 (Reply in thread) on a message to move a discussion into a **thread** without flooding the main group; a Bot can also open a thread and assign another Bot to take over there. See [Groups and direct chats](/en/user/groups), [Directing Bots in a group](/en/user/chat), and [Scheduled tasks and threads](/en/user/schedules-threads).

## Repositories, workspaces, and modes

- **Repository**: a group can bind one primary repository and several extra ones, each with its own **base branch** (default `main`). Each Bot clones with **its owner's own git credentials on their machine**; the server doesn't hold repository credentials for members.
- **Workspace**: the directory a Bot works in, one per "group × Bot", isolated from each other. There are two kinds:
  - **Managed workspace**: created and managed by the daemon at `~/gonggong/workspaces/<group name>/<Bot name>/<repo name>` on the machine. Groups without a repository and direct chats also get an empty managed directory, so the first @ after a Bot joins can run right away.
  - **Local directory**: the Bot owner can have the Bot use an existing directory on their machine (`/cd @Bot /absolute/path`, or 「更换工作区…」 (Change workspace…) in the Bot menu); `/cd @Bot --reset` switches back to the managed workspace.
- **Sync mode**: the default is **partition mode**, where each Bot makes changes independently in its own workspace. You can switch to **force sync**, where Bots on different machines share one workspace and conflicts are three-way merged automatically.

The Git bar in the group header shows the branch and change status; the Git panel lets you commit, view the log, stash, and resolve conflicts. See [Repositories and workspaces](/en/user/repos-workspaces) and [Git management](/en/user/git).

## Runs

Each @Bot starts a **run**, and a run card appears in the group. A run can be in these states:

| State | Meaning |
| --- | --- |
| 「排队中」 (Queued) | This Bot's previous turn in this group hasn't finished, the workspace is still being prepared, or the Bot's concurrency limit is reached |
| 「离线等待」 (Waiting for machine) | The Bot's machine is offline; waiting for it to come online (up to 30 minutes by default, adjustable in group settings) |
| 「无权触发」 (Not allowed) | The requester isn't in this Bot's trigger scope |
| 「运行中」 (Running) | The Agent is working |
| 「等待审批」 / 「等待回答」 (Awaiting approval / Awaiting answer) | Someone needs to handle an approval or answer a question |
| 「已完成」 / 「已中断」 / 「已作废」 (Completed / Interrupted / Void) | Final states; a request that times out before running is voided |

While a run is going you can send a follow-up to interrupt and append to it, or stop it with `/stop`. A Bot can **relay** a task to another Bot in the group with the built-in 「交给其他 Bot」 (Hand off to another Bot) tool, forming a relay chain; writing @ in a Bot's reply is only a mention and doesn't trigger anything.

Besides people @ing a Bot, a run can also be started by a **scheduled task** at its set time: both groups and direct chats can have scheduled tasks, and each one runs in a fresh session. See [Runs](/en/user/runs), [Command reference](/en/user/commands), and [Scheduled tasks and threads](/en/user/schedules-threads).

## Approvals and questions

- **Approvals**: when a Bot wants to do something that needs a check (such as running a command or pushing code), it's handled according to the Bot's approval mode:
  - 「每次问我」 (Ask me every time): read-only commands go through automatically; everything else gets an approval card.
  - 「帮我审批」 (Review for me): builds, tests, local git, editing files inside the workspace, and the like go through directly; everything else gets a card. With an official sign-in, Claude Code and Codex instead rely on the Agent's built-in review. You can also turn on 「AI 预审」 (AI pre-review) so a small model screens requests first and only risky ones reach you.
  - 「完全允许」 (Allow everything): never asks; only people on the trigger list can trigger it.

  High-risk commands, pushes to a protected base branch, and the like always need confirmation. **Only the Bot owner** can approve or deny an approval card; it waits 30 minutes by default, and a timeout counts as a denial.
- **Questions**: when a Bot isn't sure, it asks group members a multiple-choice or open question; **the requester, the Bot owner, or a member it @s** can answer.

See [Approvals and questions](/en/user/approvals).

## Previews and works

A Bot can publish a web service it started, a static page, a desktop app window, or a mini program as a **preview**. A preview card appears in the group, and members open it right in the browser; when people outside need to see it, you can create a public link with an expiry. Traffic goes through the tunnel between the daemon and the server, and only published ports on the machine are reachable.

With the creative plugin on, prototypes a Bot makes become hosted **works**: lay them out on a multi-screen canvas, annotate them, view versions, and have the Bot rework a whole screen or a single element. All works are collected on the 「作品」 (Works) page. See [Previews](/en/user/previews), [Public sharing](/en/user/shares), and [Prototypes, canvas, and works](/en/user/artifacts).

## Team know-how: Skills, plugins, knowledge base, and secrets

- **Skill market**: upload Skills or import them from a ZIP, a SKILL.md, or GitHub; after review, add them to a person, group, repository, or the team, and they're delivered to the Agent with each run.
- **Plugins**: can bring MCP servers, slash commands, canvas instructions, and provider presets; enabled for the team or a group after a sysadmin turns on the plugin feature.
- **Knowledge base**: markdown entries in a group that every Bot in the group can read; members and Bots can both maintain it, with version history.
- **Secrets**: four layers (platform, team, group, personal). At run time they're injected only as environment variables and masked by value in the process and replies.

See [Skill market and plugins](/en/user/market-plugins) and [Knowledge base and secrets](/en/user/knowledge-secrets).

## Context

Each "group × Bot" maps to one ongoing Agent session, so the Bot remembers earlier conversation in the group; after 6 hours idle (adjustable in system parameters) a new session starts automatically. The Bot bar in the group header shows each Bot's **context usage**. When it's nearly full you can:

- 「压缩上下文」 (Compact context): summarize the conversation so far and keep the summary;
- 「开新对话」 (New conversation): stop carrying the earlier conversation (same as `/new`).

The 「上下文」 (Context) tab in run details shows the context window usage for that turn, prompt cache hits, and an estimated breakdown.

## Related pages

- [Architecture](/en/guide/architecture)
- [Quick start](/en/guide/quick-start)
- [Glossary](/en/guide/glossary)
