# Feishu

Once Feishu is connected, members can sign in with Feishu in one click, and use Bots by @-mentioning them in Feishu group chats or messaging a Bot's app directly in Feishu. This page explains what sysadmins configure on the 「飞书」 (Feishu) page, plus a configuration checklist for the Feishu developer console.

![Admin console · Feishu](/screenshots/web/admin-feishu.webp)

## Which apps you need

| App | How many | Where it's bound | Purpose |
| --- | --- | --- | --- |
| Main app (「主应用」) | 1 for the whole system | Admin console · Feishu | Feishu sign-in; syncing messages members send to Bots in Gonggong over to Feishu; listing bindable Feishu chats and syncing chat members |
| Bot app (「Bot 应用」) | 1 per Bot | 「飞书应用」 (Feishu app) in Bot settings (Bot owner or sysadmin) | Receives messages that @-mention it in Feishu chats and direct messages in Feishu; replies, run cards, and question/approval cards are sent under its own identity |

All of them must be **custom apps** (企业自建应用) of your organization, and each app can be bound either as the main app or to one Bot. Without a main app, the Feishu integration is unavailable as a whole: the login page shows no Feishu button, and Feishu chats can't be bound in group settings.

## What's on the page

The 「飞书」 page has three sections:

- **主应用 · 凭证 (Main app · Credentials)**: bind, replace, or 「移除主应用」 (Remove main app), and see the connection status (连接中 (Connecting) / 已连接 (Connected) / 连接失败 (Connection failed)).
- **对外地址 (Public URL)**: the address browsers use to reach Gonggong, e.g. `https://gonggong.example.com`; click 「保存」 (Save) to apply. Links in Feishu cards and the Feishu sign-in callback are based on it. Once it's filled in, the 「重定向 URL」 (Redirect URL) to add in the Feishu console is shown below.
- **账号 · 飞书自动开户 (Account · Feishu auto sign-up)**: see [Accounts](#accounts) below.

We recommend filling in the public URL before binding apps.

## Bind an app

The main app is bound on this page and Bot apps under 「飞书应用」 (Feishu app) in Bot settings; the steps are the same. Both methods below have the same result, and you can bind either a new app or an app that already exists in the Feishu developer console.

### Option 1: create or bind by scanning (recommended)

1. Click 「扫码创建或绑定」 (Create or bind by scanning) and scan with Feishu (or click 「在飞书中打开」 (Open in Feishu)). The QR code has a countdown; when it expires, click 「重新生成」 (Regenerate).
2. On the Feishu confirmation page, choose **create a new app** or **select an existing app**, and confirm the permissions, events, and callbacks that Gonggong prefilled.
3. After you confirm, Gonggong saves the credentials, establishes a long connection, and completes the developer configuration automatically: it sets events and callbacks to long-connection mode and adds the redirect URL to the main app.

If a bound app lacks permissions (for example, a Gonggong upgrade needs new ones), click 「更新权限」 (Update permissions) and scan again to fill them in.

### Option 2: enter credentials manually

1. Open the app in the [Feishu developer console](https://open.feishu.cn/app) and copy the App ID and App Secret from 「凭证与基础信息」 (Credentials & Basic Info).
2. Enter them under 「或手动填写已有应用的凭证」 (or enter an existing app's credentials) and click 「绑定」 (Bind). Gonggong first verifies the credentials with Feishu, then establishes a long connection, then tries to complete the developer configuration automatically. When replacing credentials, leave App Secret empty to keep it unchanged.
3. If automatic configuration fails, it's usually because the app doesn't have the `application:application:patch` permission yet, or new permissions haven't been approved. Pick one of these:
   - Click 「更新权限」 (Update permissions) and scan to add all permissions, events, and callbacks at once (recommended);
   - Or configure them manually in the Feishu developer console using the checklist below, then click 「重试自动配置」 (Retry setup).

When automatic configuration fails, Gonggong retries once a minute, so it completes on its own once a Feishu admin approves.

「移除」 (Remove) only disconnects Gonggong's long connection to that app; the app itself in the Feishu developer console is unaffected.

## Feishu developer console checklist

Scanning fills in all of these automatically. When configuring manually or troubleshooting, check each item.

### App capabilities

Both the main app and Bot apps must enable **Bot** (机器人) under 「添加应用能力」 (Add app capabilities).

### Permissions

Enable these under 「权限管理」 (Permissions & Scopes):

| App | Identity | Permissions |
| --- | --- | --- |
| Main app | App identity | `im:message:send_as_bot`, `im:chat:readonly`, `im:chat.members:write_only`, `im:chat:create`, `im:resource`, `im:message.reactions:write_only`, `cardkit:card:write`, `application:application:patch` |
| Main app | User identity | `offline_access`, `contact:user.email:readonly`, `contact:user.employee_id:readonly`, `im:message`, `im:message.send_as_user`, `im:message.group_msg:get_as_user` |
| Bot app | App identity | `im:message.group_at_msg:readonly`, `im:message.p2p_msg:readonly`, `im:message:send_as_bot`, `im:message:readonly`, `im:chat:readonly`, `im:resource`, `im:message.reactions:write_only`, `cardkit:card:write`, `application:application:patch` |

### Events and callbacks

Bind the app in Gonggong first and make sure its status is 「已连接」 (Connected) before configuring these. Feishu requires the app to be connected when you save long-connection mode.

- **Bot apps**:
  - 「事件与回调 · 事件配置」 (Events & Callbacks · Event configuration): choose **receive events through a long connection**, and add `im.message.receive_v1` (message received) and `im.message.recalled_v1` (message recalled).
  - 「事件与回调 · 回调配置」 (Events & Callbacks · Callback configuration): choose **receive callbacks through a long connection**, and add `card.action.trigger` (card action).
- **The main app** subscribes only to events (long connection), no callbacks:
  - `im.message.receive_v1`, `im.message.recalled_v1`: receive messages from the Feishu chat when 「同步全部飞书消息」 (Sync all Feishu messages) is on in group settings.
  - `im.chat.member.user.added_v1`, `im.chat.member.user.deleted_v1`, `im.chat.member.user.withdrawn_v1`: users joining or leaving the Feishu chat, used to sync group members.
  - `im.chat.member.bot.added_v1`: when the main app is added to a Feishu chat that isn't bound yet, it posts a 「在共工创建对应群」 (Create the group in Gonggong) card there.

Gonggong receives events over a long connection, so the server doesn't need a public callback address.

### Redirect URL (main app only)

Under 「安全设置 · 重定向 URL」 (Security Settings · Redirect URLs), add `<public URL>/api/auth/feishu/callback`. Once the public URL is filled in, the 「飞书」 page shows this address directly.

### Publish a version

After changing permissions or capabilities, create and publish a version under 「版本管理与发布」 (Version Management & Release). Changes take effect only after your organization's Feishu admin approves.

## Accounts

「飞书自动开户」 (Feishu auto sign-up) is on by default: members of your organization can create a Gonggong account directly the first time they sign in with Feishu, regardless of 「开放自助注册」 (Allow self sign-up). When off, they can only link an existing account or register through an invite. Members can also link or unlink their Feishu account in their personal settings.

## Using Bots in Feishu chats

Binding a Feishu chat is done by a group admin in Gonggong under 「群设置 · 飞书」 (Group settings · Feishu):

1. Add the main app to the Feishu chat.
2. In 「群设置 · 飞书」, select that Feishu chat and click 「绑定」 (Bind). (Only Feishu chats that both the main app and you are in, and that aren't bound yet, are listed.) A Gonggong group can be bound to only one Feishu chat.
   - If there's no Feishu chat yet, click 「创建飞书群」 (Create Feishu chat): it creates a Feishu chat with this group's name and binds it automatically, with you as the owner, and adds members who have linked Feishu accounts and Bots that have Feishu apps.
   - You can also start from the Feishu chat: when you click 「新建群」 (New group) in Gonggong, choose to create from a Feishu chat, which creates the group, binds it, and adds people in one step. When the main app has just been added to an unbound Feishu chat, it posts a 「在共工创建对应群」 (Create the group in Gonggong) card there; open it to start creating the group (the public URL must be filled in first).
3. The list shows each Bot's status in the chat. For Bots not yet in the chat, click 「拉入飞书群」 (Add to chat); Bots showing 「未绑定飞书应用」 (No Feishu app) need their Bot app bound first.
4. After that, members can trigger runs by @-mentioning the Bot in the Feishu chat. Members must have signed in to Gonggong with Feishu once (or linked Feishu in personal settings), and must be members of the corresponding Gonggong group.

Once bound, a few more switches are available: 「网页消息同步到飞书群」 (Sync web messages to the Feishu chat), 「同步全部飞书消息」 (Sync all Feishu messages), plus 「同步飞书群成员」 (Sync Feishu chat members) and 「改为飞书群名」 (Use Feishu chat name).

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Status is 「连接失败」 (Connection failed) | Check whether the App Secret was reset, and whether the server can reach `open.feishu.cn` |
| Says the public URL isn't set | Fill in the public URL on the 「飞书」 page first, then click 「重试自动配置」 (Retry setup) |
| @-mentioning a Bot in a Feishu chat does nothing | Check that the Bot app is 「已连接」 (Connected) and in the chat, that `im.message.receive_v1` is subscribed via long connection, and that the version has been published |
| Card buttons don't respond | Check that the Bot app's `card.action.trigger` callback is configured via long connection |
| Redirect error after Feishu sign-in | Check that the redirect URL matches the public URL |

## Related pages

- [System parameters](/en/admin/params)
- [Groups and direct chats](/en/user/groups)
- [Bot settings and permissions](/en/user/bot-settings)
