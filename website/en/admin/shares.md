# Public links

This page covers the 「公开链接」 (Public links) page: one place to see every public link generated for Bot previews across all groups, and to extend or revoke them.

![Admin console · Public links](/screenshots/web/admin-shares.webp)

## What a public link is

Previews a Bot produces, such as web pages, can by default be opened only by signed-in group members. A group member can generate a **public link** for a preview; anyone with the link can open it without signing in, which is handy for showing results to external clients or colleagues. For how to create one, see [Public sharing](/en/user/shares).

A public link always has an expiry, no longer than 「预览公开链接最长有效期」 (Longest validity of a public preview link) in [System parameters](/en/admin/params#other) (30 days by default). It stops working immediately when it expires, is revoked, or the preview is closed; visitors then see 「公开链接已失效或已被收回。」 ("This public link has expired or was revoked.").

With [demo mode](/en/admin/params#demo) on, public links can't be created, and existing ones stop working immediately.

::: tip
Shares of prototype canvases and works (which can have a password or a pinned version) aren't in this list; see [Artifacts and prototype canvas](/en/user/artifacts).
:::

## Link list

The toolbar shows 「N 条 · M 条有效」 ("N total · M active"); the top-right search box searches by preview, group, or creator.

| Column | Description |
| --- | --- |
| 预览 (Preview) | Preview title |
| 群 (Group) | The group the preview is in |
| Bot | The Bot that opened the preview |
| 创建人 (Created by) | The member who generated the link |
| 到期 (Expires) | Expiry time |
| 访问 (Visits) | Number of visits through the link |
| 状态 (Status) | 有效 (Active) / 已过期 (Expired) / 已收回 (Revoked) / 预览已关闭 (Preview closed) |

## Extend or revoke

Active links have two actions in the row's menu:

- **延长 7 天 (Extend 7 days)**: extends the current expiry by 7 days. The expiry can't go beyond 「预览公开链接最长有效期」 (Longest validity of a public preview link) counted from now; if it would, you get an error.
- **收回 (Revoke)**: invalidates the link immediately; visitors can no longer open it.

::: tip
If a link has been passed outside by mistake, just 「收回」 (Revoke) it; there's no need to close the preview itself, and group members can still view it as usual.
:::

Generating, extending, and revoking links, as well as every visit through a public link, are written to the [audit log](/en/admin/audit) (type 「预览」 (Preview)).

## Related pages

- [Result previews](/en/user/previews)
- [Public sharing](/en/user/shares)
- [Reverse proxy and preview domains](/en/deploy/reverse-proxy)
