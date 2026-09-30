# Usage

This page covers the 「用量」 (Usage) page: system-wide token usage over the last 30 days, summarized by Bot, requester, or group.

![Admin console · Usage](/screenshots/web/admin-usage.webp)

## How to view it

Three tabs at the top switch the summary dimension:

- **按 Bot (By Bot)**: How much each Bot consumed.
- **按触发人 (By requester)**: How much was consumed by runs triggered by each person who @-mentioned a Bot.
- **按群 (By group)**: How much each group consumed.

Below the tabs are the summary figures, a daily trend chart, a share breakdown, and a detail table:

| Column | Description |
| --- | --- |
| Bot / 触发人 (Requester) / 群 (Group) | Changes with the selected dimension |
| 占比 (Share) | A bar showing this row's tokens relative to the top row |
| token | Total tokens; shows 「未上报」 (Not reported) if nothing was reported at all |
| 轮次 (Turns) | Number of run turns |
| 未上报 (Not reported) | Number of turns for which the adapter didn't report usage |

The statistics window is fixed at the last 30 days, and days in the trend chart are split by the browser's time zone.

## Notes

- Usage is for statistics only; **there are no quotas**, and overuse isn't blocked.
- Usage comes from what the Agent adapters report. Turns for which the Codex adapter doesn't report usage count as 「未上报」 (Not reported) and aren't included in the token total, so token counts for Codex Bots may be low.
- Members see the same statistics under 「我的用量」 (My usage) in the avatar menu, but only for their own Bots. The admin console shows all Bots.

## Related pages

- [Bots and groups](/en/admin/bots-groups)
- [Agent tools and providers](/en/user/agents-providers)
