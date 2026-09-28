# 多 Git 仓库绑定、访问预检与仓库历史库 设计

日期：2026-09-27 · 状态：已实现（未提交）

## 目标

1. 群 / 私聊（DM）绑定仓库时，GitLab 私服（含子组、自定义 SSH 端口、`http://`、自签证书）与 GitHub 公有仓库走同一套流程。
2. 群里每个 Bot 用**自己机器的凭据**验证能否访问仓库；无法访问的 Bot 不被调度，但不阻塞绑定。
3. 用过的仓库（群绑定、/cd 目录、默认工作区）沉淀为**团队共享的仓库历史库**，绑定时可搜索选择；并记住各机器上已有的本地目录，提示直接 /cd。

## 非目标

- 不接 GitHub / GitLab API，不做人类成员 OAuth 权限校验。
- 不做 Host 白名单、服务端凭据管理。团队内部使用，安全从简。
- 不改「一群一仓库」。

## 已拍板的决策

| # | 决策 |
|---|---|
| D1 | 预检失败**不拦截**绑定；失败的 Bot 进入「暂停」，不被调度。例外：分支不存在属于群级错误，拦截 |
| D2 | 仓库历史库**团队共享**，我最近用过的排在前面 |
| D3 | 记录 `(机器, 本地路径, 仓库)`，未绑定工作区时提示「直接使用本机已有目录」 |
| D4 | ssh↔https **自动回退**，先用用户选择的协议，再试另一种 |

## 1. 仓库身份（规范化）

`repoKey = host/path`：全部转小写，**不含端口和凭据**，去掉 `.git` 和首尾 `/`。

> 实现时修正：原稿打算把端口放进 key。但自建 GitLab 常见 ssh 走 2222、https 走 443，放进 key 会把同一个仓库拆成两条，/cd 的 remote 比对也会失败。因此端口不进 key，只保留在 URL 里。

| 输入 | repoKey |
|---|---|
| `git@git.corp:team/sub/app.git` | `git.corp/team/sub/app` |
| `ssh://git@git.corp:2222/team/app` | `git.corp/team/app` |
| `https://GitHub.com/Org/App/` | `github.com/org/app` |
| `http://10.0.0.5:8080/team/app.git` | `10.0.0.5/team/app` |

- TS（`packages/protocol/src/repo.ts`）与 Rust（`crates/gonggong/src/repo.rs::normalize_remote`）各实现一份，用共享用例 `packages/protocol/cases/repo-keys.json` 保证两边结果一致。
- `file://` 和本地路径保持现状（测试用）。
- `http://` 原本就支持；地址正则统一放在 `REPO_URL`（protocol 包）。
- URL 中的凭据（`https://user:token@…`）照常使用；**写入历史库、群事件、审计时去掉 userinfo**。
- provider 只用于图标：host 为 `github.com` 显示 GitHub，其他显示通用 Git 图标。

### 协议候选（D4）

`candidates(url, pref)` 由 daemon 计算，按顺序尝试：

1. 按 **Bot 主人的协议偏好** `gitProtocol: 'auto' | 'ssh' | 'https'`（个人设置，默认 `auto`）排序：`auto` 表示先用群里填写的 URL 本身；`ssh` / `https` 表示先用该协议的写法。
2. 然后试另一种写法：
   - ssh → https：`https://host/path.git`，丢弃 ssh 端口。
   - https → ssh：`git@host:path.git`，仅当 https 使用默认端口时才生成。自定义端口推算不出 ssh 地址，不生成。
   - `http://` 原样保留，同时可推算 ssh 写法。
3. 机器上的 `url.<base>.insteadOf` 由 git 自行生效，不做额外处理。
4. 成功的写法记为 `usedUrl`：后续 clone / fetch 使用它，clone 出来的 `origin` 即为 `usedUrl`。

偏好放在用户上而不放在机器上，是因为「只能用 HTTPS」通常是个人账号的限制；如果某个仓库只开了 HTTPS，由第 2 步的回退兜底。

## 2. 协议

先改 `packages/protocol/src/daemon.ts`，加 fixture，再同步 `crates/gonggong/src/protocol.rs`。

```ts
// s2d
RepoProbe = { t: 'repo.probe', requestId, url, branch, protocol: 'auto' | 'ssh' | 'https' }
// d2s
RepoProbeResult = {
  t: 'repo.probe.result', requestId,
  ok: boolean,
  reason: 'denied' | 'branch_missing' | 'network' | 'timeout' | null,
  usedUrl: string | null,
  defaultBranch: string | null,   // ls-remote --symref HEAD
  branches: string[],             // 最多 200 条
  detail: string | null,          // git stderr 末行，去掉凭据
}
```

- daemon 对每个候选地址执行 `git ls-remote --symref <url> HEAD 'refs/heads/*'`，带 `GIT_TERMINAL_PROMPT=0` 和 `LC_ALL=C`（按英文 stderr 分类），单个候选超时 15 秒。第一个成功的候选即为结果。不强制 ssh BatchMode，以免覆盖用户自己的 `core.sshCommand`。
- detail 取最能说明问题的一行：远端给的 `remote:` 提示，其次是第一条 `fatal:`，最后是第一行。
- `reason` 判定：
  - 仓库能访问，但分支不在列表里：`branch_missing`；
  - stderr 匹配 DNS / 连接拒绝 / 证书问题：`network`（detail 中保留证书提示）；
  - 超时：`timeout`；
  - 其他失败：`denied`（无权限和仓库不存在，Git 无法可靠区分，合并为一类）。
- 服务端判定 `offline`：机器不在线，不下发探测。服务端等待 40 秒兜底，超时也算 `timeout`。
- `RepoSpec` 增加 `protocol` 字段；`workspace.ensure` / `workspace.cd` / `run.start` 下发 clone 时，按同样的候选顺序尝试。
- `WorkspaceState` 增加 `reason`（与探测结果同一枚举，可为 null），`failed` 时填写；另增加 `remotes`，/cd 目录就绪时附带其 remote URL，用于历史库和本机目录记录（也覆盖未绑定仓库的群）。
- 不提升 `PROTOCOL_VERSION`：旧版 daemon 收不到 `repo.probe` 的应答时，服务端超时后按 `timeout` 处理。

## 3. 状态与调度

- 沿用 `group_bots.workspaceState`，新增 `workspace_reason` 列。**不另建访问状态表**。
- `repoId` 就是仓库版本：换仓库会删行、插入新行，`id` 随之改变。晚到的结果以 `repoId` 或 `requestId` 过滤，不需要 generation 字段。
- **暂停**：`workspaceState = 'failed'` 且 `reason ∈ {denied, network, timeout}`。`runs/trigger.ts` 在现有 `unbound` 判断旁边增加：

  > `{bot} 所在机器无法访问 {repoKey}（{原因}），本次未执行；{owner} 配置后点「重新检查」`

  同时通知 Bot 主人。`pending`（离线）的行为保持现状。
- **重新检查**：`POST /api/groups/:id/bots/:botId/recheck`，群管理员和 Bot 主人可调用，重新下发 `workspace.ensure`。
- **自动恢复**：机器重连时，现有逻辑会对非 `ready` / `unbound` 的 Bot 重发 ensure（`provision.ts:234`），`failed` 的 Bot 天然覆盖在内。

## 4. 预检编排（服务端）

`POST /api/repos/probe { url, branch, botIds[] }` → `{ results: [{ botId, ok, reason, usedUrl, … }], defaultBranch, branches }`

- `botIds` 按 `machineId` 去重，并行下发 `repo.probe`，离线机器直接返回 `offline`。
- 同一台机器上的多个 Bot 复用同一个结果。探测时用的是**机器对应 Bot 主人**的协议偏好；主人不同的 Bot 分别探测。
- 调用方：
  - 建群 / DM：`botIds` = 选中的 Bot；
  - 换仓库：`botIds` = 群内现有 Bot；
  - 拉 Bot 进群：`botIds` = 新 Bot；
  - 只填了 URL、还没选 Bot：`botIds` = 调用者自己的所有在线 Bot（只用来获取分支列表）。
- 提交接口（建群、换仓库、加 Bot）**不重复探测**，照常落库；以随后的 clone 结果为准。唯一的拦截：预检中任一 Bot 返回 `branch_missing`，前端禁用提交；服务端在提交时再用最近一次缓存的预检结果复核，缓存 60 秒，没有缓存则放行。
- 原来的 `/groups/validate-repo`（服务端凭据）删除。服务端的 `ls-remote` 只留给 mirror 使用。

## 5. 仓库历史库（D2、D3）

```text
repos           id, key unique, url(去凭据), name(path 末段), last_branch, last_used_at, hidden_at null, created_at
repo_users      repo_id + user_id 主键, used_at            （只用于「我用过的排前面」和隐藏权限）
machine_repos   machine_id + path 主键, repo_id, seen_at
users           + git_protocol text default 'auto'
group_bots      + workspace_reason text null
```

写入点：

| 来源 | 写入 |
|---|---|
| 建群、换仓库、DM 绑定 | `repos` upsert，并写 `repo_uses(source=group)` |
| /cd 成功，daemon 上报 `DirGit.remotes` | 每个 remote upsert `repos`，写 `machine_repos`、`repo_uses(source=cd)` |
| Bot 的默认工作区在进群时校验通过 | 同上（走的也是 workspace.cd） |
| 历史数据 | 服务启动时幂等回填现有 `group_repos`（`backfillRepos`），不写进 SQL 迁移，保证规范化规则只有一份 |

检索：`GET /api/repos?q=`，对 `name`、`path`、`host` 做 `ILIKE`，最多返回 20 条。

- 排序：我在 `repo_uses` 里最近一次使用的时间倒序，然后按 `last_used_at` 倒序。
- 每条返回：群数（当前绑定该 key 的群）、`last_branch`、我名下机器上的 `machine_repos.path`。
- 删除：`DELETE /api/repos/:id` 只隐藏（`hidden_at`），系统管理员或该条目唯一使用者可操作。

本地目录提示（D3）：`GET /api/groups/:id/local-paths` 返回调用者机器上持有该群仓库的目录。Bot 处于 `unbound` 时，主人打开「选择工作区」，顶部会多出「使用本机已有的仓库目录（免 clone）」，一键触发现有的 `workspace.cd`。cd 到该路径失败时删除这条 `machine_repos`。

## 6. Web 界面

- `RepoFields`：
  - 地址框改为可搜索的 Combobox，展示历史库条目：图标、`host/path`、「3 个群在用 · main」、「本机已有」标记；
  - 分支框改为下拉，选项来自预检返回的分支列表，默认填 `defaultBranch`，也允许手动输入；
  - 「校验」按钮文案改为「检查访问」。
- 预检结果区：每个 Bot 一行，显示 ✓ 可访问（附 `usedUrl` 协议徽标）/ ✗ 无权限 / ⚠ 网络或证书 / ⏸ 离线待验证。有失败时提交按钮文案为「绑定（2 个 Bot 暂不可用）」；`branch_missing` 时禁用提交。
- 个人设置：账户菜单新增「Git 协议：按仓库地址 / 优先 SSH / 优先 HTTPS」（`PATCH /api/me`）。
- 暂停的 Bot：群聊顶部横幅显示原因；Bot 主人和群管理员有「重新检查」按钮。
- 界面控件遵循 macOS 27 组件库（Pane）。

## 7. mirror 降级（D14）

服务端 mirror 拉取失败时，文件候选退回到 Bot 工作区的文件，分组标题注明「基准分支镜像不可用」，不报错。服务端需要镜像私有仓库时，在部署文档中说明如何配置 git credential helper。

## 8. 边缘场景

1. 同一仓库在群里存为 ssh 地址、本机 /cd 目录的 remote 是 https：两者 repoKey 一致，匹配成功。
2. 预检后 URL 或分支被改：Web 端丢弃旧结果（沿用 `edits` 计数）；服务端缓存以 `url + branch` 为键。
3. 群里没有 Bot：只做格式检查，然后绑定。拉 Bot 进群时再预检。
4. 换仓库时有运行中的任务：沿用现有的重置逻辑；晚到的 `workspace.state` 按 requestId 丢弃。
5. Bot 换绑到新机器：所在各群改回 `pending`，在新机器上重新 ensure；`machine_repos` 按机器区分，不会串用。
6. 自签证书：判为 `network`，detail 提示检查 `http.sslVerify` 或 CA。
7. 凭据写在 URL 里：历史库、事件、审计中都只保存去掉凭据的地址。群绑定本身保存原样，保证 clone 可用。
8. GitLab 子组很深、路径含大写：repoKey 统一小写，显示时用历史库保存的原始大小写。
9. 分支数量超过 200：列表截断，允许手动输入分支名。

## 9. 测试

- 规范化：共享 fixture，TS（vitest）与 Rust 单元测试都要通过；协议候选顺序的表驱动测试。
- 协议：新增消息的 fixture，TS / Rust 双向往返。
- daemon：用本地 `file://` 裸仓库和不存在的地址覆盖 ok / branch_missing / denied / 回退顺序。
- 服务端集成（`createTestDb`）：预检编排按机器去重、离线返回 offline、预检缓存拦截 branch_missing、暂停 Bot 触发时生成事件、recheck 流程、历史库写入 / 检索排序 / 回填迁移。
- Web：Combobox 选中历史条目后自动填入，预检结果逐行渲染，提交按钮三种状态。
- E2E：双 daemon，其中一台无权限（指向不可读路径），验证绑定成功、一个 Bot 暂停、另一个 Bot 正常运行。

## 10. 未做 / 后续

- 群设置里「拉入 Bot」不做预检：Bot 进群并 clone 失败后直接暂停，并通知主人。
- 不接 GitHub / GitLab API，不做成员 OAuth。

## 11. 开发切片

1. 规范化与协议候选（TS + Rust + fixture，修端口问题，`http://`）
2. `repo.probe` 协议与 daemon 实现；`RepoSpec.protocol`；clone 回退；`WorkspaceState.reason`
3. `workspace_reason` 列、调度拦截、recheck 接口、通知
4. 预检编排接口与缓存；删除 `validate-repo`；个人设置 `gitProtocol`
5. `repos` / `repo_uses` / `machine_repos` 表、回填迁移、检索接口、各写入点
6. Web：RepoFields Combobox 与分支下拉、预检结果、成员暂停标识、本机目录提示、协议偏好设置
7. mirror 降级与双 daemon E2E
