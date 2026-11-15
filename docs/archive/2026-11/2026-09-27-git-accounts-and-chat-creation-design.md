# Git 账号、仓库选择器与新建群/私聊重构 设计

日期：2026-09-27 · 状态：待评审 · 前置：`2026-09-27-repo-binding-design.md`（多仓库绑定、访问预检、仓库历史库）

## 背景

上一版把 GitHub / GitLab 只当作「URL 格式」来支持，明确不接 API。落地后暴露三个问题：

1. **找仓库不方便**：搜索只能搜「团队用过的」，自己有权限但没人用过的仓库只能手动粘贴地址。
2. **配置入口散乱**：Git 相关的操作散在 6 处——新建弹窗、群设置·基本信息、群设置·成员与 Bot、聊天横幅、Bot 管理页、头像菜单。个人配置只有头像菜单里的一组选项。
3. **工作区改不了**：Bot 在群里的工作区只在异常横幅（未绑定 / 暂停）和 `/cd` 命令中可改。群设置的 Bot 管理看不到、也改不了。服务端 `PUT /api/groups/:id/bots/:botId/workspace` 其实随时可以调用。

另外，新建群/私聊弹窗是一个长长的平铺表单：先填仓库后选 Bot，但访问检查依赖 Bot；有一块静态的「同步模式」说明；到处是灰色说明字；群/私聊既由入口决定，又在弹窗里用 Tab 再切一次。

数据模型本身不变：**群 1:1 仓库（url + 分支）**，**Bot × 群 → 工作区（托管克隆 / 本机目录）**。本次只补「账号」这一层，并把入口理顺。

## 目标

1. 个人可以连接 GitHub / GitLab（含私服、GitHub 企业版）账号，选仓库时直接搜索自己有权限的仓库和分支。
2. 新增「设置」窗口作为个人中心，收纳 Git 账号、协议偏好、外观和密码。
3. 新建群/私聊改为单页分组表单：先选 Bot 再选仓库，访问检查自动运行，结果标在 Bot 行上。
4. 群设置新增「仓库与工作区」页：换仓库，以及 Bot 主人随时更改自己 Bot 在本群的工作区。
5. 界面遵循 macOS 27 系统组件规范（HIG 与系统 App 行为），`docs/design/pane` 仅作次要参考。

## 非目标

- 不做 OAuth，只用个人访问令牌（PAT）。
- 账号**不与群绑定**。Token 只用于列出和搜索仓库、分支，不用于 clone，也不给服务端 mirror 用。
- 不做组织级（团队共享）账号，不做 Token 过期提醒。
- 不改「一群一仓库」，不支持已绑定的群解绑，不改 daemon 协议。
- 不改同步模式、群级参数页。

## 已拍板的决策

| # | 决策 |
|---|---|
| E1 | 接 GitHub / GitLab API，用于仓库发现 |
| E2 | 个人中心是一个带侧栏的「设置」窗口，头像菜单瘦身 |
| E3 | 新建群/私聊用单页分组表单，仓库通过弹出面板选择 |
| E4 | 群设置新增独立的「仓库与工作区」页 |
| E5 | 连接方式为 PAT；不预留 OAuth 字段 |
| E6 | 选仓库时用**当前操作人**自己的账号；群里只存 `url + 分支`；clone 和访问检查仍然用各 Bot 所在机器的凭据 |

## 1. Git 账号

### 数据

```text
git_accounts  id, user_id → users, provider ('github' | 'gitlab'), base_url, login,
              token (seal() 加密), status ('ok' | 'invalid'), created_at
              unique (user_id, base_url, login)
```

- `base_url` 规范化：去掉末尾 `/`。GitHub 默认 `https://github.com`，企业版填实例地址。
- `token` 用 `apps/server/src/lib/seal.ts` 的 `seal()` / `open()` 加解密，永远不下发给前端。
- provider API 返回 401 时，把账号 `status` 置为 `invalid`；设置页提示「需要重新连接」，不自动删除。

### 协议（`packages/protocol/src/web.ts`）

```ts
GitAccountDto   = { id, provider, baseUrl, login, status }
AddGitAccountReq = { provider, baseUrl, token }           // baseUrl 可省略，GitHub 默认 github.com
ProviderRepoDto = { fullName, url, defaultBranch, private }
```

### 接口（`apps/server/src/modules/git-accounts/`）

| 接口 | 说明 |
|---|---|
| `GET /api/me/git-accounts` | 我的账号列表 |
| `POST /api/me/git-accounts` | 先调 provider 的「当前用户」接口验证 Token，取 `login`。失败返回可读原因：Token 无效、网络、证书。同一 `(baseUrl, login)` 重复添加时，覆盖 Token 并把状态恢复为 `ok` |
| `DELETE /api/me/git-accounts/:id` | 删除（仅本人） |
| `GET /api/git-accounts/:id/repos?q=` | 仅本人可调。代理 provider 的仓库列表或搜索，统一返回 `ProviderRepoDto[]`，最多 30 条，按最近活跃排序 |
| `GET /api/git-accounts/:id/branches?repo=<fullName>&q=` | 仅本人可调。返回分支名列表，最多 200 条 |

- **provider 适配**放在 `providers.ts`，每个 provider 实现 `me()`、`repos(q)`、`branches(repo, q)`。
  - GitLab 有服务端搜索（按成员身份过滤）。
  - GitHub 如果没有「在我可访问的仓库中搜索」的接口，就先分页列出后在本地过滤，每个账号在内存里缓存 5 分钟。
  - **具体端点、参数、分页方式、所需 Token 权限，实现前必须查官方文档核实**（CLAUDE.md 规则），不凭记忆写。
- 选中仓库后存哪种 URL：按用户的 `gitProtocol` 决定。`https` 存 https 克隆地址，`auto` / `ssh` 存 ssh 地址。daemon 本来就会在 ssh 和 https 之间自动回退，repoKey 两种写法一致。
- provider 请求超时 10 秒；自签证书按网络错误处理，提示检查实例地址或证书。服务端不做 `sslVerify` 开关。

## 2. 设置窗口（个人中心）

`apps/web/src/features/settings/SettingsDialog.tsx`：布局沿用 `GroupSettingsDialog` 的「左侧侧栏 + 右侧分组表单」，与群设置视觉一致。

| 页 | 内容 |
|---|---|
| 外观 | 主题（浅色 / 深色 / 跟随系统）、玻璃效果（清透 / 标准 / 着色） |
| Git 与仓库 | 「已连接的账号」分组：每行 provider 图标 · 实例 · `login` · 状态 ·「断开」；末行「添加账号…」。「克隆」分组：协议偏好（按仓库地址 / 优先 SSH / 优先 HTTPS） |
| 账户 | 修改密码（复用 `ChangePasswordDialog` 的表单） |

- **添加账号**：弹出小 Sheet，内容依次为：类型分段控件（GitHub / GitLab）→ 实例地址（GitHub 预填 `https://github.com`，GitLab 必填）→ Token（密码框）→ 一行说明（需要哪个只读权限，附创建 Token 的页面链接）→「连接」。连接中按钮显示「验证中…」；失败时在表单内显示原因，不关闭 Sheet。
- **头像菜单**瘦身为：身份头部 ／ 绑定新机器、我的用量 ／ **设置…** ／ 退出登录。主题、玻璃、Git 协议、修改密码都移入设置窗口。
- 设置窗口可以从外部指定打开的页（`page` 参数），仓库选择器里的「连接账号…」直接打开到「Git 与仓库」。

## 3. 仓库选择器 `RepoPicker`

替换 `apps/web/src/features/chat/RepoFields.tsx`，新建群/私聊和群设置共用。

### 表单内（两行 GroupRow）

- **仓库**：右侧显示 provider 图标 + `owner/name`（悬浮提示完整 URL）+ 下拉指示，点开弹出选择面板。未选时显示「不绑定 · 各 Bot 使用本机目录」。
- **基准分支**：可输入的下拉（ComboBox），只在已选仓库时出现。选项来源：选的是账号仓库，用 `branches` 接口；否则用访问检查返回的 `branches`。默认填仓库的 `defaultBranch`。

### 选择面板（Popover，宽 360）

1. 顶部是来源分段控件：`最近` + 每个已连接的账号（GitHub 显示「GitHub」，其他显示实例 host）。默认选中上次用过的来源（存 localStorage，读不到就用「最近」）。`invalid` 状态的账号不出现在分段控件中。
2. 搜索框（SearchField）：输入防抖 200ms 后请求当前来源。输入内容匹配 `REPO_URL` 时，列表首行显示「使用地址 `<输入内容>`」，不受来源限制。
3. 列表：图标 · `owner/name` · 右侧附加信息。
   - 「最近」：沿用现有 `GET /api/repos?q=`，附加信息为「N 个群在用 · 分支 · 本机已有」。
   - 账号来源：附加信息为默认分支，私有仓库带锁形图标。
   - 支持方向键上下选择、回车确认。
4. 底部：
   - 没有已连接账号时显示「连接 GitHub / GitLab 账号…」，打开设置窗口的「Git 与仓库」页。
   - 仅新建时：已选仓库后底部出现「不绑定仓库」，用于清空选择。群设置中没有这一项，因为服务端规定已绑定的群不能解绑（`PATCH /api/groups/:id/repo`，P1 规则），本次不改。
5. 空态与错误：
   - 列表为空时显示「没有匹配的仓库」。
   - 账号请求失败时，在列表位置显示原因和「重试」。遇到 401 时提示「Token 已失效，去设置重新连接」。

### 访问检查（自动）

- 触发条件：仓库、分支、Bot 集合任一变化，防抖 400ms 后调用 `/api/repos/probe`，沿用现有请求体。结果回来时如果输入已经又变了，丢弃结果（沿用 `edits` 计数）。
- 去掉「检查访问」按钮。只有请求本身失败时，才在仓库行下方显示错误和「重新检查」。
- 未选 Bot 时，沿用现有逻辑：用调用者自己的在线 Bot 做检查，只为拿到分支列表。
- 分支自动回退：沿用现有逻辑。分支框没被用户动过、而填写的分支不存在时，自动改为 `defaultBranch` 再检查一次。
- `RepoPicker` 通过 props 输出 `{ url, branch, check }`，**不负责渲染逐个 Bot 的结果**；结果由调用方标在各自的 Bot 行上（见 §4、§5）。仓库行下方只显示汇总，如「2 个 Bot 可访问 · 1 个进群后暂停」。
- 提交拦截规则不变：
  - 任一 Bot 返回 `branch_missing` 时禁止提交；
  - 检查进行中时禁止提交，按钮显示「检查中…」；
  - 离线 Bot 不阻塞；
  - 没有可检查的 Bot 时，只校验地址格式。

`RESULT` 文案表、`protocolOf` 等工具函数迁移到 `repo-access.ts`，供 Bot 行复用。

## 4. 新建群/私聊弹窗

`NewGroupDialog` 重写，仍用 `Dialog`（页面没有可以承载 Sheet 的窗口），宽 520。

- **标题**：「新建群」或「新建私聊」，由入口决定（工具栏「新建群」、侧栏「新建私聊」）。**去掉弹窗内的群/私聊切换 Tab 和副标题**。
- **表单**（自上而下，分组表单样式，每组一个 GroupBox，组标题为小号灰字）：
  1. **名称**：单行输入。名称为空时，选中仓库会自动把仓库名填进来；用户手动编辑过就不再覆盖。
  2. **Bot · N**：每行显示头像 · 名称 · 「Agent 类型 · 主人」 · 右侧状态（访问检查结果，或在线状态）· 移除按钮 ⊖。末行「添加 Bot…」弹出 Popover，内容是可多选的 Bot 列表，带在线状态，未绑定机器的 Bot 禁用并注明原因。私聊只列出我自己的 Bot。
  3. **成员 · N**（仅群聊）：一行标签（token），包括我（群管理员，不可移除）、自动加入的 Bot 主人（不可移除）、手动添加的成员（可 ✕ 移除），末尾「＋」弹出可搜索的用户列表。
  4. **仓库**：`RepoPicker` 的两行。
- **Bot 行的访问检查结果**：
  - ✓ 可访问 · SSH/HTTPS
  - ⚠ 无权限 / 网络或证书 / 超时 · 进群后暂停
  - ✗ 分支不存在
  - ☾ 离线 · 上线后验证
  
  没有检查结果时显示在线状态。
- **底部**：左侧显示一句状态说明，只在需要时出现，如「1 个 Bot 进群后暂停，主人配置凭据后可重新检查」或「分支 x 不存在」；右侧为「取消」「创建」。「创建」禁用的条件：名称为空、检查中、`branch_missing`。
- **删除的内容**：同步模式说明块、所有长段说明（「每个群绑定一个仓库…」「Bot 的主人会自动成为群成员…」等）。必要的信息压缩进组标题，如「成员 · 3（Bot 主人自动加入）」，或放进 Bot 行的 tooltip。
- 提交接口 `POST /api/groups` 请求体不变。

## 5. 群设置：「仓库与工作区」

新增共享组件 `RepoWorkspaceView({ group, isAdmin })`，用在两处：

- `GroupSettingsDialog` 新增页签 `repo`「仓库与工作区」，位于「成员与 Bot」之后。「基本信息」页去掉远端仓库、基准分支两行，以及「每个群绑定一个仓库」提示和 `RepoFields`。
- 群信息侧栏（`GroupInfo`）新增视图 `repo`。入口是第一组设置里新增的一行「仓库与工作区」，**所有成员可见**，这样非管理员的 Bot 主人也能改自己 Bot 的工作区。原「群管理」组中「仓库与基准分支」一行改为打开设置窗口的 `repo` 页签。

### 内容

1. **仓库** GroupBox：
   - 显示仓库（图标 · `owner/name` · 完整 URL 以 tooltip 显示）和基准分支。
   - 管理员可以点「更换…」：原位展开 `RepoPicker`，Bot 集合为群内现有 Bot，检查结果标在下方的 Bot 行上。底部出现「取消」和「更换仓库」，确认时提示「各 Bot 的托管工作区将重建」。
   - 非管理员只读。
2. **各 Bot 的工作区** GroupBox，每个 Bot 一行：
   - 头像 · 名称（别人的 Bot 附主人名）· 副标题为工作区描述：
     - `managed + ready`：「托管克隆 · 就绪」
     - `cd`：显示本机路径（等宽字体，中间截断）
     - `cloning` / `pending`：「克隆中… / 等待上线」
     - `unbound`：「未选择工作区」
     - 暂停：「已暂停 · 原因」
   - 右侧按钮：
     - 我的 Bot：「更改…」，打开工作区选择器（见下）。
     - 暂停且我是主人或管理员：「重新检查」（沿用 `recheck` 接口）。
     - 其他情况不显示按钮。
   - 处于更换仓库流程时，行右侧改为显示访问检查结果。

### 工作区选择器

从 `WorkspaceBanner` 中抽出 `WorkspacePicker`（`features/workspaces/`），横幅和本页共用。它包装 `DirPicker`，顶部是快捷选项：

- 使用本机已有的仓库目录（免 clone）——来自 `/groups/:id/local-paths`，只显示当前机器的目录
- 托管克隆群仓库（推荐）——仅限已绑定仓库的群
- 使用默认工作区
- 或选择机器上已有的目录

提交仍然调用 `PUT /api/groups/:id/bots/:botId/workspace`，`path = null` 表示托管克隆。Bot 离线时按钮禁用，tooltip 提示「离线，上线后可更改」。服务端不改。

## 6. 边缘场景

1. Token 失效：设置页该账号标为「需要重新连接」；仓库面板里该来源消失；已绑定的群不受影响。
2. 同一个人连了两个指向同一实例的账号：分段控件显示「host · login」加以区分。
3. 从账号选了仓库，但某 Bot 机器无权访问：与现在一致，Bot 进群后暂停，由主人去配置凭据。
4. 粘贴的地址带凭据（`https://user:token@…`）：仍然按原样存储；历史库去掉凭据。与上一版一致。
5. 私服 GitLab 用自签证书：连接账号时报「网络或证书」，服务端不提供跳过校验的选项。
6. 更改工作区时 Bot 正在运行：沿用 `/cd` 的现有行为，服务端不加新拦截。
7. 私聊的「仓库与工作区」页：与群一致，只是所有 Bot 都是我的。
8. 头像菜单瘦身后，E2E 和测试中通过菜单切换主题 / 协议的用例，要改为通过设置窗口操作。

## 7. 测试

- **服务端集成**（`createTestDb`）：
  - 账号增删查；Token 加密落库，响应里不含 Token；验证失败返回可读原因；401 时置为 `invalid`；只能访问自己的账号。
  - provider 适配：用本地 HTTP stub 伪造 GitHub / GitLab 的响应，覆盖列表、搜索、分支、分页截断、超时。测试中 provider 的 base URL 指向 stub。
  - 协议偏好决定存 ssh 还是 https 的 URL。
- **Web**（vitest + testing-library）：
  - `RepoPicker`：来源切换、粘贴地址首行、选中后分支默认值、输入改变后丢弃旧检查结果、无账号时出现「连接」入口。
  - 新建弹窗：先选 Bot 再选仓库后，检查结果标在 Bot 行；「创建」按钮的三种禁用状态；私聊只列出我的 Bot；名称自动填入。
  - 设置窗口：添加账号流程；协议偏好调用 `PATCH /me`。
  - `RepoWorkspaceView`：我的 Bot 有「更改…」、别人的没有；管理员能更换仓库、非管理员只读；暂停行有「重新检查」。
- **E2E**：新建群并通过「最近」选择仓库，检查通过后创建；在「仓库与工作区」把自己的 Bot 从托管克隆改为本机目录，时间线出现 cd 事件。provider API 不进 E2E（依赖外网）。

## 8. 开发切片

1. **协议与账号后端**：`git_accounts` 表 + 迁移、DTO、增删查接口、seal 加密、provider 适配（先查文档）、repos / branches 代理。
2. **设置窗口**：`SettingsDialog`（外观 / Git 与仓库 / 账户）、添加账号 Sheet、头像菜单瘦身、修正受影响的测试。
3. **RepoPicker**：选择面板、账号来源、自动访问检查、`repo-access.ts`；群设置的换仓库先接入新组件。
4. **新建群/私聊重写**：分组表单、Bot / 成员 Popover、检查结果进 Bot 行、删除旧样式（`chat.css` 中的 `.ng-*`）。
5. **仓库与工作区**：抽取 `WorkspacePicker`、`RepoWorkspaceView`、设置窗口新页签、`GroupInfo` 新视图、从基本信息页移除仓库行。
6. **E2E 与收尾**：更新 E2E，全量回归，typecheck，lint。
