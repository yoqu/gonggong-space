# Runs

This page covers a single run after a Bot is triggered: the run card, the task bar above the input box, run details (process, changes, context, approval log), how to stop a run, and choosing a model and reasoning effort before sending.

## Run card

After you @ a Bot and send, a run card for that Bot appears in the group and shows what it's doing in real time.

![A run card in progress](/screenshots/web/run-card.webp)

The card contains:

- **Title row**: a status icon; during a Bot relay, the relay progress (e.g. 「接力 2/3」, "Relay 2/3"). A turn the Bot continues on its own after a background task finishes is tagged 「后台任务完成后继续」 (Continued after a background task).
- **Subtitle**: the Agent and the requester, e.g. 「Claude Code · 王磊 触发」 ("Claude Code · triggered by 王磊").
- **Current step**: a Gong animation plus what it's doing, or the last line of the reply it's writing.
- **Progress checklist**: the steps the Bot lists with a progress card, shown inside the run card; a long checklist scrolls within the card.
- **Stats**: 「改动 N 个文件」 ("N files changed", click to view the changes), elapsed time, token usage (「用量未上报」 (Usage not reported) if none was reported), 「使用了 N 个「我的 Skill」」 ("Used N from My Skills"), the number of subagents and running background tasks, and the works produced or modified in this turn.
- **Buttons**: 「查看过程」 (View process), 「停止」 (Stop), 「打断并追加」 (Interrupt & append).

When the run ends with a reply, the card becomes the Bot's reply message, keeping the changed files, elapsed time, usage, and 「查看过程」 (View process) below it. The final reply in the group keeps only the text after the Bot's last tool call; earlier narration stays in the run details.

When one message @s several Bots, the card shows 「扇出 · N 个 Bot 并行」 ("Fan-out · N Bots in parallel").

::: tip Collapse run cards
Turn on 「运行卡片默认折叠」 (Collapse run cards by default) in 「群设置」 (Group settings) to collapse cards by default. This affects only you. Cards waiting for approval or an answer are always expanded.
:::

### Run status

| Status | Meaning |
| --- | --- |
| 排队中 (Queued) | Waiting to start, e.g. 「本群上一轮未结束，排第 N」 ("Previous turn in this group still running, #N in line"), 「该 Bot 忙，排第 N」 ("This Bot is busy, #N in line"), 「工作区准备中」 ("Preparing the workspace") |
| 离线等待 (Waiting for machine) | The Bot's machine is offline; it runs automatically once back online |
| 运行中 (Running) | Working |
| 等待审批 (Awaiting approval) | A permission request is waiting for the Bot owner; see [Approvals and questions](/en/user/approvals) |
| 等待回答 (Awaiting answers) | The Bot asked group members a question and is waiting for an answer |
| 已完成 (Completed) | Finished normally |
| 已中断 (Interrupted) | Stopped, or interrupted by an error |
| 已作废 (Void) | Voided before running, e.g. the offline wait timed out or the triggering message was recalled |
| 无权触发 (Not allowed) | You're not in the Bot's trigger scope; the run didn't start |

「等待审批」 (Awaiting approval) and 「等待回答」 (Awaiting answers) are shown as text; other states show only an icon, and you can hover to see the text.

### Queueing rules

- The same Bot runs only one turn at a time in a given group; the next turn queues.
- Each Bot has a concurrency limit (2 by default for new Bots). When several groups call on it at once, the extra runs queue. Change the concurrency limit in [Bot settings and permissions](/en/user/bot-settings).
- Queued runs don't count against the concurrency limit.
- When a Bot is offline, a request waits at most 30 minutes by default (adjustable via the group parameter 「Bot 离线等待上线（分钟）」 (Wait for offline Bot, minutes)). On timeout, it's voided and the requester is notified.

### Session notices

By default, a Bot continues its previous session. In these cases, the card notes that a new session was started:

| Notice | Reason |
| --- | --- |
| 已按要求开启新会话 (Started a new session as requested) | You sent `/new` |
| 本轮因配置变更开启新会话 (New session for this turn after a config change) | The Bot's model, provider, or other configuration changed |
| 距上次对话较久，已开启新会话 (New session after a long break since the last turn) | The Bot was idle for more than 6 hours (adjustable via the system parameter 「Bot 闲置后下次对话自动开新会话」); the old session's cache has expired, so a new session saves tokens |
| 定时任务在独立的新会话中运行 (Scheduled tasks run in a fresh session of their own) | Scheduled tasks always use a new session and don't continue the group's session |
| 原供应商已删除，已开启新会话 (The previous provider was deleted; started a new session) | The provider the session used was deleted |
| 会话恢复失败，已开新会话并补送最近 50 条群消息 (Couldn't resume the session; started a new one with the last 50 group messages) | The original session couldn't be found on the machine |

## Task bar above the input box

While a group has unfinished runs, a task bar above the input box summarizes 「待我处理 N」 ("N for me"), 「运行中 N」 ("N running"), and 「等待中 N」 ("N waiting").

- Requests waiting for your approval or answer come first, shown as 「待审批」 (Needs approval) or 「待回答」 (Needs answer); click to jump to the matching card.
- Every other run gets its own tag showing the Bot name; click to see details: the current step shows up to three lines, and the progress checklist scrolls inside the popover.
- In the popover, 「定位」 (Locate) jumps to the run card in the group, and 「过程」 (Process) opens the run details.

## Gong's actions

The Gong (共字君) figure on the card changes with the run state:

| State | Action | Text |
| --- | --- | --- |
| Running, writing a reply | Typing | 正在回复 (Replying) |
| Running, otherwise | Carrying | 正在工作 (Working) |
| Queued | Waiting | 排队中 (Queued) |
| Awaiting approval | Raising a hand | 等待审批 (Awaiting approval) |
| Awaiting answers | Asking | 等待回答 (Awaiting answers) |

Other states don't show Gong, only the status icon. If the Bot has a different character, its own character is shown instead.

## Run details

Click 「查看过程」 (View process) on the run card to open the tab 「Bot 名 · 第 N 轮」 ("Bot name · round N") in the workbench on the right. When a request is waiting for you, the tab is marked 「待处理」 (Needs you).

![Process view of the run details](/screenshots/web/process-panel.webp)

The top shows the requester, status, model (「默认」 (Default) if not specified), elapsed time, start and end times, and usage. In the top-right corner:

- 「复制过程」 (Copy process): choose 「复制为纯文本」 (Copy as plain text) or 「复制为 Markdown」 (Copy as Markdown).
- 「机器与会话」 (Machine and session, ⓘ): the machine the run ran on, the session ID (copyable), the names and sources of secrets injected for this run, and the Agent settings in effect for this turn (provider, context window, auto-compaction window, whether the machine's CLI configuration is inherited, and so on).

Below are four views:

| View | Contents |
| --- | --- |
| 过程 (Process) | What it was thinking and doing at each step |
| 改动 (Changes) | Which files this turn changed; see [Diffs and files](/en/user/diff-files) |
| 上下文 (Context) | How much of the context window is used, cache hits, and the make-up; see below |
| 审批记录 (Approvals) | Triggers, permission requests and their outcomes, questions and their outcomes, stops, and so on |

- When a permission request is waiting for your approval or a question for your answer, the top of the process view lists 「待处理」 (Needs you), and you can approve or answer right there; 「在审批记录中查看」 (Show in audit log) jumps to the matching record.
- When a run fails, is interrupted, or is voided, a banner at the top shows the reason and what to do; you can 「复制错误信息」 (Copy error), or click 「重新运行」 (Rerun) to run another turn with the same message, and a new run card appears in the group.
- When you scroll up through history, click 「回到最新」 (Jump to latest) to return to the step in progress.
- Click 「查看上一轮（还有 N 轮）」 ("Show previous round (N more)") to page back through this Bot's earlier turns in this group.

### What the process shows

First comes the message that triggered this turn, followed by 「本轮上下文」 (Turn context): labeled 「续用会话」 (Resumed session) or 「新会话」 (New session), it explains which group messages were sent along with this turn and the default git actions.

After that, each step is listed in order, each row with a timestamp:

| Type | Shown as |
| --- | --- |
| Thinking | 正在思考 / 思考 (Thinking / Thought) |
| Read, search, list directory | 正在读取 / 已读取 (Reading / Read), 已搜索 (Searched), 已列出 (Listed), etc.; a search with no results shows 「未找到」 (Not found) |
| Command | The command itself; the duration if longer than 2 seconds; expand to see the last 6 lines of output, and 「… 另有 N 行」 ("… N more lines") to see everything |
| Edit file | The file name and `+N −M`; click to go straight to that file's changes |
| Web search and page visits | Consecutive searches and visits are combined into one row; see below |
| MCP call | 「服务 · 工具」 ("server · tool"); Gonggong Space's built-in tools show a readable name (e.g. 「向群成员提问」, Ask group members). Expand to see 「参数」 (Arguments) and 「结果」 (Result) |
| Subagent | Name, task, and 「N 次调用 · 状态」 ("N calls · status": 进行中 / 已完成 / 失败 / 已取消 / 已断开, in progress / completed / failed / cancelled / disconnected); expand to see its own process |
| Background task | Status (运行中 / 已暂停 / 已完成 / 失败 / 已停止, running / paused / completed / failed / stopped) and log path; you can click 「停止」 (Stop) |
| Permission request | The request and its outcome, e.g. 「等待 Bot 主人审批」 ("Waiting for the Bot owner's approval"), 「某某 已批准」 ("Approved by X"), 「超时未审批，已自动拒绝」 ("Not approved in time; rejected automatically") |
| Question to group members | The question title and the answer |
| Interrupt and append | 「某某 · 打断并追加」 ("X · interrupted and added") and the appended text, at the point where it came in |
| Context compaction | 「正在压缩上下文…」 (Compacting context…), 「已自动压缩上下文」 (Auto-compacted context), and so on; expand to see the compaction summary |

- Read-only commands such as `ls`, `cat`, `grep`, and `git status` count as lookups, not commands.
- Commands auto-approved by the Bot's approval rules are combined into one row, 「自动批准 N 条命令」 ("Auto-approved N commands").
- When the Agent retries the same failing call repeatedly, the attempts are combined into one row labeled 「同一错误重复 N 次」 ("Same failure N times in a row").
- The start of a run notes who reviews approvals for this turn, e.g. 「审批由 Claude 内置审核（auto 模式）把关」 ("Approvals go to Claude's built-in review (auto mode)"); see [Approvals and questions](/en/user/approvals#review-for-me).

### Web search

Consecutive web searches and page visits by the Bot are combined into one row:

- While searching, it shows 「正在搜索 “关键词”」 ("Searching "keyword"") with a spinner, and the source list expands automatically.
- When done, it collapses to 「已搜索 N 个网站」 ("Searched N sites"), or 「已访问 N 个网页」 ("Visited N pages") when it only visited pages, with the source sites' icons stacked beside it.
- Click the row to expand it and see each search's keywords and the pages it found; click a page title to open it in a new tab.

![Combined web search row](/screenshots/web/web-search.webp)

### Filtering and output

「筛选过程」 (Filter process) at the top of the process switches between 「全部」 (All), 「失败」 (Failed), 「需处理」 (Requests), and 「命令」 (Command); steps inside subagents are filtered too. When nothing matches, it shows 「没有符合条件的步骤」 (No matching steps).

After expanding a command's output, you can 「搜索输出」 (Search output, showing "N matching lines") or 「复制输出」 (Copy output).

### Folding rules

The process merges small steps so you can skim quickly:

- Reply text, permission requests, the turn context, subagents, and background tasks always get their own row.
- Between them, 2 or more consecutive calls are merged into a group named after what the group did, e.g. 「读取了文件、运行了命令」 ("Read files, ran commands"). A single call isn't merged. Thinking inside a group doesn't count toward the number of calls.
- If a group contains failures, it's labeled 「N 个失败」 ("N failed").
- After the run ends with a final reply, all steps before the reply are folded into 「已工作 X 分 Y 秒」 ("Worked for X min Y s"), with a summary such as 「查阅 12 · 命令 3 · 改动 2 · 子 agent 1」 ("Explored 12 · Commands 3 · Changes 2 · Subagents 1"). Background tasks that are still running aren't folded.
- Everything is collapsed by default; the group in progress and running subagents stay expanded. Anything you expand or collapse manually is remembered.

::: tip Process retention
Approval and question records are kept permanently. The full run process is kept for 30 days by default; after that, the card keeps only a summary and shows 「运行过程已过期，仅保留摘要」 ("Run details expired; only the summary is kept"). The retention period is set by the admin; see [System parameters](/en/admin/params).
:::

### Context

The 「上下文」 (Context) view shows the state of the Agent's context window at the end of this turn, to help you decide whether to compact or start a new conversation.

![Context tab of the run details](/screenshots/web/run-context.webp)

- **已用上下文 (Context used)**: tokens used / window size, 「已用 N% · 剩余 …」 ("N% used · … left"), labeled 「健康」 (Healthy), 「偏高」 (High), or 「将满」 (Nearly full).
- **提示词缓存 (Prompt cache)**: the hit rate, and how much came from the cache versus how much is new.
- **上下文构成 (Context make-up)**: a block chart showing the shares of 「系统提示词与工具定义」 (System prompt & tool definitions), each tool call, each turn's conversation, and 「剩余空间」 (Free space).
- **内容 (Contents)**: filter by 「全部」 (All), 「系统」 (System), 「工具调用」 (Tool call), or 「会话内容」 (Conversation) to list the size of each item; when there are many, click 「显示全部 N 项」 ("Show all N").

::: info The make-up is an estimate
Items are estimated from text length; the system prompt and tool definitions are the used total minus everything else. Earlier parts of the session (compacted or cleared by the Agent, or from before the machine's daemon restarted) have no breakdown and are shown together as 「系统与早先内容」 (System & earlier content). The breakdown is computed after the turn ends; if the Agent didn't report it, the view shows 「这次运行的 Agent 没有上报上下文用量」 ("The agent did not report context usage for this run").
:::

For the context ring on the Bot bar in the group header, and how to compact or start a new conversation, see [Directing Bots in a group](/en/user/chat).

## Stop a run

Click 「停止」 (Stop) on the run card, or send `/stop @Bot` in the group (see [Command reference](/en/user/commands)).

- Any group member can stop a run.
- A queued run ends immediately; a running run ends once the machine confirms. Unhandled approvals and questions are voided along with it.
- For later turns in a Bot relay, the button shows 「终止整条链」 (Stop the whole chain). After you confirm, all unfinished turns on that relay chain stop, and no further relays are triggered.

If the turn had already changed files when stopped, the card shows 「已停止 · 本轮改动 N 个文件留在工作区」 ("Stopped · N files changed this turn left in the workspace") and offers two choices:

| Button | Effect |
| --- | --- |
| 保留改动 (Keep changes) | Default. No rollback, no automatic commit, no stash |
| 丢弃本轮改动 (Discard this turn's changes) | Restores only the files touched this turn; earlier uncommitted changes are unaffected |

![Choosing to keep or discard changes after stopping](/screenshots/web/interrupt-choice.webp)

Only the requester or the Bot owner can choose, and there's no time limit. The next turn's context tells the Agent that the previous turn was interrupted by `/stop`, along with the current state of those files.

If you don't want to stop but just want to add requirements, use 「打断并追加」 (Interrupt & append); see [Directing Bots in a group](/en/user/chat).

## Choose a model and reasoning effort

After you @ a Bot in the input box, a configuration chip for that Bot appears below the input box, e.g. 「后端助手 · Sonnet」. Click it to choose:

![Model and reasoning effort menu](/screenshots/web/run-config-chips.webp)

- 「模型」 (Model): the models the machine reports as available. If the list looks wrong, click 「刷新模型」 (Refresh models) to have the machine detect them again.
- 「推理强度」 (Reasoning effort): the reasoning effort levels the Agent supports.

After you choose, the chip shows 「仅本条」 (This message only), and the choice applies only to this message. Click 「设为本群默认」 (Set as group default) in the menu to make it this Bot's default configuration in this group.

Order of precedence: the choice for this message → the group default → the Bot's own default configuration (see [Bot settings and permissions](/en/user/bot-settings)).

- Only the Bot owner or a group admin can switch; others see 「只有 Bot 主人或群管理员可以切换」 ("Only the Bot owner or a group admin can change this").
- If the machine hasn't reported available models yet, the chip is disabled with the hint 「机器尚未上报可选模型」 ("The machine hasn't reported its models yet").

The approval mode isn't chosen here; see [Approvals and questions](/en/user/approvals).

## Related pages

- [Directing Bots in a group](/en/user/chat)
- [Approvals and questions](/en/user/approvals)
- [Diffs and files](/en/user/diff-files)
- [Command reference](/en/user/commands)
