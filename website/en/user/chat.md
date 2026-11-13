# Directing Bots in a group

This page covers how to get Bots working in a group: triggering with @, the input box, background context, attachments, what Bot replies can contain, quote replies, interrupt and append, message actions, search, and context usage.

![Group messages overview](/screenshots/web/chat.webp)

## Mention a Bot to trigger it

In the input box, type `@` followed by the Bot's name, write your request, and press Enter to send:

```text
@后端助手 看一下登录接口为什么偶尔 500，找到原因后修复并跑测试
```

(The example asks the Bot 「后端助手」 (Backend Assistant) to find out why the login endpoint occasionally returns 500, fix it, and run the tests.)

1. Type `@`, or click 「@ 提及」 (@ mention) in the input toolbar, to bring up suggestions.
2. Use ↑ / ↓ to choose, Enter or Tab to insert, and Esc to close.
3. After you send, the message appears in the list immediately, followed by a run card for that Bot in the group; see [Runs](/en/user/runs) for the process.

![Typing @ shows suggestions](/screenshots/web/composer-mention.webp)

`@` suggestions come in two groups:

| Group | Contents |
| --- | --- |
| 成员 / Bot (Members / Bot) | The group's Bots (with online status) and members. Group admins in the group (not in a thread) also see 「所有人」 (Everyone) |
| 文件 (Files) | Files and folders in the Bot's workspace; picking one inserts `@path`, telling the Bot which file to look at |

- Suggestions support pinyin search: full pinyin, initials, or a mix, e.g. both `jwc` and `jiangwc` find 「姜维川」, with the matching characters in bold.
- If you @ several Bots in one message, each Bot starts its own run, and they run in parallel.
- @-mentioning a member only notifies them and doesn't trigger a Bot; @Everyone notifies all members.
- In a direct chat with only one Bot, you don't need @; sending a message triggers it.
- When deleting an `@name`, the first Backspace selects the whole mention and the second deletes it.

After you @ a Bot, its model and reasoning effort appear above the input box, and you can switch them for this message only; see [Runs](/en/user/runs).

In the following cases, the Bot doesn't start, and an explanation appears in the group:

| Message | Reason |
| --- | --- |
| 该 Bot 仅允许主人触发，未启动运行 ("Only its owner can trigger this Bot, no run started") | The Bot's trigger scope is 「仅本人」 (Owner only) |
| 该 Bot 仅允许指定名单触发，未启动运行 ("Only its allowlist can trigger this Bot, no run started") | You're not on its trigger list |
| Bot 未绑定或未确认，不能被触发 ("The Bot isn't bound or confirmed and can't be triggered") | The Bot isn't bound to a machine yet |
| 某某 等待 某某 确认工作区，本次未执行 ("X is waiting for Y to choose a workspace, so this was not run") | The Bot owner hasn't confirmed a workspace yet; see [Repositories and workspaces](/en/user/repos-workspaces#which-directory-is-used-on-joining) |
| 某某 所在机器无法访问仓库，本次未执行 ("X's machine cannot reach the repo, so this was not run") | See [Bot paused](/en/user/repos-workspaces#bot-paused) |

A Bot owner can always trigger their own Bot. Change the trigger scope in [Bot settings and permissions](/en/user/bot-settings).

::: tip Relays between Bots
When a Bot writes `@another Bot` in its reply text, that's just a mention and doesn't trigger the other Bot. A 「让 某某 处理」 (Hand to X) button appears below the reply; clicking it fills `@X` into the input box, and you decide whether to send it.

When a Bot needs another Bot to actually do something, it hands the task off: after its turn ends, a message from it appears in the group @-mentioning the other Bot with the task, and the other Bot starts running right away. This is a relay. Relays check trigger permission against the original requester and allow at most 3 hops by default (the group parameter 「接力链长上限」 (Max relay chain length)); see [Groups and direct chats](/en/user/groups#group-parameters). A Bot can also open a thread and assign a Bot to take over there; see [Threads](/en/user/schedules-threads#threads).
:::

## Input box

The input toolbar, from left to right: 「@ 提及」 (@ mention), 「表情」 (Emoji), 「命令」 (Command), 「附件」 (Attachment), 「图片」 (Image), plus 「✦ 创作」 (✦ Create) when a creation plugin is enabled in the group.

| Key | Action |
| --- | --- |
| Enter | Send |
| Shift + Enter, or Ctrl / ⌘ / Alt + Enter | New line |
| ↑ (when the input box is empty) | Edit your previous message |
| `/` | Command and Skill suggestions; see [Command reference](/en/user/commands) |
| `#` | Pick one of this group's works; see [Prototypes, canvas, and works](/en/user/artifacts) |
| ⌘K / Ctrl+K | Global search |
| Esc | Mark the current conversation as read |

- 「表情」 (Emoji) opens the emoji panel, with nearly 400 emoji in 8 categories.
- Unsent drafts are saved separately per group (and per thread), so they're still there after you switch conversations or refresh the page in the current browser tab.
- A message appears in the list as soon as you press Enter. If the network is down, the message is marked 「发送失败」 (Failed to send) in place, and you can 「重发」 (Resend) or 「删除」 (Delete) it; if the server rejects it (e.g. you lack permission), the text goes back into the input box with the reason.

## Messages without @: background context

Messages without an @ don't trigger Bots. When you've typed something without @-mentioning a Bot, the input box shows 「未 @ 的消息不会触发 Bot，会作为背景补充给下一次任务」 ("Messages without an @ don't start a Bot; they're added as context for its next task").

The next time a Bot is triggered, it receives the group messages sent after its previous run and before this trigger:

- Newest first, about **8000** tokens in total by default (estimated from text length, no message-count limit). Admins can adjust this in system parameters; see [System parameters](/en/admin/params).
- Older messages aren't attached directly; the Bot reads the group history itself when it needs to.
- Not included: the Bot's own messages, command messages, recalled messages, and thread replies that weren't also sent to the group.

So you can post background, links, and screenshots in several messages first, then @ the Bot with the task at the end.

## Attachments

Click 「附件」 (Attachment) or 「图片」 (Image) in the toolbar, paste files into the input box, or drag them onto the message area (you'll see 「将文件拖到这里」, "Drop files here"). Attachments are sent to the group's Bots with your next message.

![Images and attachments in messages](/screenshots/web/attachments.webp)

| Limit | Default | Description |
| --- | --- | --- |
| Size per attachment | 50 MB | Admins can lower it in system parameters |
| Attachments per message | 10 | Admins can lower it in system parameters |

- Any file type is allowed. Files upload immediately after selection with a progress indicator, and you can send only after uploading finishes.
- Before sending, click an attachment for 「发送前预览」 (Preview before sending): text, code, Markdown, PDF, Office, audio/video, and SVG can all be viewed directly.
- Attachments are written to `.gonggong/attachments/` in the Bot's workspace, which is added to `.git/info/exclude`, so they don't go into git.
- Images: if the Agent supports images, they're sent to it directly as images and also saved to disk so it can read them by path. Videos and audio aren't sent directly; the Agent reads them by path.
- Attachments in messages offer 「查看大图」 (View full size), 「下载」 (Download), and 「在工作台查看」 (Open in workbench); see [Diffs and files](/en/user/diff-files).

When a limit is exceeded, you'll see 「某文件 超过 50 MB，未添加」 ("X is over 50 MB and was not added") or 「每条消息最多 N 个附件」 ("Up to N attachments per message").

### Video and voice

Video and audio in the chat play in Gonggong Space's built-in player; only one plays at a time on a page.

![Video player in the chat](/screenshots/web/video-player.webp)

- **Video**: a large play button, a draggable progress bar (showing the buffered part, with the time on hover), skip back / forward 10 seconds, volume, playback speed (0.5–2×), picture-in-picture, and full screen. Volume and mute are remembered across players. While playing, the controls and cursor hide automatically when the mouse stays still for a moment.
- When a video has focus, you can use shortcuts: Space / K play or pause, ← / → skip back or forward, J / L also skip back or forward, ↑ / ↓ adjust volume, M mutes, F goes full screen, 0–9 jump to the matching position, and Shift + < / > change the speed.
- **Audio** is shown as a voice bar: click to play, drag or use the arrow keys to seek, and click the time to switch between 1× / 1.5× / 2× speed.

## What Bot replies can contain

- Long Bot replies are collapsed automatically; click 「展开全文」 (Show all) to read them and 「收起」 (Collapse) to fold them back.
- File paths in a reply are clickable and open directly in the workbench.
- Mermaid diagrams are rendered as diagrams.
- **Embedded web pages**: a Bot can embed an HTML page directly in its reply, laid out to the width of the chat column, with 「全屏查看」 (Full screen); images in the page open in Gonggong Space's image viewer.
- **Choice buttons**: when a Bot needs you to choose, it puts a set of buttons below its reply. Click one (or select several and confirm), and a message 「@Bot 选择了「…」」 ("@Bot chose "…"") is sent in the group as you, and the Bot carries on. Each set of buttons can be answered by only one person, and everyone sees the result.

## Quote reply

Hover over a message and click 「引用回复」 (Quote reply). 「引用 某某」 (Quoting X) and the quoted content appear above the input box.

- **Quoting a Bot's message or run card**: the input box automatically @-mentions that Bot, with the hint 「已自动 @ Bot，删掉 @ 就只引用、不触发」 ("The Bot is @-ed; delete the @ to quote without triggering it").
- **Quoting a member's message**: added only as extra context; it doesn't trigger any Bot.
- Quoted content is limited to 2,000 characters. Click the quote to jump back to the original message.
- If the quoted message is later recalled, the quote shows 「该消息已撤回」 ("This message was recalled").

## Interrupt and append during a run

If you want to add requirements while a Bot is still running, you don't have to wait for it to finish:

1. Click 「打断并追加」 (Interrupt & append) on the run card.
2. 「打断并追加到 某某 · 已改内容保留，仍算同一轮」 ("Interrupt & append to X · edits so far are kept, still the same turn") appears above the input box.
3. Type your additions (attachments allowed) and send.

![Appending a message during a run](/screenshots/web/append.webp)

- The Bot interrupts its current step and continues **in the same turn** with your additions. Files it has already changed are kept.
- Any unhandled approvals and questions in this turn are withdrawn.
- Only the requester or the Bot owner can interrupt and append; otherwise you'll see 「仅触发人或 Bot 主人可以打断并追加」 ("Only the requester or the Bot's owner can interrupt & append").
- If the run has already ended when you send, you'll see 「该运行已结束，请直接发送」 ("This run has ended, send it as a new message").
- `/` commands in an appended message aren't executed.

To stop a run, see [Runs](/en/user/runs).

## Reactions

Hover over a message and click 「表情回应」 (Reactions). Six are available: 👍 ✅ 👀 🎉 ❤️ 😂.

![Message reactions](/screenshots/web/reactions.webp)

- Click the same emoji again to remove it.
- Reactions appear below the message, listing up to 3 names; the rest show as 「等 N 人」 ("and N others").

## Message actions

Hover over a message to show the action bar (「回复话题」 (Reply in thread), 「引用回复」 (Quote reply), 「复制」 (Copy), 「更多」 (More)); right-click a message to open the full menu; on touch screens, long-press the message.

| Action | Description |
| --- | --- |
| 回复话题 (Reply in thread) | Start a thread discussion under this message; see [Threads](/en/user/schedules-threads#threads) |
| 表情回应、引用回复 (Reactions, Quote reply) | See above |
| 复制 (Copy) | Copy the message text; if you selected part of it first, only the selection is copied |
| 稍后处理 (Later) | Save this message and set a reminder; see [Notifications](/en/user/notifications#later) |
| 复制链接 (Copy link) | Copy a link to this message |
| 从这里标为未读 (Mark unread from here) | Move the unread divider to this message; see [Notifications](/en/user/notifications#unread) |
| 置顶 / 取消置顶 (Pin / Unpin) | Pin to the top of the group, up to 5 per group |
| 存入知识库 (Save to knowledge base) | Create a wiki entry from this message; see [Wiki and secrets](/en/user/knowledge-secrets#save-to-the-knowledge-base) |
| 分支到新聊天 (Branch to new chat) | Bot owner only, available on this Bot's most recent completed reply: opens a new direct chat with it that continues from this turn |
| 编辑 (Edit) | Your own regular messages only, within 24 hours |
| 撤回 (Recall) | Your own messages only, within 24 hours. The content is hidden from everyone |
| 删除 (Delete) | Your own messages only, no time limit. Hidden only for you; other members still see it |

**Edit**:

- Press Enter to save or Esc to cancel; the message is marked 「已编辑」 (Edited).
- You can't change who is @-mentioned, and command messages can't be edited.
- If a run triggered by the message has already started, it's stopped and rerun with the new content; if it's still queued, it simply uses the new content.

**Recall**:

- After 24 hours you'll see 「超过 24 小时，无法撤回」 ("Messages older than 24 hours can't be recalled").
- If a run triggered by the message is still queued or waiting, it's voided; runs that have already started continue.
- Within 5 minutes of recalling, you can click 「重新编辑」 (Edit again) to put the content (including attachments) back into the input box.

## Search

Press ⌘K (Ctrl+K on Windows / Linux) to open global search:

- Before you type, it lists 「最近」 (Recent) conversations; as you type, it matches conversation names.
- Below are three tabs, 「消息」 (Messages), 「文件」 (Files), and 「运行」 (Runs), searching the groups you're in within the current team. Thread replies open directly in their thread.
- ↑ / ↓ to choose, Enter to open, Esc to close.

## On mobile

When you scroll the message area on a phone, the Git bar, tabs, and notice bars at the top collapse and the input box shrinks to one line, leaving more room for messages; scroll back to the bottom or tap the input area to restore them.

## Context usage and compaction

On the Bot bar in the group header, each Bot has a ring showing how much of the model's context window its current session is using. Hover to see 「上下文 已用 / 总量」 (Context used / total), plus 「还剩 N 自动压缩」 ("Auto-compacts in N") when the Agent compacts automatically.

![Context usage](/screenshots/web/context-meter.webp)

- A tick on the ring marks where the Agent compacts automatically, and the ring turns orange as it gets close. When the Agent has auto-compaction turned off, the tick marks where it will stop, with the hint 「已关闭自动压缩，用到 N 时 Agent 会停下，需要手动压缩或开新对话」 ("Auto-compaction is off: the agent stops at N until you compact or start a new conversation").
- It appears only after the Bot has run at least one turn in this group and the Agent has reported usage.

Click the ring to open a panel:

| Action | Effect |
| --- | --- |
| 压缩上下文 (Compact context) | Sends `/compact @Bot` in the group, summarizing the earlier conversation and keeping the summary. You can first write what to keep in 「压缩时保留的重点（可选）」 (What to keep when compacting (optional)) |
| 开新对话 (New conversation) | Sends `/new @Bot` in the group; the next turn no longer carries the earlier conversation |

::: tip
- 「压缩上下文」 (Compact context) relies on the Agent providing a `compact` command; it's passed through to the Agent as-is as an Agent command. See [Command reference](/en/user/commands#agent-commands).
- When a Bot has been idle in the group for a while (6 hours by default, the system parameter 「Bot 闲置后下次对话自动开新会话」), the next conversation automatically starts a new session, and the run card notes 「距上次对话较久，已开启新会话」 ("New session after a long break since the last turn").
:::

## Related pages

- [Command reference](/en/user/commands)
- [Scheduled tasks and threads](/en/user/schedules-threads)
- [Runs](/en/user/runs)
- [Approvals and questions](/en/user/approvals)
- [Notifications](/en/user/notifications)
