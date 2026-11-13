# Previews

This page covers how a Bot publishes finished web pages, services, desktop apps, and mini programs as previews, how group members view and interact with them right in the browser, and how to use the workbench on the right. For the prototypes and slide decks a Bot generates, see [Prototypes, canvas, and works](/en/user/artifacts).

A Bot works on a member's machine, so the services it starts only listen on that machine. Previews deliver the result to group members' browsers through a tunnel between the machine and the server, so nobody needs to visit `localhost`.

## Types of preview

Previews are published by the Bot itself during a run; there's no button to create one manually. Just tell the Bot what you want to see, for example:

```text
@前端助手 把 todo-app 跑起来，发个预览给大家看看
```

(That is: "@前端助手 get todo-app running and send everyone a preview.")

| Type | Use case | Shown on the card |
| --- | --- | --- |
| Web page / service | Dev servers and API services started by the Bot (HTTP and WebSocket both work) | `:port` and path |
| Static page | HTML reports and build output in the workspace; no service needed | `:port` and path |
| Desktop app | Live view of the window of a desktop app such as Electron or Tauri | Desktop app · service name |
| Mini program | Opened in WeChat DevTools on the machine, streaming the simulator view | Mini program · page path |

A few notes:

- When a Bot starts a service (a managed service) or opens a mini program project, it runs code, so it goes through the same approval process as the Bot running commands; see [Approvals and questions](/en/user/approvals).
- Managed services run on the Bot's machine and keep running after the turn ends. Each Bot can manage up to 5 services at a time.
- Only one preview card is kept per port, per desktop app, and per mini program project. When a mini program is published again, the existing card switches to the new page.
- For desktop apps, only that app process's windows are streamed, not the whole screen.

### Web pages posted straight into the group

When you just want everyone to see what a page looks like, the Bot can skip the preview and instead put a screenshot of the page, or the whole HTML page laid out to the chat column's width, right into its reply. These pages are saved with the message and don't depend on the machine being online. Click an image inside to enlarge it in the viewer, or click 「全屏查看」 (Full screen) to see the whole page. If the page file has been cleaned up, it shows 「页面内容已不存在」 ("This page no longer exists").

## Preview cards

After the Bot publishes a preview, a preview card appears in the group showing a screenshot of the first screen (the simulator screenshot for mini programs), the status, and the address.

![Preview card in a chat](/screenshots/web/preview-card.webp)

Card status:

| Status | Meaning |
| --- | --- |
| 在线 (Online) | Ready to open |
| 离线 (Offline) | The Bot's machine is offline |
| 服务已停止 (Service stopped) | The service behind the preview has exited; the card is kept |
| 已关闭 (Closed) | The preview has been closed |

Click the screenshot to open the preview in the workbench (only while online). Buttons on the card:

| Button | What it does | Who can use it |
| --- | --- | --- |
| 打开 (Open) | Open in a new browser tab (web types) | Group members |
| 在工作台打开 (Open in workbench) | Open in the workbench on the right | Group members |
| 启动服务 (Start service) | Restart the service when it has stopped | Bot owner, group admins |
| 公开链接 (Public link) | Create a link for people outside; see [Public sharing](/en/user/shares) | Bot owner, group admins |
| 重新截图 (Retake screenshot) | Refresh the screenshot on the card (not for desktop apps) | Bot owner, group admins |
| 停止穿透 / 停止穿透和服务 / 关闭预览 / 关闭预览并停止应用 (Stop tunnel / Stop tunnel and service / Close preview / Close preview and stop the app) | Close the preview, and stop the service or app behind it | Bot owner, group admins |
| 重新开放 (Reopen) | Reopen a closed card and restart the service | Bot owner, group admins |

::: tip Other entry points
- All open previews in the group appear as tags above the composer; click a tag to see the screenshot and actions.
- 「群设置 → 预览与服务」 (Group settings → Previews & services) lists all previews and managed services in the group. There you can 「在工作台打开」 (Open in workbench) or 「关闭」 (Close) a preview, or 「停止」 (Stop) a managed service.
:::

## Preview workbench

Previews open as tabs in the workbench on the right, alongside diff, file, and other tabs.

![Preview workbench](/screenshots/web/preview-workbench.webp)

- 「布局」 (Layout) switches between 「分栏」 (Split), 「专注」 (Focus), and 「全屏」 (Full screen). Shortcuts: ⌘\ toggles between split and focus, ⌘⇧\ goes full screen.
- ⌃Tab / ⌃⇧Tab switches tabs, ⌥W closes the current tab; right-click a tab to 「关闭」 (Close), 「关闭其他标签页」 (Close other tabs), or 「关闭右侧标签页」 (Close tabs to the right).
- Up to 12 tabs can be open at once. Only the 4 most recently used web tabs stay loaded; the rest go 「休眠」 (Sleeping) and reload when you switch back.
- On a phone the workbench is full screen; tap 「返回聊天」 (Back to chat) to return to the group.

The 「新建标签页」 (New tab) menu on the tab bar can open:

| Menu item | What it does |
| --- | --- |
| 打开网页… (Open web page…) | Enter a URL (and an optional title) to open any web page in the workbench |
| 添加群标签… (Add group tab…) | Add a link, a file in a Bot's workspace, a knowledge base entry, etc. as a tab at the top of the group that all members can see and open |
| 浏览文件 (Browse files) | Files in a Bot's workspace; see [Diffs and files](/en/user/diff-files#file-viewer) |
| Git 面板 (Git panel) | A Bot's Git panel; see [Git management](/en/user/git) |
| 新建终端 (New terminal) | Open an interactive terminal in a Bot's workspace; only the machine owner can use it, and the machine must be online and running macOS or Linux; see [My machines and Bots](/en/user/machines) |

Toolbar of a web tab:

| Control | What it does |
| --- | --- |
| 刷新 (Refresh) | Reload the page |
| 进入路径 (Go to path) | Enter a path and press Enter to reload from that path; navigation within the page isn't synced here |
| 视口尺寸 (Viewport size) | Fit / 1440 / 1024 / 768 / 390, remembered per preview |
| 新窗口打开 (Open in new window) | Open in a new browser tab |
| 公开链接… (Public link…) | Create a public link (Bot owner, group admins) |

When the service stops, the tab shows 「服务已停止 · 等待 Bot 重新发布」 ("Service stopped · waiting for the Bot to republish") and reloads automatically once it's back online.

## Live view of desktop apps and mini programs

Desktop app and mini program previews open as a live view. The machine only streams while someone is watching.

![Mini program live view](/screenshots/web/workbench-miniprogram.webp)

![Desktop app live view, handling someone else's control request](/screenshots/web/workbench-live.webp)

### Remote control

All group members can watch, but only one person can control it at a time:

- Members click 「请求控制」 (Request control), and the Bot owner or a group admin clicks 「同意」 (Approve) or 「拒绝」 (Deny) on the view.
- The Bot owner or a group admin can 「开始控制」 (Take control) directly, 「接管控制」 (Take over control) when someone else is in control, or 「收回控制」 (Revoke control).
- The person in control sees 「你正在控制」 (You're in control) and clicks 「交还控制」 (Release control) when done. Stopping watching gives up control automatically.

While in control you can click, drag, scroll, and type with the keyboard (including Chinese input methods).

The toolbar lets you adjust 「帧率」 (Frame rate; auto / 90 / 60 / 30 fps) and 「画质」 (Quality; auto / original / ultra HD / HD), and can show stream stats (frame rate, resolution, bitrate, packet loss, latency, jitter).

### Platform limits

| Scenario | Limit |
| --- | --- |
| Desktop apps | macOS and Windows stream the app window; Linux can only stream apps in a virtual display, which requires the Bot to start the service in virtual-display mode |
| Mini program live view | Currently macOS and Windows only |
| macOS permissions | Streaming requires the 「屏幕录制」 (Screen recording) permission; remote control requires the 「辅助功能」 (Accessibility) permission |

When the view says 「机器未授权屏幕录制」 ("Screen recording not allowed on the machine") or 「机器未授权辅助功能，远程操作不会生效」 ("Accessibility isn't allowed on the machine, so remote input won't work"), ask the Bot owner to grant it on the 「实时画面」 (Live views) page of the Gonggong Space desktop app; see [Permissions and system settings](/en/desktop/permissions).

When the view disconnects, it shows 「N 秒后自动重试」 ("Retrying in Ns"); you can also click 「立即重试」 (Retry now).

### WeChat DevTools guidance

Mini program previews depend on WeChat DevTools on the Bot's machine. When it gets stuck at some step, guidance appears on the view saying 「请 Bot 主人在运行 Bot 的电脑上操作」 ("Ask the Bot's owner to do this on the computer running the Bot"):

| Prompt | What to do |
| --- | --- |
| 请开启微信开发者工具的服务端口 (Turn on the service port in WeChat DevTools) | Open WeChat DevTools → menu bar 「设置 → 安全设置」 (Settings → Security) → turn on 「服务端口」 (Service port) |
| 请在微信开发者工具里允许共工空间访问 (Allow Gonggong Space access in WeChat DevTools) | Switch to WeChat DevTools and click 「允许」 (Allow) in the 「Gonggong」 authorization dialog |
| 请在微信开发者工具里信任此项目 (Trust this project in WeChat DevTools) | Switch to WeChat DevTools and click 「信任并运行」 (Trust and run) in the 「您信任此项目的作者吗？」 ("Do you trust the author of this project?") dialog; if there's no dialog, check DevTools' compile output |

It continues automatically once done. The first open needs to compile, which can take from tens of seconds to a minute or two.

If DevTools isn't signed in, the card says 「微信开发者工具未登录，请用微信扫码登录」 ("WeChat DevTools is signed out. Scan with WeChat to sign in."). Only the Bot owner and group admins can see the QR code; other members see 「等待 Bot 主人登录微信开发者工具」 ("Waiting for the Bot's owner to sign in to WeChat DevTools"). After scanning, the card switches to the simulator view automatically.

## Who can access previews

- Previews are open only to members of the group. When opened from a card or the workbench, Gonggong Space verifies your identity automatically; there's no need to sign in again.
- Sending the preview address directly to someone outside the group won't work. To show it to outsiders, the Bot owner or a group admin creates a [public link](/en/user/shares).
- Common messages: 「请从共工空间的预览卡片打开这个预览。」 ("Open this preview from its card in Gonggong Space."), 「预览不存在或已关闭。」 ("This preview doesn't exist or was closed."), 「链接已失效，请回到共工空间重新打开预览。」 ("This link has expired. Open the preview again from Gonggong Space."), 「预览所在的机器离线，稍后再试。」 ("The preview's machine is offline, try again later.").

## Idle auto-close

A preview that nobody visits for a while closes automatically. The default is **24 hours**; admins can change it with the system parameter 「预览无人访问后自动关闭」 (Close previews after no visits for); see [System parameters](/en/admin/params).

- Opening the page, watching the live view, and retaking the screenshot all count as visits.
- When a preview closes and no other preview uses the same service, the service is stopped too.
- The card is kept. It comes back when the Bot restarts the service, or when the Bot owner or a group admin clicks 「重新开放」 (Reopen) on the card.

::: tip For admins
Whether preview addresses use dedicated domains or a port range is decided by the server deployment; see [Reverse proxy and preview domain](/en/deploy/reverse-proxy).
:::

## Related pages

- [Public sharing](/en/user/shares)
- [Runs](/en/user/runs)
- [Desktop app pages](/en/desktop/pages)
- [Prototypes, canvas, and works](/en/user/artifacts)
