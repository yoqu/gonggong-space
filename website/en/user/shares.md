# Public sharing

This page covers how to share a Bot's published web preview, or a prototype a Bot made, with outside people who don't have an account: creating a public link, expiry, password and version locking, revoking, and access auditing.

There are two ways to share publicly:

| What to share | Entry | Characteristics |
| --- | --- | --- |
| Web preview | 「公开链接」 (Public link) on the preview card or in the workbench | Selectable expiry; one preview can have multiple links |
| Prototype (work) | 「分享」 (Share) on the work | One link per work; supports a password, version locking, and opening by QR code |

::: warning
Anyone with the link can access it without signing in. A link stops working immediately once it expires or is revoked, and visits are recorded in the audit log. Public links can't be created in demo mode.
:::

## Public links for web previews

Only the Bot owner or a group admin can create one, and only web-type previews (web / service, static page) are supported. For previews themselves, see [Previews](/en/user/previews).

1. Click 「公开链接」 (Public link) on the preview card, or 「公开链接…」 (Public link…) in the toolbar of the workbench's web tab.
2. Under 「有效期」 (Expires in), choose 1, 3, 7, or 30 days; the default is 7 days.
3. Click 「生成链接」 (Create link).
4. Click 「复制」 (Copy) and send the link to the other person.

![Share public link dialog](/screenshots/web/preview-share.webp)

::: warning
The full link is shown only once, right after it's created. You can't view it again after closing the dialog, so copy it right away.
:::

### View and revoke

Open the 「公开链接」 (Public link) dialog for the same preview; the bottom lists all public links of this preview, each row showing its status, creator, expiry time, and number of visits.

| Status | Meaning |
| --- | --- |
| 有效 (Active) | Accessible |
| 已过期 (Expired) | Past its expiry |
| 已收回 (Revoked) | Revoked manually |
| 预览已关闭 (Preview closed) | The preview has been closed, so the link doesn't work |

Click 「收回」 (Revoke) on an active link to disable it immediately. The Bot owner, group admins, and sysadmins can all revoke links.

## Share links for prototypes

Prototypes, slide decks, and other works made by a Bot can be shared as a whole; the recipient lands in the clickable prototype preview by default. For works themselves, see [Prototypes, canvas, and works](/en/user/artifacts).

1. Click 「分享」 (Share) at the top of the work's tab to open the 「分享产物」 (Share artifact) dialog.
2. Turn on 「开启分享」 (Enable sharing); the link is generated automatically. When it's off, only group members can view the work.
3. Set options as needed:

| Option | Description |
| --- | --- |
| 链接内容 (Link shows) | 「锁定 vN」 (Locked to vN): the recipient always sees this version, even if the Bot changes it later; 「始终最新」 (Always latest): what the recipient sees updates as the Bot makes changes |
| 密码访问 (Require password) | When turned on, a 4-digit password is generated automatically, and the recipient must enter it after opening the link; click 「换一个」 (New one) to regenerate it |

4. Click 「复制链接」 (Copy link); with a password set, the button is 「复制链接和密码」 (Copy link and password) and copies both.

- If you locked an older version and the work has since been updated, the dialog shows 「已有更新的 vN，对方仍看到 vM」 ("vN is out; viewers still see vM"); click 「更新到 vN」 (Update to vN).
- In the prototype preview, click 「扫码查看」 (Scan QR code) to show a QR code and open it on your phone; if sharing isn't on yet, you can use 「开启分享并生成二维码」 (Turn on sharing and show QR code) directly.
- 「分享链接」 (Share link) in the export panel can likewise 「开启并复制链接」 (Turn on and copy link) in one click.
- The link is valid for 7 days (no longer than the system parameter 「预览公开链接最长有效期」 (Longest validity of a public preview link)); the dialog shows 「链接 某日 到期」 (Link expires on some date).
- Only the Bot owner or a group admin can turn sharing on or off; others see 「只有 Bot 主人或群管理员能开关分享」 ("Only the bot owner or a group admin can turn sharing on or off").

If the recipient enters a wrong password 5 times in a row, they have to wait 10 minutes before trying again.

::: tip Sharing is not the same as visibility
「可见范围」 (Who can see it: only me / this group / team / everyone) decides which **signed-in users** can see the work in the works library; only 「开启分享」 (Enable sharing) creates a link for outside people.
:::

## Expiry

- Public links always expire; there are no permanent links.
- The maximum validity is **30 days** by default, adjustable by an admin through the system parameter 「预览公开链接最长有效期」 (Longest validity of a public preview link) — see [System parameters](/en/admin/params). Exceeding it shows 「公开链接最长有效 N 天」 ("Public links last at most N days").
- Sysadmins can 「延长 7 天」 (Extend 7 days) an active link in the admin console — see [Public links](/en/admin/shares).

## When a link stops working

A link stops working immediately when any of the following happens:

- It expires;
- It's revoked, or sharing of the prototype is turned off;
- The preview is closed (including automatic closing when idle).

After that, visitors see 「公开链接已失效或已被收回。」 ("This public link has expired or was revoked."). When the machine hosting the preview is offline, visitors see 「预览所在的机器离线，稍后再试。」 ("The preview's machine is offline, try again later.").

## Access auditing

Creating, revoking, and extending public links, as well as outside visits through a link, are all written to the audit log:

- 生成预览「X」的公开链接，有效 N 天 (Created a public link for preview "X", valid for N days)
- 收回预览「X」的公开链接 (Revoked the public link of preview "X")
- 预览「X」的公开链接有效期改到 … (Public link of preview "X" now expires at …)
- 通过公开链接访问预览「X」 (Visited preview "X" through its public link)

A visit is recorded once per entry through the link, not once per request. Sysadmins can filter by 「预览」 (Preview) in 「审计记录」 (Audit log) in the admin console — see [Audit log](/en/admin/audit); all public links site-wide are listed under [Public links](/en/admin/shares).

## Related pages

- [Previews](/en/user/previews)
- [Prototypes, canvas, and works](/en/user/artifacts)
- [Admin console · Public links](/en/admin/shares)
- [Security model](/en/deploy/security)
