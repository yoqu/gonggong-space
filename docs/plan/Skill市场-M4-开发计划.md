# Skill 市场 M4 审核台与申请 · 开发计划

> 依据 `Skill市场-PRD.md` §6.4、§9 M4。契约：`market.ts`（M4 段）、`web.ts` `NotificationType`、`notification-view.ts`。2026-11-04 姜维川确认开工。

## 范围

审核 diff、封禁/解封、申请引入与审批、三类站内通知、桌面端只读、M2 遗留两项。

## 数据（一个迁移）

- `plugins` 加 `ban_reason text null`。
- 新表 `install_requests`：`id, listing_id → plugins (cascade), scope (group|repo|team), scope_id uuid, pin_version_id null, note text, status (pending|approved|rejected|cancelled), requester_id → users, decided_by null → users, decision_note null, created_at, decided_at null`；部分唯一索引 `(listing_id, scope, scope_id) where status='pending'`。

## 规则

- **diff**：比较对象 = 该条目在此版本之前最近的 approved 版本（没有则全部为 added）。只返回变化的文件；utf8 文件两侧带全文，base64 文件 `binary=true` 不带内容。可看的人：维护者、该条目的审核人。
- **封禁**：审核人（team 可见 → 团队 admin；public 或平台层 → sysadmin）`POST /ban` 必填原因 → `status='banned'`、`ban_reason`；下一轮起所有作用域（含个人层）不下发，不能新装，市场不显示；`DELETE /ban` 恢复为 `listed`。封禁不发通知，详情与「我的发布」显示原因。
- **申请引入**：
  - 谁能申请：群目标 → 群成员；团队/仓库目标 → 团队成员。条目必须对申请人可见且对目标可装（同 installable 规则）。已装或已有 pending 申请 → 409。
  - 谁能审批：该目标层能直接引入的管理员（群管理员 / 团队 admin）。
  - 通过：在同一事务里执行 `putInstall`（enabled=true，pin 按申请）；冲突（同层同名）返回 409，申请保持 pending。拒绝必填原因。申请人可撤回 pending。
  - 通知：创建时给目标所有管理员发 `install_request`（payload：requestId、requesterName、listingName、targetLabel）；处理后把这些通知标为 resolved，并给申请人发 `install_request_decided`（listingName、targetLabel、approved、note）。
- **审核结果通知**：版本审核通过/驳回时给维护者发 `listing_reviewed`（listingId、listingName、revision、approved、note）。
- **M2 遗留**：
  1. 详情 `listedVersionId/listedRevision` 未审核时返回 null（契约已改）。
  2. `/api/plugins/:id/files/*`：调用方所在群/团队有该条目的安装时，按安装解析版本读取，并放行跨团队公开条目；否则保持现有规则。

## 界面

- **审核**（`ReviewList` 与详情）：版本 diff 视图（复用 `features/diff` 现有组件渲染逐文件 unified diff；binary 文件只显示「二进制文件已变化」）。审核人在详情里有「封禁」「解封」，封禁要填原因；已封禁条目显示原因。
- **引入弹窗**：除管理员目标外，列出我是成员但不是管理员的群、团队、仓库，按钮变为「申请引入」（可填说明）。
- **市场页新增「引入申请」tab**（`/market?tab=requests`，通知跳转用）：「待我处理」（通过 / 拒绝必填原因）与「我的申请」（状态、结果说明、撤回）。`?tab=mine` 打开「我的发布」。
- **通知中心**：三类新通知的图标与颜色（`NotificationPanel`）。
- **桌面端**（D14，只读）：新增「Skill」页：我的个人 Skill 列表（`GET /api/me/installs`）与市场列表（`GET /api/market`，只读卡片），每项和页头都有「在网页中打开」跳 web 的 `/market`。不提供引入、发布、审核。看 desktop 现有页面如何调服务端与打开网页。

## 分工

| 切片 | 范围 |
|---|---|
| S 服务端 | 迁移、diff、封禁、申请引入全套、三类通知、详情 null、插件文件权限、测试 |
| W 前端 | diff 视图、封禁、引入弹窗申请、引入申请 tab、通知图标、M2 遗留的类型修正、测试 |
| D 桌面 | 只读 Skill 页、测试 |
