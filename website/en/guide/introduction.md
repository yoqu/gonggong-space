# What is Gonggong Space

This page covers what Gonggong Space is for, where it fits, how it differs from using an Agent directly in a terminal, and where the name comes from.

## In one sentence

Gonggong Space is a self-hosted AI collaboration platform for small teams: **@ a Bot in a group, and it drives Claude Code, Codex, or another Agent on a member's own machine to do real work**: reading code, editing files, running commands, with every step streamed back to the group live. Several Bots work in their own workspaces and pass tasks along to finish the same project.

![Group chat overview](/screenshots/web/chat.webp)

The system has four parts:

| Part | Role |
| --- | --- |
| Web | Where everyone logs in, chats, @s Bots, and follows the process and changes; works in mobile browsers too |
| Server | Stores accounts, groups, and messages, and dispatches tasks to the right machine |
| daemon (the `gg` CLI or the desktop app) | Installed on members' machines; picks up tasks and calls the local Agent |
| Bot | An AI member you can @ in a group; it belongs to a member and always runs on one of their machines |

Connecting a machine takes one message: in 「绑定新机器」 (Bind new machine), copy a message and send it to the Claude Code or Codex on that machine. It installs `gg`, binds the machine, keeps it running in the background, and sets up a Bot and your direct chat with it. For how the pieces relate, see [Core concepts](/en/guide/concepts) and [Architecture](/en/guide/architecture).

## Supported Agents

| Agent | Notes |
| --- | --- |
| Claude Code | Built in |
| Codex | Built in |
| Gemini CLI, CodeBuddy, pi, DeepSeek Harness | Connected as built-in Agent plugins |

Agents use the CLI already installed and signed in on the machine. You can also configure third-party model providers on the machine (keys are stored only locally). See [Agent tools and providers](/en/user/agents-providers).

## Where it fits

- **A small team sharing AI coding assistants**: everyone connects their own machine, the Agents on those machines become Bots, the Bots join project groups, and whoever needs something @s one.
- **Division of labor and relays**: the frontend Bot finishes a page and hands it to the backend Bot for the API. A Bot can hand a task to another Bot in the group, and can open a thread to split off a side task.
- **Discussion and execution in one place**: group discussion that doesn't @ a Bot is passed to it as context; the group knowledge base keeps project conventions that every Bot can read.
- **Work that must be visible and checked**: thinking, tool calls, command output, and diffs are visible live. Actions that need a check follow the approval mode the Bot owner set: ask a person every time, or use 「帮我审批」 (Review for me) so only risky actions reach a person.
- **Results people need to see**: web pages, services, desktop apps, and mini programs a Bot starts can be previewed right in the browser; prototypes go on a multi-screen canvas to annotate and iterate, then get a public link for people outside the team.
- **Recurring work on a schedule**: run the regression suite every morning, summarize yesterday's commits; a Bot does it automatically at the set time.

## How it differs from using an Agent in a terminal

| | In a terminal | Through Gonggong Space |
| --- | --- | --- |
| Who can direct it | Only the person at that machine | Any permitted group member can @ it (the trigger scope is set by the Bot owner) |
| Visibility | Only in your own terminal | Streamed live to the group; every group member can see the process and diffs |
| Multiple people / Agents | Everyone works separately and syncs by hand | Same group, same repository; Bots running different Agents can relay work |
| Permission checks | You confirm on the spot | The approval mode (Ask me every time / Review for me / Allow everything) is set by the Bot owner; only the Bot owner can act on approval cards, and actions are recorded in the audit log |
| Working directory | You manage it | Each "group × Bot" gets its own managed workspace automatically, isolated from the others; you can also point it at an existing local directory |
| Team know-how | Everyone's own configs and prompts | Skill market, plugins, knowledge base, and secrets shared in personal / group / team layers |
| Where it runs | Your machine | Still the member's own machine: the locally signed-in CLI and the local git credentials |

Gonggong Space doesn't replace these Agents; it brings them into your team's groups. The Agents' capabilities, models, and sign-in all come from the local configuration.

## Where to use it

- **Web**: the main entry point for chat, review, previews, and the admin console; open it in a mobile browser to follow progress and handle approvals.
- **Desktop app**: macOS (Apple silicon and Intel) and Windows. It bundles the daemon, so it is both a client and a place where work runs. See [Desktop app](/en/desktop/).
- **`gg` CLI**: macOS and Linux; can be installed as a background service. See [Command-line gg](/en/cli/).
- **Feishu**: once a Feishu app is bound, you can @ Bots in Feishu groups and direct messages, and run cards are mirrored to Feishu. See [Feishu](/en/admin/feishu).

## Where the name comes from

"Gonggong" (共工) is the water god of ancient Chinese mythology. In oracle-bone script, the character 共 shows two hands lifting something together, which matches the idea of "everyone lifting the work together". The logo is two wave crests holding up a piece of jade.

The brand mascot, Gong (共字君), is a flat little figure shaped like the character 共. A new Bot uses the selected Agent's look by default; you can switch it to Gong or one of 12 personality characters. See [Create a Bot](/en/user/create-bot).

## Next steps

- New here: start with [Core concepts](/en/guide/concepts)
- Want it running now: [Quick start](/en/guide/quick-start)
- Admins setting up the server: [Deployment overview](/en/deploy/)
