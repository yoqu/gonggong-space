# 网页终端协议

## 边界

- 仅机器主人可使用；群成员、群管理员和系统管理员不因角色获得权限。
- daemon 启动真实 shell 并持有 PTY。网页不是命令执行接口，也不能传入 cwd。
- 终端以 `(sessionId, groupId, botId)` 定位。daemon 自己解析所选 Bot 的当前工作区；网页不发送绝对目录。
- 刷新、断线、隐藏或关闭 Tab 不结束 PTY。只有显式结束、进程退出、机器归属撤销或闲置超时才清理。
- daemon 断线期间会话保持原状态；daemon 重连时在 hello 的 `terminals` 里列出仍在运行的 shell，服务端据此对账：不在列表中的会话标记 `daemon_restart`，服务端不认识的（服务端重启过）按机器主人收养。从未附着过的会话还没有 shell，不参与对账。
- Windows 首期不暴露终端能力；macOS / Linux 通过 `terminal-v2` 能力协商。
- 服务端只保存会话元数据和短期内存重放缓冲，不保存命令全文、按键、终端输出到数据库或日志。

## 通道

复用预览隧道的 `[streamId u32 BE][type u8][payload]` framing，但使用独立的 `tunnel.terminal` target。普通预览 / 文件流保持原有语义。

`open` 为 `TerminalOpen` JSON：

```json
{
  "terminal": { "action": "create", "sessionId": "uuid", "groupId": "uuid", "botId": "uuid", "workspace": { "repo": null, "cdPath": null } },
  "cols": 80,
  "rows": 24,
  "after": 0,
  "method": "TERMINAL",
  "path": "/",
  "headers": [],
  "upgrade": true
}
```

`workspace` 只由服务端从当前数据库关系解析，不接受浏览器填写。`cdPath` 也只来自服务端保存的 `/cd` 绑定，不代表客户端可传目录。

`create` 创建新会话，`attach` 连接已有会话，`terminate` 结束会话并回一个 exit head 后 `end`——它不依赖任何已附着的流，服务端用它实现 `DELETE` 与撤销。`sessionId` 由服务端生成，`attach` 的 `after` 表示浏览器已收到的序号。`head` 成功后返回 `TerminalHead`，不是 HTTP head：

```json
{
  "sessionId": "uuid",
  "status": "running",
  "cols": 80,
  "rows": 24,
  "next": 12,
  "createdAt": "2026-10-27T08:00:00.000Z",
  "lastActiveAt": "2026-10-27T08:01:00.000Z",
  "exitCode": null,
  "reason": null
}
```

`data` 为 UTF-8 PTY 字节流；daemon 到服务端按单调递增 `seq` 传输。服务端到 daemon 的 `data` 仅为用户键盘输入；服务端永远不执行或解释它。控制 JSON 使用 `head` / `reset`：

```json
{ "sessionId": "uuid", "seq": 12, "data": "..." }
```

`head` 的 `status` 为 `running | exited | closed | daemon_restart`。`reason` 为 `user | exited | idle_timeout | revoked | daemon_restart | shutdown | error` 之一，错误详情通过现有 `TunnelReset.reason` 传递。`exitCode` 仅在 shell 退出后有值。

服务端到 daemon 的 `head` 控制：

```json
{ "op": "resize", "sessionId": "uuid", "cols": 120, "rows": 32 }
{ "op": "terminate", "sessionId": "uuid" }
{ "op": "ping", "sessionId": "uuid" }
```

daemon 到服务端的生命周期 head：

```json
{ "op": "state", "sessionId": "uuid", "state": "running", "next": 1, "exitCode": null, "reason": null }
{ "op": "exit", "sessionId": "uuid", "state": "exited", "next": 2, "exitCode": 0, "reason": "exited" }
```

`end` 表示当前网页断开输入，不是 shell EOF。网页按 Ctrl+D 时发送的是 `data` 中的 `\u0004`。`reset` 只关闭当前流；不会结束会话。显式结束只能发 `terminate`。

## 流量与恢复

- 慢的一方断开、重连恢复，任何一环都不为它阻塞或无限缓冲：
  - daemon 给每个观看者的输出队列满了就结束该流（`end`），PTY 继续运行；
  - 输入写入线程的队列满了（如向不读 stdin 的程序粘贴大段文本）就 `reset` 该流（`terminal_input_backlog`），隧道不被卡住；
  - 服务端发给浏览器时 `bufferedAmount` 超过 4 MiB 就 `reset`（`slow_client`），不暂停、不排队。
  浏览器收到 `reset` 或非 1000 关闭后按退避重连，带上已收到的最后序号 `after`。
- daemon 保留有限输出重放（默认 1 MiB、最多 4096 个序号）；服务器只保留会话索引和已结束状态，不缓存、不持久化终端内容。
- 重连从 `after + 1` 重放，随后进入实时输出。`after` 已早于保留范围时从最旧的保留输出开始；浏览器看到序号跳跃就先清屏（`ESC c`）再重绘。
- 已结束的会话再附着时服务端直接回 `{ "op": "exit", ... }` 并以 1000 关闭；`forbidden` 以 1008 关闭且浏览器不再重试；会话持续 `not_found` 时浏览器重试 5 次后放弃。
- 单机器限制 8 个活动会话，单用户限制 4 个活动会话；拒绝超额，不无限创建进程。
- 闲置默认 24 小时，由 daemon 判定并发送 `idle_timeout`。正在交互或有新输出会刷新活动时间。

## REST

- `POST /api/groups/:groupId/bots/:botId/terminals`：机器主人创建元数据，daemon 真正启动在流打开时完成。
- `GET /api/groups/:groupId/bots/:botId/terminals`：机器主人列出会话。
- `DELETE /api/terminals/:sessionId`：机器主人显式结束；经独立的 `terminate` 流，daemon 确认（10 秒超时）后才返回成功。机器撤销或 Bot 换机时服务端先在本地关闭会话，再尽力通知 daemon 终止。
- `POST /api/groups/:groupId/bots/:botId/terminal-links/resolve`：机器主人请求校验工作区相对文件路径；仅返回相对路径、行号、是否存在，不返回任意绝对目录。
- `/ws/terminals/:sessionId`：浏览器 Cookie 鉴权后由服务端通过 daemon 终端流中继字节。它不传 cwd、shell、env 或命令。

REST 请求体和 WebSocket 输入均不记录日志。浏览器 URI 只携带会话 ID，不包含 token。
