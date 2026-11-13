# Command reference

This page lists what you can use after typing `/` in the input box: Gonggong Space's built-in system commands, Skills, plugin commands, and Agent commands, which are provided by the Agent itself and passed through as-is.

![Typing / shows command suggestions](/screenshots/web/composer-commands.webp)

## How to enter commands

- Type `/` at the start of the input box, or click 「命令」 (Command) in the toolbar, to open the suggestion list.
- You can also @ a Bot first and then type the command, e.g. `@后端助手 /compact`; the two forms are equivalent.
- Use ↑ / ↓ to select, Enter or Tab to insert, and Esc to close.
- Command names are case-sensitive.

The suggestion list is grouped by source:

| Group | Contents |
| --- | --- |
| 系统命令 (System commands) | Built into Gonggong Space — see below |
| 插件 (Plugins) | Plugins enabled in this group: pick a plugin name to open its creation panel; `/` commands provided by plugins are listed here too |
| 我的 Skill（个人引入） (My Skills · Installed by you) | Skills you installed yourself; they apply only in runs you start |
| 团队 Skill（配置中心） (Team skills · Configuration) | Other Skills available in this group (configured or installed at the group, team, or other levels) |
| AGENT 命令（ACP 上报） (Agent commands · Reported via ACP) | Commands provided by the Agent used by the Bots @-mentioned in the message |

::: tip Don't see Agent commands?
Agent commands are listed only for the @-mentioned Bots. Type `@BotName` first, then `/`. Also, a Bot must have run at least one turn in this group before its Agent commands show up.
:::

System command messages don't trigger a normal run and aren't fed to Bots as background context; the result is shown as a group notice.

## System commands

| Command | UI description | Syntax | Who can use it |
| --- | --- | --- | --- |
| `/stop` | 停止运行（未 @ Bot 时停止本群全部） (Stop runs (all in the group when no Bot is mentioned)) | `/stop` or `/stop @Bot …` | Group members |
| `/new` | 开新会话 (Start a new session) | `/new @Bot …` | Group members |
| `/cd` | 绑定本机目录（仅分区） (Bind a local directory (partition mode only)) | `/cd @Bot /absolute/path` or `/cd @Bot --reset` | Bot owner |

### /stop

Stops running and queued turns.

```text
/stop @后端助手
/stop
```

- With @: stops only the unfinished turns of those Bots.
- Without @: stops the unfinished turns of every Bot in the group.
- If a Bot hand-off chain is involved, the whole chain is terminated.
- The group shows a notice such as 「王磊 /stop · 停止 后端助手 的 1 个轮次」 ("王磊 /stop · stopped 1 turn of 后端助手"); if there's nothing to stop, it shows 「没有运行中的轮次」 ("No turns are running").
- The action is written to the audit log.

### /new

Makes the Bot start a brand-new session on its next turn, without carrying over the earlier conversation.

```text
/new @后端助手
```

- You must @ at least one Bot; otherwise you'll see 「/new 需要同时 @ 一个 Bot，如 /new @后端助手」 ("/new needs a Bot mention, e.g. /new @后端助手").
- The group shows 「后端助手 下一轮将开新会话」 ("后端助手 will start a new session next turn"), and the next run card shows 「已按要求开启新会话」 ("Started a new session as requested").
- Sending `/new` in a thread resets only that Bot's session in that thread, without affecting the main session in the group.
- 「开新对话」 (New conversation) in the context usage panel of the group header sends exactly this command — see [Context usage and compaction](/en/user/chat#context-usage-and-compaction).

### /cd

Makes the Bot work directly in a local directory on its machine instead of the managed workspace.

```text
/cd @后端助手 /Users/wanglei/code/todo-app
/cd @后端助手 --reset
```

- Only the Bot owner can use it, and only in partition-mode groups.
- You must @ exactly one Bot; the path must be an absolute path on the Bot's machine.
- If the path is a clone of one of the group's additional repositories, it's used as that additional repository's local directory; otherwise it replaces the Bot's main workspace.
- `--reset`: go back to the managed workspace.
- On success you'll see 「✓ 后端助手 已绑定到 /Users/…（本机目录）」 ("✓ 后端助手 is bound to /Users/… (local directory)") or 「✓ 后端助手 已使用托管工作区」 ("✓ 后端助手 now uses the managed workspace").
- If the directory is later deleted, runs fail with 「/cd 目录不存在」 ("/cd directory doesn't exist").

Common errors:

| Message | Cause |
| --- | --- |
| /cd 仅分区模式可用；强制同步群里非托管工作区的 Bot 为「不参与」 ("/cd is only available in partition mode; in force-sync groups, Bots without a managed workspace sit out") | The group is in force-sync mode |
| /cd 需要 @ 一个 Bot，如 /cd @… /本机/绝对路径，或 /cd @… --reset 回到托管 ("/cd needs one Bot mention, e.g. /cd @… /absolute/local/path, or /cd @… --reset to go back to managed") | No Bot @-mentioned, more than one @-mentioned, or no path given |
| 只有 Bot 主人可以使用 /cd ("Only the Bot's owner can use /cd") | You're not this Bot's owner |
| /cd 需要本机绝对路径，如 /Users/me/code/repo ("/cd needs an absolute local path, e.g. /Users/me/code/repo") | A relative path was given |
| 某某 离线，无法执行 /cd ("… is offline and cannot run /cd") | The Bot's machine is offline |
| 某某 绑定工作区失败：… ("… failed to bind the workspace: …") | The directory doesn't exist, is too broad, is a system directory, etc. |

Changing the workspace in the UI is more intuitive — see [Repositories and workspaces](/en/user/repos-workspaces#change-the-workspace).

## Skills

「我的 Skill」 (My Skills) and 「团队 Skill」 (Team skills) in the suggestions are the Skills currently available. Selecting one inserts the Skill name into the message; send it along with an @ to a Bot and the Bot works according to that Skill.

- Codex references Skills as `$name`, Claude Code as `/name`; when every @-mentioned Bot is a Codex Bot, the input box automatically uses the `$` form.
- 「我的 Skill」 (My Skills) apply only in runs you start yourself, and take precedence over Skills with the same name in the group, repository, or team.

For where Skills come from, installing them, and the market, see [Skill market and plugins](/en/user/market-plugins).

## Plugin commands

Plugins enabled in a group can bring their own `/` commands, listed in the 「插件」 (Plugins) group with the plugin name after the description. When sent, Gonggong hands the instructions defined by the plugin to the Bot to carry out. Plugin commands can't share a name with system commands. See [Skill market and plugins](/en/user/market-plugins).

## Agent commands

Agent commands are commands reported by the Agent a Bot uses (Claude Code, Codex, etc.), such as `/compact`. Which commands exist and what each does is up to the Agent itself; the descriptions in the suggestions also come from the Agent.

```text
@后端助手 /compact
```

- When sent, the command text is passed to the Agent **as-is**, without group context.
- It runs as an Agent command only if you @ a Bot and every @-mentioned Bot supports the command.
- In a direct chat with only one Bot, you can omit the @.
- A `/xxx` that doesn't meet these conditions is treated as a normal message. For example, `/path/to/file @后端助手 看下` is sent to the Bot as a normal task.

### Name clashes with system commands

When an Agent command has the same name as a system command, the suggestion shows it as `/BotName:command`, marked 「与系统命令重名」 (Same name as a system command). Typing `/new` directly runs the system command; to run the Agent's command of the same name, use the prefixed form:

```text
/后端助手:new
```

Remove any spaces from the Bot name.

## Related pages

- [Directing Bots in a group](/en/user/chat)
- [Runs](/en/user/runs)
- [Repositories and workspaces](/en/user/repos-workspaces)
- [Skill market and plugins](/en/user/market-plugins)
