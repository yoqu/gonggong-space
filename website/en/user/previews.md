# Previews

This page covers how a Bot publishes finished web pages, services, and static pages as previews, how group members view and interact with them right in the browser, and how to use the workbench on the right. For the prototypes and slide decks a Bot generates, see [Prototypes, canvas, and works](/en/user/artifacts).

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

A few notes:

- When a Bot starts a service (a managed service), it runs code, so it goes through the same approval process as the Bot running commands; see [Approvals and questions](/en/user/approvals).
- Managed services run on the Bot's machine and keep running after the turn ends. Each Bot can manage up to 5 services at a time.
- Only one preview card is kept per port.

### Web pages posted straight into the group

When you just want everyone to see what a page looks like, the Bot can skip the preview and instead put a screenshot of the page, or the whole HTML page laid out to the chat column's width, right into its reply. These pages are saved with the message and don't depend on the machine being online. Click an image inside to enlarge it in the viewer, or click 「全屏查看」 (Full screen) to see the whole page. If the page file has been cleaned up, it shows 「页面内容已不存在」 ("This page no longer exists").

## Preview cards

After the Bot publishes a preview, a preview card appears in the group showing a screenshot of the first screen, the status, and the address.

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
| 重新截图 (Retake screenshot) | Refresh the screenshot on the card | Bot owner, group admins |
| 停止穿透 / 停止穿透和服务 (Stop tunnel / Stop tunnel and service) | Close the preview, and stop the service behind it | Bot owner, group admins |
| 重新开放 (Reopen) | Reopen a closed card and restart the service | Bot owner, group admins |

::: tip Other entry points
- All open previews in the group appear as tags above the composer; click a tag to see the screenshot and actions.
- 「群设置 → 在线预览」 (Group settings → Online previews) merges the group's previews with their bound background services (pure background processes without previews appear only when present). There you can 「在工作台打开」 (Open in workbench) or 「停止」 (Stop), or use the 「···」 menu to pause a process while keeping the card or view technical details.
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

## Who can access previews

- Previews are open only to members of the group. When opened from a card or the workbench, Gonggong Space verifies your identity automatically; there's no need to sign in again.
- Sending the preview address directly to someone outside the group won't work. To show it to outsiders, the Bot owner or a group admin creates a [public link](/en/user/shares).
- Common messages: 「请从共工空间的预览卡片打开这个预览。」 ("Open this preview from its card in Gonggong Space."), 「预览不存在或已关闭。」 ("This preview doesn't exist or was closed."), 「链接已失效，请回到共工空间重新打开预览。」 ("This link has expired. Open the preview again from Gonggong Space."), 「预览所在的机器离线，稍后再试。」 ("The preview's machine is offline, try again later.").

## Idle auto-close

A preview that nobody visits for a while closes automatically. The default is **24 hours**; admins can change it with the system parameter 「预览无人访问后自动关闭」 (Close previews after no visits for); see [System parameters](/en/admin/params).

- Opening the page and retaking the screenshot both count as visits.
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
