# Feishu

With Feishu connected, members can sign in with Feishu and @ Bots in Feishu chats. Only messages sent to Bots and the Bots' replies sync between Gonggong and Feishu; ordinary chat does not.

![Admin console · Feishu](/screenshots/web/admin-feishu.webp)

## Which apps you need

| App | How many | Where to bind it | Purpose |
| --- | --- | --- | --- |
| Main app | 1 per system | Admin console · 飞书 (Feishu) | Feishu sign-in; mirrors members' messages to Bots into Feishu; lists the Feishu chats you can bind |
| Bot app | 1 per Bot | 「飞书应用」 (Feishu app) in Bot details (the Bot's owner or a sysadmin) | Receives messages that @ it in Feishu chats, and replies, posts run cards and question/approval cards as itself |

Both must be **custom apps** (企业自建应用) of your Feishu tenant, and an app can be bound to only the main app or one Bot. Without a main app, the Feishu integration is unavailable and the sign-in page shows no Feishu button.

Fill in 「对外地址」 (Public URL) first — the address browsers use to reach Gonggong, such as `https://gonggong.example.com`. Links in Feishu cards and the Feishu sign-in callback are based on it.

## Bind an app

Both methods work for a new app or an app that already exists in the Feishu developer console.

### Method 1: Create or bind by scanning (recommended)

1. Click 「扫码创建或绑定」 (Create or bind by scanning) and scan the QR code with Feishu.
2. On Feishu's confirm page, choose to **create a new app** or **pick an existing app**, and confirm the scopes, events and callbacks Gonggong pre-filled.
3. Gonggong then saves the credentials, opens the long connection and finishes the dev config: long-connection mode for a Bot app's events and callbacks, and the redirect URL for the main app.

If a bound app lacks scopes (for example after an upgrade needs new ones), click 「更新权限」 (Update permissions) and scan again to add them.

### Method 2: Enter the credentials

1. In the [Feishu developer console](https://open.feishu.cn/app), open the app and copy the App ID and App Secret under 「凭证与基础信息」 (Credentials & Basic Info).
2. Enter them in Gonggong and click 「绑定」 (Bind). Gonggong verifies them with Feishu, opens the long connection, then tries to finish the dev config.
3. If 「自动配置失败」 (Setup failed) appears, the app usually lacks the `application:application:patch` scope, or its new scopes are not approved yet. Either:
   - click 「更新权限」 and scan to add every scope, event and callback at once (recommended); or
   - set things up by hand with the checklist below, then click 「重试自动配置」 (Retry setup).

While setup is pending, Gonggong retries once a minute, so it completes once a Feishu admin approves the app.

## Feishu developer console checklist

Scanning fills all of these in. Check them one by one when setting up by hand or troubleshooting.

### Capability

Enable **Bot** (机器人) under 「添加应用能力」 (Add capabilities) for both the main app and Bot apps.

### Scopes

Enable under 「权限管理」 (Permissions):

| App | Identity | Scopes |
| --- | --- | --- |
| Main app | Tenant | `im:message:send_as_bot`, `im:chat:readonly`, `im:chat.members:write_only`, `im:resource`, `im:message.reactions:write_only`, `cardkit:card:write`, `application:application:patch` |
| Main app | User | `offline_access`, `contact:user.email:readonly`, `im:message`, `im:message.send_as_user`, `im:message.group_msg:get_as_user` |
| Bot app | Tenant | `im:message.group_at_msg:readonly`, `im:message:send_as_bot`, `im:message:readonly`, `im:chat:readonly`, `im:resource`, `im:message.reactions:write_only`, `cardkit:card:write`, `application:application:patch` |

### Events and callbacks (Bot apps only)

Bind the app in Gonggong first and wait for 「已连接」 (Connected): Feishu only saves long-connection mode while the app is connected.

- 「事件与回调 · 事件配置」 (Events & Callbacks · Events): choose **receive events through a long connection**, and add `im.message.receive_v1` (message received) and `im.message.recalled_v1` (message recalled).
- 「事件与回调 · 回调配置」 (Events & Callbacks · Callbacks): choose **receive callbacks through a long connection**, and add `card.action.trigger` (card action).

Gonggong receives events over the long connection, so the server needs no public callback URL.

### Redirect URL (main app only)

Add `<public URL>/api/auth/feishu/callback` under 「安全设置 · 重定向 URL」 (Security · Redirect URLs). Once the public URL is set, the admin console's Feishu page shows this exact address.

### Publish a version

After changing scopes or capabilities, create and publish a version under 「版本管理与发布」 (Version Management & Release). Changes take effect once your tenant's Feishu admin approves it.

## Accounts

「飞书自动开户」 (Feishu auto sign-up) is on by default: members of your Feishu tenant can create a Gonggong account on their first Feishu sign-in, regardless of 「开放自助注册」 (Open self-registration). When off, they can only bind an existing account or register with an invitation.

## Use Bots in a Feishu chat

1. Add the main app to the Feishu chat.
2. A group admin picks that chat under 「群设置 · 飞书」 (Group settings · Feishu) in Gonggong and binds it. A Gonggong group binds to one Feishu chat.
3. The list shows each Bot of the group. Click 「拉入飞书群」 (Add to chat) for Bots not in the chat yet; a Bot marked 「未绑定飞书应用」 (No Feishu app) needs its Bot app bound first.
4. Members can then @ Bots in the Feishu chat to start runs. They must have signed in to Gonggong with Feishu (or bound Feishu in their settings) and be members of the Gonggong group.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Status is 「连接失败」 (Connection failed) | Check whether the App Secret was reset and whether the server can reach `open.feishu.cn` |
| 「未设置对外地址」 (Public URL not set) | Fill in the public URL on this page, then click 「重试自动配置」 |
| @ a Bot in Feishu and nothing happens | Check that the Bot app is 「已连接」, is in the chat, subscribes to `im.message.receive_v1` over the long connection, and its version is published |
| Card buttons do nothing | Check that the `card.action.trigger` callback uses the long connection |
| Redirect error after Feishu sign-in | Check that the redirect URL matches the public URL |
