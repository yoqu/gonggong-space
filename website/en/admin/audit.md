# Audit log

This page explains how to search the 「审计记录」 (Audit log) page and which events the system records.

![Admin console · Audit log](/screenshots/web/admin-audit.webp)

## View and filter

Entries are listed newest first and **kept permanently**; they aren't affected by cleanup parameters such as 「完整运行过程保留」 (Full run process retention).

- The segmented control at the top filters by type: 全部 (All) / 审批 (Approval) / 提问 (Question) / 锁与同步 (Locks & sync) / 管理 (Admin) / 运行 (Run) / 预览 (Preview).
- The 「全部操作人」 (All actors) dropdown filters by actor. Entries generated automatically by the system (such as approval timeouts) show the actor as 「系统」 (System).
- The search box in the top right searches by summary, group name, or actor.

The page loads 50 entries at a time; click 「加载更多」 (Load more) at the bottom to go further back. The actor filter and search apply only to entries already loaded, so to find older events, load a few more pages first or narrow the range with the type filter.

The table columns are time, type, actor, and summary. For entries related to a group, the summary ends with 「· 群名」 (· group name). Double-click a row to open its details, showing the full summary and the raw fields.

## Which events are recorded

### Approvals

- Approving or rejecting a Bot's permission request, and automatic rejection on timeout.
- Approval requests being voided (after /stop, when the relay chain was terminated, or when the run ended).

Only the Bot owner can handle permission requests; see [Approvals and questions](/en/user/approvals).

### Questions

- Answering a Bot's question, a question timing out unanswered, and a question being voided.

### Runs

- Interrupting a run with `/stop`, and terminating an entire relay chain.
- Keeping or discarding the changes of an interrupted turn.
- Switching or restoring a Bot's working directory with `/cd`, and starting a new session with `/new`.
- Interrupting a Bot's background task.
- A Bot reading content from another group.

### Admin

| Object | Events |
| --- | --- |
| Account | Create, change name or role, reset password, deactivate, reactivate, self-register |
| Bot | Create / modify / delete a Bot for someone else, confirm a Bot, change approval settings, set a Bot's provider |
| Machine | Revoke a machine, transfer a machine to a new owner, install or upgrade Agent tools, change the mirror source for Agent tools, save / delete / import providers, change the default provider |
| Group | Change group name and announcement, delete an announcement, change group-level parameters, assign or remove group admins, invite or remove members, add or remove Bots, bind or change the repository, disband the group |
| Configuration | Add, modify, or delete server-global MCP entries; change system parameters (each item's old and new value is recorded) |
| Client releases | Script publish, upload or remove daemon / gg-cast |

### Previews

- Creating a public link (including its validity in days), revoking it, and changing its validity.
- Visiting a preview through a public link.

::: tip
The 「锁与同步」 (Locks & sync) type currently has no entries.
:::

## What the audit log does and doesn't contain

- The audit log records only "who did what, and when," plus necessary context (such as account names, Bot names, and repository URLs). It never records passwords or other secrets.
- Command titles in approval entries are redacted before being stored; see [Security model](/en/deploy/security#redaction).

## Related pages

- [Security model](/en/deploy/security)
- [Approvals and questions](/en/user/approvals)
- [Command reference](/en/user/commands)
