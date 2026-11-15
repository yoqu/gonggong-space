# 机器管理：Docker 机器与 Git 访问方案

> 背景：服务器上用 `docker/daemon` 跑 gg，Bot 拉仓库失败（git 要账号密码）；Agent 登录、升级、诊断都要 `docker compose exec` 进容器。目标：这些事在网页上的机器页里就能完成。
> 基线：origin/main `fb899608`（机器管理第 1–4 轮已合入）。

## 1. 现状

| 事实 | 位置 |
|---|---|
| daemon 的 git 远程命令一律非交互：`GIT_TERMINAL_PROMPT=0`，ssh `BatchMode=yes`；要密码即失败，归类为 `denied` | `crates/gonggong/src/repo.rs` `remote_output_with` |
| 镜像里有 git、gh、openssh，SSH 首次连接 `accept-new`；没有密钥、credential helper、gh 登录 | `docker/daemon/Dockerfile` |
| 无权限时 Bot 暂停，横幅只写「在这台机器上配置 git 凭据后重新检查」，没有入口 | `apps/web/src/features/chat/WorkspaceBanner.tsx` |
| Bot 提交身份已由 daemon 注入 `GIT_AUTHOR_*` / `-c user.name`，不缺 | `engine.rs`、`git_write.rs` |
| `gg doctor` 有 git 凭据、磁盘、换行符等自检，只在命令行可见 | `crates/gonggong/src/diag.rs` |
| 机器页已有「新建终端」（机器终端，任意目录），能在网页里跑交互命令 | `MachinePage.tsx`、`protocol/src/terminal.ts` |
| 镜像设 `GONGGONG_NO_AUTO_UPGRADE=1`；网页升级指引只写桌面端和 `gg run` | `upgrade.rs`、`AdminPanels.tsx` `UpgradeGuide` |
| 首次启动必须先 `docker compose run --rm daemon gg login '<接入链接>'` | `docker/daemon/entrypoint.sh` |
| `providers.cmd` 已有「明文 Key 经服务端转发、不落库不记日志」的先例 | `protocol/src/daemon.ts` `ProvidersCmd` |

## 2. 方案总览（按优先级）

| # | 内容 | 端 | 需发 daemon | 迁移 |
|---|---|---|---|---|
| A | 机器页「Git 访问」区：SSH 密钥、HTTPS 令牌、测试连接、主机密钥 | 协议 + daemon + server + web | 是 | 无 |
| B | 暂停横幅「去配置」直达 A，带上仓库地址 | web | 否 | 无 |
| C | 「诊断」区显示 `gg doctor` 自检，可重新检查 | 协议 + daemon + server + web | 是 | 无 |
| D | Docker 首启自动绑定（`GONGGONG_BIND_URL`），绑定弹窗加「Docker」方式 | 镜像 + web | 镜像 | 无 |
| E | daemon 上报运行环境（容器 / 禁止自动升级），网页按此给升级指引、隐藏不可用入口 | 协议 + daemon + web | 是 | 无 |
| F | Agent 官方登录：「在终端中登录」一键打开机器终端并预填命令 | web | 否 | 无 |
| G | （可选）机器级环境变量：代理、私有 npm / pip 源，对 git、Agent、终端都生效 | 协议 + daemon + web | 是 | 无 |

全部是 daemon 本地状态，服务端不存凭据，不需要数据库迁移。旧 daemon 不带新 feature 时，网页显示「升级 daemon 后可用」，并给出现有的手动做法（打开机器终端）。

## 3. 详细设计

### A. Git 访问

机器页新增第 5 区「Git 访问」（概览 / Agent 与供应商 / 工作区 / **Git 访问** / 诊断）。仅机器主人可操作，管理员只读。

**协议**：`git.cmd`（daemon feature `gitAccess`）→ `git.result`。

```ts
GitCmd = { t: 'git.cmd', requestId, action: 'status' | 'genKey' | 'saveToken' | 'removeToken' | 'test' | 'trustHost',
  token?: { host, username, secret },   // saveToken：明文只转发，不落库、不进日志、不进审计详情
  host?: string,                        // removeToken / trustHost
  url?: string }                        // test
GitAccessView = {
  sshKeys: { path, type, fingerprint, publicKey, comment }[],   // 只读 ~/.ssh/*.pub
  tokens: { host, username, masked }[],                       // 只列共工写入的那份凭据文件
  helper: string | null,                                       // 机器已有的 credential.helper（keychain、manager…）
  gh: { host, user }[],                                        // gh auth status，有就显示
  knownHosts: string[],
}
```

**行为**
1. **SSH 密钥**：没有密钥时显示「生成密钥」，daemon 跑 `ssh-keygen -t ed25519 -N '' -C gonggong@<机器名>`，已有同名文件绝不覆盖。网页显示公钥 + 复制，附 GitHub（Settings → SSH keys / Deploy keys）和 GitLab 的添加位置说明。私钥不出机器。
2. **HTTPS 令牌**：表单「主机 / 用户名 / 令牌」。daemon 写到 `~/.gonggong/git-credentials`（0600），并在 git 全局配置里追加 `credential.https://<host>.helper=store --file ~/.gonggong/git-credentials`（按主机配置，不碰机器已有的 keychain / manager 全局 helper）。删除时同时去掉文件条目和这条配置。列表里令牌只显示前 4 位。
3. **测试连接**：输入仓库地址，复用 `repo::remote_git` 跑 `ls-remote --heads`，展示 `RepoAccessReason` 和 `explain()` 的原文，并按地址给建议：ssh 地址 → 「添加 SSH 公钥」，https 地址 → 「添加令牌」；已有 ssh ↔ https 自动回退的结果也一起显示。
4. **主机密钥**：非 Docker 机器上 `Host key verification failed` 时，显示该主机指纹（`ssh-keyscan`），点「信任」写入 `~/.ssh/known_hosts`。

### B. 暂停横幅直达

`WorkspaceBanner` 主人视角加按钮「去配置」→ `/machines/:id?section=git&repo=<url>`，A 区打开时自动填好测试地址并跑一次测试。配置完回群点「重新检查」照旧。

### C. 网页诊断

`diag.run`（feature `diag`）→ 返回 `gg doctor` 现有检查项 `{ kind, status, detail }[]`。「诊断」区顶部一张自检表，带「重新检查」；git 一项出错时链接到 A。

### D. Docker 首启自动绑定

- `entrypoint.sh`：未绑定且设了 `GONGGONG_BIND_URL` 时先 `gg login "$GONGGONG_BIND_URL"`，成功后继续 `gg run`；没设时保持现有提示。
- `compose.yml` 增加可选的 `GONGGONG_BIND_URL`。
- 绑定弹窗增加「Docker」页签：生成 `.env` 三行（`GG_VERSION`、`GONGGONG_MACHINE_ID`、`GONGGONG_BIND_URL`）和 `docker compose up -d --build`。接入链接只在首次启动用，过期后重建容器不受影响（已绑定的配置在卷里）。
- 同步更新 `website/deploy/docker.md`（中英）。

### E. 运行环境上报

- `MachineInfo` 加 `runtime: 'native' | 'container'`（镜像里设 `GONGGONG_CONTAINER=1`，daemon 读环境变量，不靠猜 `/.dockerenv`）和 `autoUpgrade: boolean`。
- `UpgradeGuide`：容器机器显示「拉新镜像重建」命令（改 `GG_VERSION` → `docker compose build && docker compose up -d`）；禁止自动升级的非容器机器说明原因。
- linux 机器隐藏或置灰「微信开发者工具」「用本机应用打开」等入口，悬停说明「Linux 机器不支持」。

### F. Agent 官方登录

不自造登录协议（Claude Code 的登录流程是交互式且会变）。在「Agent 与供应商」中，Agent 未登录时卡片给两条路：
1. 「在终端中登录」：打开机器终端并预填 `claude`（进入后 `/login`）或 `codex login --device-auth`；
2. 「改用 API Key 供应商」：跳到新增供应商。

### G. 机器级环境变量（可选）

Agent 官方登录已有按 Agent 的 env 和代理，团队密钥会注入环境变量；缺的是对 daemon 自己的 git、所有 Agent、机器终端都生效的一层（`HTTPS_PROXY`、`NPM_CONFIG_REGISTRY`、`PIP_INDEX_URL`）。存在 daemon 本地配置里，启动子进程时注入，优先级低于 Bot / 供应商自己的设置。

## 4. 切片与顺序

1. **A + B**（一次 daemon 发版的核心）：协议与 fixture → daemon `git_access.rs` + `tests/it/` → server 转发路由 → web 区块。先写失败测试：server 转发与不落库、daemon 生成密钥不覆盖 / 凭据文件权限 / 按主机 helper、web 区块与横幅跳转。
2. **C + E**：同一轮 daemon 改动，跟 A 一起发版。
3. **D + F**：不依赖 daemon 发版，可并行。
4. **G**：确认要做再排。

e2e：在 `e2e/` 加一条「无凭据仓库 → Bot 暂停 → 横幅去配置 → 保存令牌（本地 git http 服务）→ 重新检查 → 恢复」。

## 5. 风险

- **令牌经过服务端**：沿用 `providers.cmd` 做法，要在测试里断言不进库、不进日志、不进审计详情。
- **改用户的全局 git 配置**：只加按主机的 helper，不改全局 helper；在 A 区显示机器已有的 helper，冲突时提示而不覆盖。
- **桌面机器**：同一套 A 区在 macOS / Windows 上也能用；有 keychain / manager 时优先建议用系统自己的登录方式。
- **与机器管理第 5 轮**（web 与桌面对齐）改同一个机器页，需要和共字君错开或合并进第 5 轮。
