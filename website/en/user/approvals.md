# Approvals and questions

This page covers the two situations during a run where a person has to decide — a Bot's permission requests (approvals) and a Bot asking group members questions — plus the 「审批方式」 (Approval) setting that decides which operations need approval.

## Permission requests

When an operation the Bot wants to perform isn't allowed by the rules, the run pauses, a permission request appears on the card, and the status changes to 「等待审批」 (Awaiting approval).

![Permission approval card](/screenshots/web/approval.webp)

The card shows:

- The title 「权限请求 · 类型」 (Permission request · type). Types include: 执行命令 (Run command), 访问网络 (Network access), 写入文件 (Write file), 删除文件 (Delete file), 移动文件 (Move file), 读取文件 (Read file), 搜索 (Search), and 其他操作 (Other action).
- The **full command** or the target of the operation. Anything longer than 400 characters or 8 lines is collapsed; click 「展开全部（N 字）」 (Show all (N characters)) to see all of it.
- An explanation line with the reason first, then the countdown, e.g. 「需要写入或修改文件 · 29:41 后自动拒绝，agent 自行绕路」 ("File write or modification required · rejected automatically in 29:41, the agent works around it"). The countdown ring turns orange in the last 30 seconds.
- When AI pre-review is on, a risk label (低风险 / 中风险 / 高风险 / 极高风险 — Low / Medium / High / Critical risk) and 「AI 预审：理由」 ("AI pre-review: reasoning").
- When the Agent sent several requests at once, 「还有 N 个请求在等待：」 ("N requests are waiting too:") is listed below, and you can 「全部批准（N）」 (Approve all (N)) in one go.

The possible reasons are:

| Reason | Description |
| --- | --- |
| 高危命令，必须由主人确认 (High-risk command; the owner must confirm) | Hits the hard floor; see below |
| 可能修改受保护的基准分支 (May modify the protected base branch) | The group has 「禁止直推基准分支」 (No direct pushes to the base branch) on, and the command might push to the base branch |
| 需要访问网络 (Network access required) | Requests that access the network |
| 需要写入或修改文件 (File write or modification required) | Writing, deleting, or moving files |
| 命令较复杂，无法确认是否只读 (Complex command; read-only behavior could not be confirmed) | The command couldn't be parsed |
| 未被只读规则或已保存的允许规则覆盖 (Not covered by read-only or saved allow rules) | Any other command that wasn't allowed |
| AI 预审认为有风险 / AI 预审超时 / AI 预审没有给出结论 / AI 预审未能运行 (The AI pre-review flagged a risk / timed out / gave no verdict / could not run) | AI pre-review is on, but it didn't allow the request |

### Who can approve

**Only the Bot owner** can handle it; the card says 「你是 Bot 主人」 (You own this Bot). Everyone else sees 「仅 Bot 主人 某某 可操作，你只能查看」 ("Only the Bot owner X can decide; you can only view"). Group admins can't approve on the owner's behalf either.

| Button | Effect |
| --- | --- |
| 批准 (Approve) | Allow this once |
| 本次会话不再问 (Don't ask again this session) | Allow this once, and don't ask about similar operations again until this session ends (hover to see the rule) |
| 批准，不再询问 (Approve, don't ask again) | Allow this once, and save the rules listed under 「不再询问：…」 ("Won't ask again: …") on the card to this Bot so they're approved automatically from then on |
| 本次运行免审批 (No approvals this run) | Don't ask about any remaining requests in this turn; see below |
| 拒绝 (Deny) | Reject this once; the Agent will find another way |
| 全部批准（N） (Approve all (N)) | Shown when several requests are queued; approves them one by one |

After it's handled, the card shows the outcome, e.g. 「某某 已批准 · 14:32」 ("Approved by X · 14:32") or 「某某 已拒绝 · 14:32 · agent 将自行绕路」 ("Rejected by X · 14:32 · the agent will work around it").

The Bot owner can also handle requests directly from 「待处理」 (Needs you) at the top of the run details, or from notifications; see [Runs](/en/user/runs#run-details).

### Approve, don't ask again

Shown only when the Agent offers the option and Gonggong can work out a rule to remember; the scope is stated below the button, e.g. 「不再询问：npm run build、tail」 ("Won't ask again: npm run build, tail").

Rules are kept as narrow as possible:

- Commands are remembered as a **prefix**: up to the first 3 plain words, stopping at an argument starting with `-`, a path, a quote, or `=`. For example, `npm run build -- --watch=false` is remembered as `npm run build`, so `npm run build` with any arguments is approved automatically afterward.
- Dangerous programs, or ones that can run arbitrary code — `rm`, `mv`, `sudo`, `sh`, `bash`, `python`, `node`, `curl`, `wget`, `ssh`, `chmod`, `kill`, and so on — are remembered as the **whole command text**; changed arguments need approval again.
- Read-only commands and `cd` within the workspace are already exempt from approval, so they aren't remembered.
- Requests that aren't commands (such as MCP tools or network access) are remembered as `tool:<tool name>`; only the tool with that exact name is approved automatically.
- The hard floor and pushes to a protected base branch are never remembered.

Rules are stored **on the Bot** and apply in every group the Bot is in. The Bot owner can view, delete, or manually add rules (e.g. `go build`) in 「已允许的命令」 (Allowed commands) in the Bot settings; once a rule is deleted, you'll be asked again. See [Bot settings and permissions](/en/user/bot-settings).

### Don't ask again this session

Similar to 「批准，不再询问」 (Approve, don't ask again), but only valid for the current session: it expires when the session ends (e.g. `/new` or starting a new session) and isn't saved to the Bot. The scope is slightly wider:

- Running a **script inside the workspace** with an interpreter such as `python` or `node`: that interpreter won't be asked about again for any script inside the workspace.
- Accessing a website with `curl` or `wget`: the same host won't be asked about again.
- Other commands follow the same rules as 「批准，不再询问」 (Approve, don't ask again).

### No approvals this run

Temporarily switches this turn to 「完全允许」 (Allow everything), so no further requests are asked about; the next turn automatically goes back to the original approval setting. Useful when you've confirmed everything this turn will do is fine and don't want to approve each one.

- Only the Bot owner can use it.
- It's written to the audit log.
- The button isn't shown in demo mode.

### Automatic rejection on timeout

A permission request waits **30 minutes** by default. If nobody handles it, it's rejected automatically, showing 「超时未处理，已自动拒绝」 ("No response in time, rejected automatically"), and the Agent works around it.

- Group admins can adjust this for their group (1–1440 minutes) with the group-level parameter 「权限审批等待（分钟）」 (Approval wait (minutes)); see [Groups and direct chats](/en/user/groups).
- The site-wide default is set by the sysadmin in 「权限审批等待 · 群默认」 (Approval wait · group default); see [System parameters](/en/admin/params).

When the run is stopped, the handoff chain is terminated, or someone uses interrupt and append, unhandled requests are voided automatically and show 「运行已停止，请求作废」 ("Run stopped; request void") or similar.

## Approval setting

Which operations need approval is decided by the Bot's 「审批方式」 (Approval) setting. The Bot owner picks it in the Bot settings; see [Bot settings and permissions](/en/user/bot-settings):

| Approval | Description |
| --- | --- |
| 每次问我 (Ask me every time) | Read-only commands are allowed automatically; everything else gets an approval card |
| 帮我审批 (Review for me) | Builds, tests, lint, formatting, local git, and file changes inside the workspace are allowed directly; everything else gets an approval card, assessed by AI first if AI pre-review is on |
| 完全允许 (Allow everything) | Never asks; the Bot can perform any operation |

Bots set to 「只读」 (Read-only) in earlier versions still show 「只读」 (Read-only): the Bot can only read, and everything else needs approval.

Except under 「完全允许」 (Allow everything), high-risk commands, pushes to a protected base branch, and client releases always need the Bot owner's confirmation.

::: tip Change the approval setting for just one group
The Bot owner can open the Bot's menu in 「群设置 → Bot」 (Group settings → Bot) and pick 「跟随全局」 (Follow global), 「只读」 (Read-only), 「需要审批」 (Needs approval), or 「完全允许」 (Allow everything) under 「本群审批方式」 (Approval in this group). This affects only that group, and the change takes effect immediately on turns in progress.
:::

::: warning
With 「完全允许」 (Allow everything), tasks started by anyone who can trigger this Bot are never blocked, including dangerous commands, so only turn it on for groups or Bots you use yourself. In this case, even if the trigger scope is set to 「任何群成员」 (Any group member), the Bot can be triggered only by the specified list. 「完全允许」 (Allow everything) isn't available in demo mode.
:::

### How a request is decided

1. Gonggong Space's built-in tools (such as asking group members a question or reading group messages) are always allowed.
2. If the approval setting is 「完全允许」 (Allow everything) — including 「本次运行免审批」 (No approvals this run): allowed automatically.
3. If it hits the hard floor or might push to a protected base branch: the Bot owner is asked to approve (AI pre-review is skipped).
4. If all paths of a read or search tool are inside the workspace or its additional directories: allowed automatically; symlinks pointing outside still require approval.
5. If the whole command consists only of read-only commands (such as `cat`, `ls`, `rg`, `git status`, `sed` used for reading, `find` without deletion or execution, `jq`, `ps`, `diff`, `stat`, `du`, `which`) and `cd` within the workspace, and reads no path outside the workspace: allowed automatically.
6. If it matches the rules in 「已允许的命令」 (Allowed commands) or 「本次会话不再问」 (Don't ask again this session): approved automatically.
7. If the approval setting is 「帮我审批」 (Review for me) and it's a common development command or a file change inside the workspace: approved automatically.
8. If AI pre-review is on: the AI assesses it first; if it allows it, it's approved automatically, otherwise it goes to the Bot owner.
9. Otherwise, the Bot owner is asked to approve.

Automatically approved commands show in the process as 「已按命令审批规则自动批准」 ("Automatically approved by command approval rules"); several are combined into 「自动批准 N 条命令」 ("Auto-approved N commands").

### Review for me

The common development commands allowed directly under 「帮我审批」 (Review for me) include: `npm`, `pnpm`, `yarn`, and `bun` running project scripts and tests; `cargo build` / `test` / `clippy` / `fmt` and the like; `go build` / `test` / `vet` and the like; `make`; common formatting, lint, and test tools; and local git operations. This amounts to trusting the scripts in the repository, so the following are not allowed directly:

- Commands with paths outside the workspace, or arguments that load external config, plugins, or hooks;
- Once this turn has changed files that affect build and test commands (such as script configs), subsequent development commands need approval again;
- Writing files inside the `.git` directory.

**Built-in review**: With Claude Code's official login or Codex's official ChatGPT login, 「帮我审批」 (Review for me) hands off to the Agent's own automatic review (Claude uses auto mode, Codex uses agent mode). Gonggong no longer pre-reviews, so you'll hardly be disturbed; operations it blocks make the Agent try another way, with no card. Third-party providers and unsupported models can't use the built-in review and are approved by Gonggong's rules. The start of the run notes who reviews it this time, e.g. 「审批由 Claude 内置审核（auto 模式）把关」 ("Approvals handled by Claude's built-in review (auto mode)") or 「第三方供应商用不了内置审核，审批由共工规则把关」 ("Third-party providers can't use the built-in review; approvals handled by Gonggong's rules").

**AI pre-review**: Off by default. The Bot owner turns it on by picking a model in 「AI 预审」 (AI pre-review) in the Bot settings. From then on, requests the rules didn't allow and the built-in review didn't take are first assessed by that model:

- The AI can only allow; anything it's unsure about goes to you with the risk and reasoning, and the card shows a risk label and 「AI 预审：理由」 ("AI pre-review: reasoning").
- If the AI already allowed the same command earlier in this turn, it's approved directly when it comes up again.
- The hard floor, protected base branches, and client releases never go to the AI.
- Every assessment costs tokens, so pick a small model (such as haiku, mini, or flash). Assessments run in a stripped-down session in an empty directory with no tools, a few thousand tokens each.
- It can't be turned on until the Bot's machine has reported its available models.

### Hard floor

The following commands **always need the Bot owner's approval**, whichever approval setting is chosen (except 「完全允许」 (Allow everything)) and whatever 「已允许的命令」 (Allowed commands) contains:

- Commands run with `sudo`, `su`, or `doas`;
- `rm` with `-r`/`-f`-style flags whose target is `/`, `/*`, `~`, `~/…`, `$HOME…`, `..`, `.`, or `*`;
- `git push` with `-f`, `-d`, `--force`, `--force-with-lease`, `--mirror`, `--delete`, or a refspec starting with `:` or `+`;
- `git reset --hard`; `git clean` with `-f`;
- A pipe whose downstream is `sh`, `bash`, `zsh`, `python`, or `node` reading a script from standard input (e.g. `curl … | sh`);
- `chmod -R`, `chown -R`; `dd of=…`; `mkfs…`.

When a command can't be parsed, it's also treated as high-risk if the text contains `sudo `, `rm -rf /`, `| sh`, or `| bash`.

::: tip Want fewer approvals?
- Read-only commands are already exempt, so there's no need to add rules for them.
- For day-to-day development, choose 「帮我审批」 (Review for me), and build and test commands won't be asked about.
- Click 「批准，不再询问」 (Approve, don't ask again) once for a common command, and no group will ask again.
- When a turn needs many operations you're sure are fine, click 「本次运行免审批」 (No approvals this run).
:::

## Bots asking group members questions

When a Bot is unsure, it uses 「向群成员提问」 (Ask group members) to post a question card, and the status changes to 「等待回答」 (Awaiting answers).

![Bot question card](/screenshots/web/question.webp)

- The card is titled 「向群成员提问 · N 个问题」 ("Ask group members · N questions"), with up to 4 questions per card (the system parameter 「提问卡片每张题数上限」 (Max questions per question card) can lower this).
- Question types:

| Type | How to answer |
| --- | --- |
| 单选 (Single choice) | Pick one option, or fill in 「其他，我来补充」 (Other (type your own)) |
| 多选 (Multiple choice) | Pick several options; you can also add text |
| 是/否 (Yes/No) | Pick one of two |
| 自由文本 (Free text) | Fill in 「自由作答」 (Your answer) |

- The Bot can mark an option as 「推荐」 (Recommended). Options can carry a description, a color palette, or a preview image, making it easier to compare design directions.
- You can click 「附图片或附件…」 (Attach images or files…) to attach files, then click 「提交回答」 (Submit answers).
- Options with a description or image have a 「倾向」 (Lean) button that anyone can click to show which one they lean toward; the card notes 「其他人的倾向仅供参考，不算投票」 ("Others' leanings are for reference only, not votes").

### Who can answer

**The requester, the Bot owner, and any group members @-mentioned in the question** can answer. The card states 「触发人 某某 或 Bot 主人 某某 可回答」 ("X (who started it) or the Bot owner Y can answer"), and when the Bot assigned members, it also shows 「指定：@某某」 ("Assigned: @X"). Everyone else can only view.

### Timeout

Questions wait the same length of time as permission requests (30 minutes by default). The card shows 「mm:ss 后超时，按推荐项继续」 ("Times out in mm:ss, then goes with the recommendations").

On timeout, the Agent continues with the recommended option or its own best judgment, and lists the assumptions it made in its final reply. The card shows 「无人回答，agent 已按推荐项继续」 ("No answer; the agent went on with the recommended options").

After someone answers, the card collapses to a short result listing the answer to each question and shows 「某某 已回答 · 已写入审计记录」 ("Answered by X · recorded in the audit log"); click 「查看提问」 (Show questions) to expand the original questions. Answers also appear in the process in the run details.

## Notifications

- When there's a permission request, the **Bot owner** is notified.
- When there's a question, the requester, the Bot owner, and any assigned members are notified.
- Once handled, timed out, or voided, the related notifications are marked as handled automatically.
- With browser notifications enabled, approvals and questions are also pushed as system notifications.
- These alerts still arrive even if the group has 「消息免打扰」 (Mute messages) turned on.

For how to use the notification center, see [Notifications](/en/user/notifications).

## Related pages

- [Bot settings and permissions](/en/user/bot-settings)
- [Runs](/en/user/runs)
- [Git management](/en/user/git)
- [Notifications](/en/user/notifications)
